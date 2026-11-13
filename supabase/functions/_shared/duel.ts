// Server side of the Count Duel: load a match, advance it (close rounds, forfeits), finish it with Elo.
// All game rules come from _shared/core/duel.js (same code as the browser and the tests).
import {
  DUEL, cardsReleased, closeRound, currentRound, planDuel, roundDue, verifyDuel,
} from './core/duel.js';
import { eloUpdate } from './core/elo.js';
import { admin, HttpError } from './http.ts';

export const PUBLIC_COLS = 'id, ruleset, rated, p1, p2, p1_name, p2_name, p1_elo, p2_elo, status, state, version, result, reason, p1_delta, p2_delta, p1_seen, p2_seen, created_at, finished_at';

// deno-lint-ignore no-explicit-any
export type Match = any;

export async function loadMatch(id: string) {
  const { data, error } = await admin.from('matches').select(PUBLIC_COLS).eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError(404, 'match not found');
  return data as Match;
}

/** 0 for p1, 1 for p2; 403 for anyone else. */
export function seatOf(m: Match, userId: string): 0 | 1 {
  if (m.p1 === userId) return 0;
  if (m.p2 === userId) return 1;
  throw new HttpError(403, 'not your match');
}

const planCache = new Map<string, ReturnType<typeof planDuel>>();
export async function planOf(m: Match) {
  let plan = planCache.get(m.id);
  if (!plan) {
    const { data, error } = await admin.from('match_secrets').select('seed').eq('match_id', m.id).single();
    if (error) throw error;
    plan = planDuel(Number(data.seed));
    planCache.set(m.id, plan);
    if (planCache.size > 200) planCache.delete(planCache.keys().next().value!);
  }
  return plan;
}
async function seedOf(id: string) {
  const { data, error } = await admin.from('match_secrets').select('seed').eq('match_id', id).single();
  if (error) throw error;
  return Number(data.seed);
}

async function answersOf(m: Match) {
  const { data, error } = await admin.from('match_answers').select('user_id, round, value, received_at').eq('match_id', m.id);
  if (error) throw error;
  return (data ?? []).map((a) => ({ who: a.user_id === m.p1 ? 0 : 1, round: a.round, v: Number(a.value), at: Date.parse(a.received_at) }));
}

/**
 * Finish a match: result 'p1' | 'p2' | 'draw' | 'void'. Elo deltas from both players' current ratings (rated matches only).
 * Returns false if another request changed the match first (caller re-reads and retries).
 */
async function finish(m: Match, state: unknown, result: string, reason: string) {
  let d1 = null, d2 = null;
  if (result !== 'void' && m.rated) {   // friendly matches are unrated
    const { data: rs, error } = await admin.from('ratings').select('user_id, elo, games').in('user_id', [m.p1, m.p2]);
    if (error) throw error;
    const r1 = rs!.find((r) => r.user_id === m.p1)!, r2 = rs!.find((r) => r.user_id === m.p2)!;
    [d1, d2] = eloUpdate(r1, r2, result === 'p1' ? 1 : result === 'p2' ? 0 : 0.5);
  }
  const { data: ok, error } = await admin.rpc('duel_commit', {
    p_id: m.id, p_version: m.version, p_state: state, p_result: result, p_reason: reason, p_d1: d1, p_d2: d2,
  });
  if (error) throw error;
  if (ok && result !== 'void') await storeRuns(m, state);
  return !!ok;
}

/** One verified `runs` row per player (ruleset duel-v1); the log is that player's answers. */
async function storeRuns(m: Match, state: Match) {
  const answers = await answersOf(m);
  const rows = [m.p1, m.p2].map((uid, who) => {
    const correct = state.rounds.filter((rd: Match) => rd.res && rd.res[who].ok).length;
    return {
      user_id: uid, ruleset: DUEL.id, seed: 0, status: 'verified', match_id: m.id,
      submitted_at: new Date().toISOString(), score: correct, sort_key: correct,
      accuracy: Math.round((correct / Math.max(1, state.rounds.filter((rd: Match) => rd.res).length)) * 1000) / 10,
      log: answers.filter((a) => a.who === who),
    };
  });
  const { error } = await admin.from('runs').insert(rows);
  if (error) console.error('runs insert', error);
}

async function commit(m: Match, state: unknown) {
  const { data, error } = await admin.rpc('duel_commit', { p_id: m.id, p_version: m.version, p_state: state });
  if (error) throw error;
  return !!data;
}

/**
 * Bring a live match up to date at server time `now`:
 * void / forfeit on silence, forfeit on request, close the current round when due, finish when decided.
 * Retries on lost races. Returns the fresh match row.
 */
export async function advance(id: string, now: number, opts: { forfeitBy?: 0 | 1; seenBefore?: (m: Match) => void } = {}) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const m = await loadMatch(id);
    if (m.status !== 'live') return m;
    let done = false;

    const seen = [Date.parse(m.p1_seen), Date.parse(m.p2_seen)];
    const gone = seen.map((t) => now - t > DUEL.forfeitMs);
    if (opts.forfeitBy != null) {
      done = await finish(m, m.state, opts.forfeitBy === 0 ? 'p2' : 'p1', 'forfeit');
    } else if (gone[0] && gone[1]) {
      done = await finish(m, m.state, 'void', 'both players left');
    } else if (gone[0] || gone[1]) {
      done = await finish(m, m.state, gone[0] ? 'p2' : 'p1', 'opponent left');
    } else if (roundDue(m.state, now)) {
      const plan = await planOf(m);
      const r = currentRound(m.state);
      const answers = (await answersOf(m)).filter((a) => a.round === r);
      const rows = [0, 1].map((who) => answers.find((a) => a.who === who) ?? null);
      const { state, outcome } = closeRound(m.state, plan, rows, now);
      if (outcome) {
        // Final check: replay the whole duel from the seed and every stored answer.
        const all = await answersOf(m);
        const v = verifyDuel(await seedOf(m.id), state.rounds.map((rd: Match) => rd.dealAt), all);
        const same = v.ok && v.outcome && v.outcome.winner === outcome.winner;
        done = same
          ? await finish(m, state, outcome.winner === 0 ? 'p1' : outcome.winner === 1 ? 'p2' : 'draw', outcome.reason)
          : await finish(m, state, 'void', 'verification failed: ' + (v.ok ? 'outcome mismatch' : v.reason));
      } else {
        done = await commit(m, state);
      }
    } else {
      return m;
    }
    if (done) return await loadMatch(id);
  }
  return await loadMatch(id);
}

/** Heartbeat: the player is still here. */
export async function touch(m: Match, who: 0 | 1, now: number) {
  const { error } = await admin.from('matches').update({ [who === 0 ? 'p1_seen' : 'p2_seen']: new Date(now).toISOString() }).eq('id', m.id).eq('status', 'live');
  if (error) throw error;
}

/** Response shared by duel-sync and duel-answer: the public match, the caller's seat, and the current round's cards once released. */
export async function view(m: Match, who: 0 | 1, now: number) {
  let cards = null;
  const r = m.status === 'live' ? currentRound(m.state) : -1;
  if (r >= 0 && cardsReleased(m.state.rounds[r], now)) {
    const plan = await planOf(m);
    cards = { round: r, cards: plan.rounds[r].cards.map((c: Match) => ({ r: c.r, s: c.s, red: c.red })) };
  }
  const { p1_seen: _a, p2_seen: _b, ...pub } = m;
  return { now, me: who, match: pub, cards };
}
