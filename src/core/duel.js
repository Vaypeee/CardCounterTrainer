/* =========================================================
   COUNT DUEL (pure) — the ranked 1v1.

   Both players see the same cards at the same moment: the server
   holds the seed, sets the time each round starts (dealAt, server
   epoch ms) and the client shows card i at dealAt + i × pace.
   After a round's last card both type the running count. The server
   timestamps the answers, closes the round when both answered (or
   when the window is over), reveals the count and decides:

   - one right and the other wrong in the same round → the right one wins (sudden death)
   - after `maxRounds` rounds still level → lower total answer time wins, equal = draw
   - a player silent for `forfeitMs` loses (handled by the server, see duel-sync)

   The public state (readable by both players, pushed over Realtime)
   never holds an answer before its round is closed, nor future cards.
   Everything here runs unchanged in the browser, tests and Edge Functions.
   ========================================================= */
import { createRng } from './rng.js';
import { buildShoe, tagOf } from './engine.js';

export const DUEL = {
  id: 'duel-v1',
  name: 'Count Duel',
  system: 'hilo',
  decks: 6,
  maxRounds: 12,
  cardsMin: 8, cardsMax: 15,       // cards per round (from the seed)
  pace0: 1000,                      // ms per card in round 1
  paceFactor: 0.85,                 // × per round
  paceFloor: 250,
  answerMs: 8000,                   // answer window, from the moment the question shows
  graceMs: 750,                     // network slack after the window
  closeSlackMs: 1000,               // a round without both answers closes this long after the grace (an accepted answer may still be on its way to the database)
  earlyMs: 150,                     // an answer may not reach the server before the question shows (minus this)
  revealMs: 3000,                   // pause after a round: correct count + both ✓/✗
  startDelayMs: 5000,               // matched → first card (both clients load, 3-2-1)
  leadMs: 1500,                     // a round's cards are released this long before its first card
  forfeitMs: 15000,                 // silent this long = loss
};
export const DUEL_RULES = 'Hi-Lo · 6 decks · 8–15 cards per round · 1.0 s/card, ×0.85 each round · type the running count · first miss loses';

export const paceOf = r => Math.max(DUEL.paceFloor, Math.round(DUEL.pace0 * DUEL.paceFactor ** r));

/** Every round's cards and the running count after it, from the seed. Server only. */
export function planDuel(seed) {
  const rng = createRng(seed);
  const shoe = buildShoe(DUEL.decks, rng);
  const rounds = [];
  let pos = 0, rc = 0;
  for (let r = 0; r < DUEL.maxRounds; r++) {
    const n = rng.int(DUEL.cardsMin, DUEL.cardsMax);
    const cards = shoe.slice(pos, pos + n);
    pos += n;
    for (const c of cards) rc += tagOf(DUEL.system, c);
    rounds.push({ n, pace: paceOf(r), cards, rc });
  }
  return { rounds };
}

/* ---------- Round timing (server epoch ms) ---------- */
export const questionAt = rd => rd.dealAt + rd.n * rd.pace;
export const deadlineOf = rd => questionAt(rd) + DUEL.answerMs;

const roundMeta = (plan, r, dealAt) => ({ n: plan.rounds[r].n, pace: plan.rounds[r].pace, dealAt, a: [false, false] });

/** Public state of a new match: round 1 starts at startAt. */
export function newDuelState(plan, startAt) {
  return { rounds: [roundMeta(plan, 0, startAt)] };
}

export const currentRound = state => {
  const r = state.rounds.length - 1;
  return state.rounds[r] && !state.rounds[r].res ? r : -1;
};

/**
 * Validate an answer arriving at the server at `now`. Returns null when accepted, or a reason.
 * (The value itself is stored privately; the public state only records that the player answered.)
 */
export function checkAnswer(state, who, round, value, now) {
  const r = currentRound(state);
  if (r < 0 || round !== r) return 'not the current round';
  const rd = state.rounds[r];
  if (rd.a[who]) return 'already answered';
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1000) return 'bad answer';
  if (now < questionAt(rd) - DUEL.earlyMs) return 'too early';
  if (now > deadlineOf(rd) + DUEL.graceMs) return 'too late';
  return null;
}

/** Copy of the state with `who`'s answer flag set on the current round. */
export function markAnswered(state, who) {
  const s = structuredClone(state), rd = s.rounds[s.rounds.length - 1];
  rd.a[who] = true;
  return s;
}

/** The round can close: both answered, or the window (+ grace + slack) is over. */
export function roundDue(state, now) {
  const r = currentRound(state);
  if (r < 0) return false;
  const rd = state.rounds[r];
  return (rd.a[0] && rd.a[1]) || now > deadlineOf(rd) + DUEL.graceMs + DUEL.closeSlackMs;
}

/** {ok, ms} for one player's answer row ({ v, at } or null). A missing answer is wrong and costs the whole window. */
export function judgeAnswer(rd, rc, row) {
  if (!row) return { ok: false, ms: DUEL.answerMs };
  const ms = Math.min(DUEL.answerMs + DUEL.graceMs, Math.max(0, Math.round(row.at - questionAt(rd))));
  return { ok: Math.abs(row.v - rc) < 1e-9, ms };
}

/** Decision after the rounds closed so far: null (play on) or { winner: 0 | 1 | null, reason }. */
export function decide(rounds) {
  const last = rounds[rounds.length - 1];
  if (!last || !last.res) return null;
  const [a, b] = last.res;
  if (a.ok !== b.ok) return { winner: a.ok ? 0 : 1, reason: 'sudden death', round: rounds.length - 1 };
  if (rounds.length < DUEL.maxRounds) return null;
  const t = [0, 1].map(i => rounds.reduce((s, rd) => s + rd.res[i].ms, 0));
  if (t[0] === t[1]) return { winner: null, reason: 'draw', round: rounds.length - 1 };
  return { winner: t[0] < t[1] ? 0 : 1, reason: 'speed', round: rounds.length - 1 };
}

/**
 * Close the current round with both answer rows ([row0, row1], each { v, at } or null).
 * Returns { state, outcome }: the next round is scheduled at now + revealMs unless the duel is decided.
 */
export function closeRound(state, plan, rows, now) {
  const s = structuredClone(state);
  const r = currentRound(s);
  if (r < 0) return { state: s, outcome: null };
  const rd = s.rounds[r], rc = plan.rounds[r].rc;
  rd.rc = rc;
  rd.res = [0, 1].map(i => judgeAnswer(rd, rc, rows[i]));
  rd.closedAt = now;
  const outcome = decide(s.rounds);
  if (!outcome) s.rounds.push(roundMeta(plan, r + 1, now + DUEL.revealMs));
  return { state: s, outcome };
}

/**
 * Full replay of a finished duel from the seed, the round start times the server set,
 * and every stored answer ({ who, round, v, at }). Recomputes each round and the outcome,
 * so a stored result can be checked against the same code. Returns { ok, outcome, rounds } or { ok: false, reason }.
 */
export function verifyDuel(seed, dealAts, answers) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xFFFFFFFF) return { ok: false, reason: 'bad seed' };
  if (!Array.isArray(dealAts) || !dealAts.length || dealAts.length > DUEL.maxRounds) return { ok: false, reason: 'bad rounds' };
  const plan = planDuel(seed);
  const rounds = [];
  for (let r = 0; r < dealAts.length; r++) {
    const rd = roundMeta(plan, r, dealAts[r]);
    if (r > 0 && dealAts[r] < questionAt(rounds[r - 1])) return { ok: false, reason: 'rounds overlap' };
    const rows = [0, 1].map(who => {
      const mine = answers.filter(a => a.who === who && a.round === r);
      if (mine.length > 1) return 'dup';
      const a = mine[0];
      if (!a) return null;
      if (a.at < questionAt(rd) - DUEL.earlyMs || a.at > deadlineOf(rd) + DUEL.graceMs) return 'time';
      return a;
    });
    if (rows.includes('dup')) return { ok: false, reason: 'duplicate answer' };
    if (rows.includes('time')) return { ok: false, reason: 'answer outside its window' };
    rd.rc = plan.rounds[r].rc;
    rd.res = rows.map(row => judgeAnswer(rd, rd.rc, row));
    rounds.push(rd);
    const outcome = decide(rounds);
    if (outcome) {
      if (r !== dealAts.length - 1) return { ok: false, reason: 'rounds after the decision' };
      return { ok: true, outcome, rounds };
    }
  }
  if (answers.some(a => a.round >= dealAts.length)) return { ok: false, reason: 'answer to an unplayed round' };
  return { ok: true, outcome: null, rounds };
}

/** Cards of a round, safe to send to a player only from dealAt − leadMs on. */
export const cardsReleased = (rd, now) => now >= rd.dealAt - DUEL.leadMs;
