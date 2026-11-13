/* Two simulated players play ranked duels against the LOCAL stack (bun run db:start + bun run functions),
   plus a set of cheating attempts. Run: bun scripts/duel-sim.js
   Never points at the hosted project: it refuses any URL that is not 127.0.0.1 / localhost. */
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { DUEL, questionAt } from '../src/core/duel.js';
import { tagOf } from '../src/core/engine.js';

const env = Object.fromEntries(readFileSync(new URL('../.env.development.local', import.meta.url), 'utf8')
  .split(/\r?\n/).filter(l => /^\w+=/.test(l)).map(l => l.split(/=(.*)/s).slice(0, 2)));
const URL_ = env.VITE_SUPABASE_URL, KEY = env.VITE_SUPABASE_ANON_KEY;
if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(URL_)) throw new Error('duel-sim only runs against the local stack');

const sleep = ms => new Promise(r => setTimeout(r, ms));
let failures = 0;
const check = (cond, label) => { console.log(`${cond ? '  ok ' : '  FAIL'} ${label}`); if (!cond) failures++; };

async function player(name) {
  const sb = createClient(URL_, KEY, { auth: { persistSession: false } });
  const email = `${name.toLowerCase()}_${Date.now()}@sim.test`;
  const { data, error } = await sb.auth.signUp({ email, password: 'sim-password-123' });
  if (error) throw error;
  const username = `${name}_${String(Date.now()).slice(-6)}`;
  const { error: e2 } = await sb.from('profiles').insert({ id: data.user.id, username });
  if (e2) throw e2;
  const call = async (fn, body) => {
    const { data: d, error: err } = await sb.functions.invoke(fn, { body });
    if (err) { let j = null; try { j = await err.context.json(); } catch { /* */ } return { status: err.context?.status, ...(j || { error: err.message }) }; }
    return { status: 200, ...d };
  };
  return { sb, name: username, id: data.user.id, call, offset: 0 };
}

async function matchUp(a, b) {
  await a.call('duel-queue', { action: 'join' });
  await b.call('duel-queue', { action: 'join' });
  for (let i = 0; i < 20; i++) {
    const [ra, rb] = [await a.call('duel-queue', { action: 'poll' }), await b.call('duel-queue', { action: 'poll' })];
    if (ra.matchId && rb.matchId) { check(ra.matchId === rb.matchId, 'both players get the same match'); return ra.matchId; }
    await sleep(500);
  }
  throw new Error('no match');
}

/* Play one duel. strategy(who, round) → 'right' | 'wrong' | 'none'. Each player keeps its own running count
   from the cards it is shown, like a human would. */
async function playDuel(players, matchId, strategy, { delays = [1200, 1500], onRound } = {}) {
  const rc = [0, 0], seen = [new Set(), new Set()];
  let res;
  for (;;) {
    res = await players[0].call('duel-sync', { matchId });
    await players[1].call('duel-sync', { matchId });
    if (res.match.status !== 'live') break;
    const st = res.match.state, r = st.rounds.length - 1, rd = st.rounds[r];
    const now = res.now;
    if (!res.cards || now < questionAt(rd)) { await sleep(Math.min(1000, Math.max(50, questionAt(rd) - now))); continue; }
    if (onRound) await onRound(r, rd, res);
    for (const who of [0, 1]) {
      if (seen[who].has(r)) continue;
      seen[who].add(r);
      const cards = (await players[who].call('duel-sync', { matchId })).cards;
      for (const c of cards.cards) rc[who] += tagOf('hilo', c);
      const s = strategy(who, r);
      if (s === 'none') continue;
      await sleep(Math.max(0, questionAt(rd) + delays[who] - Date.now()));
      const v = s === 'right' ? rc[who] : rc[who] + 3;
      const ans = await players[who].call('duel-answer', { matchId, round: r, value: v });
      if (!ans.accepted) console.log('    answer refused:', who, ans.reason);
    }
    // keep the counts honest from the revealed RC (the trainer shows it after each round)
    let after;
    for (;;) { after = await players[0].call('duel-sync', { matchId }); await players[1].call('duel-sync', { matchId });
      if (after.match.status !== 'live' || after.match.state.rounds[r].res) break; await sleep(400); }
    const revealed = after.match.state.rounds[r].rc;
    rc[0] = rc[1] = revealed;
    if (after.match.status !== 'live') { res = after; break; }
  }
  return res.match;
}

async function rating(p) {
  const { data } = await p.sb.from('ratings').select('elo, games, wins, losses, draws').eq('user_id', p.id).single();
  return data;
}

async function main() {
  console.log('Players…');
  const A = await player('Alice'), B = await player('Bob'), C = await player('Carol');

  console.log('Match 1: sudden death, Bob misses round 2');
  const m1 = await matchUp(A, B);
  const pre = await A.call('duel-sync', { matchId: m1 });
  const meA = pre.me;
  const P = meA === 0 ? [A, B] : [B, A];          // P[0] = seat p1
  const bobSeat = P[0] === B ? 0 : 1;

  // --- cheating attempts while the match is live ---
  check(pre.cards === null || pre.now >= pre.match.state.rounds[0].dealAt - DUEL.leadMs, 'no cards before the lead time');
  check(!JSON.stringify(pre.match).includes('"cards"') && !('seed' in pre.match), 'public match has no seed or cards');
  const early = await P[0].call('duel-answer', { matchId: m1, round: 0, value: 0 });
  check(early.status === 409 && early.reason === 'too early', `answer before the question is refused (${early.reason})`);
  const future = await P[0].call('duel-answer', { matchId: m1, round: 3, value: 0 });
  check(future.status === 409 && future.reason === 'not the current round', 'answer to a future round is refused');
  const outsider = await C.call('duel-sync', { matchId: m1 });
  check(outsider.status === 403, 'a third player cannot read the match');
  const sec = await A.sb.from('match_secrets').select('*');
  check(!sec.data?.length, 'client cannot read the seed');
  const upd = await A.sb.from('matches').update({ result: 'p1' }).eq('id', m1).select();
  check(!upd.data?.length, 'client cannot write the match');
  const rup = await A.sb.from('ratings').update({ elo: 3000 }).eq('user_id', A.id).select();
  check(!rup.data?.length, 'client cannot write its rating');
  const rpc = await A.sb.rpc('duel_commit', { p_id: m1, p_version: 0, p_state: {}, p_result: 'p1' });
  check(!!rpc.error, 'client cannot call duel_commit');
  const peek = await C.sb.from('matches').select('id').eq('id', m1);
  check(!peek.data?.length, 'RLS hides the match from a third player');

  let dupChecked = false;
  const final1 = await playDuel(P, m1, (who, r) => (who === bobSeat && r === 2 ? 'wrong' : 'right'), {
    onRound: async (r) => {
      if (r !== 1 || dupChecked) return;
      dupChecked = true;
      const ansAns = await C.sb.from('match_answers').select('*');
      check(!ansAns.data?.length, 'client cannot read stored answers');
    },
  });
  const aliceSeat = 1 - bobSeat;
  check(final1.result === (aliceSeat === 0 ? 'p1' : 'p2'), `Alice wins (${final1.result}, ${final1.reason})`);
  check(final1.reason === 'sudden death' && final1.state.rounds.length === 3, 'decided in round 3 by sudden death');
  const [ra, rb] = [await rating(A), await rating(B)];
  check(ra.elo === 1020 && rb.elo === 980, `Elo 1020 / 980 (got ${ra.elo} / ${rb.elo})`);
  check(ra.wins === 1 && rb.losses === 1 && ra.games === 1, 'win / loss recorded');
  const dup = await P[0].call('duel-answer', { matchId: m1, round: 2, value: 0 });
  check(dup.accepted === false && dup.reason === 'match over', 'no answers after the end');
  const runs = await A.sb.from('runs').select('ruleset, status, match_id').eq('match_id', m1);
  check(runs.data?.length === 2 && runs.data.every(r => r.status === 'verified' && r.ruleset === 'duel-v1'), 'a verified duel-v1 run per player');

  console.log('Match 2: Alice answers twice, then forfeits');
  const m2 = await matchUp(A, B);
  const s2 = await A.call('duel-sync', { matchId: m2 });
  const rd0 = s2.match.state.rounds[0];
  while (Date.now() < questionAt(rd0) + 600) { await A.call('duel-sync', { matchId: m2 }); await B.call('duel-sync', { matchId: m2 }); await sleep(Math.min(1500, Math.max(0, questionAt(rd0) + 600 - Date.now()))); }
  const first = await A.call('duel-answer', { matchId: m2, round: 0, value: 1 });
  const second = await A.call('duel-answer', { matchId: m2, round: 0, value: 2 });
  if (!first.accepted) console.log('    first:', first.status, first.reason || first.error, first.match?.status, first.match?.reason);
  check(first.accepted && second.status === 409 && second.reason === 'already answered', 'second answer to the same round refused');
  check(first.match.state.rounds[0].a[first.me] === true && first.match.state.rounds[0].res === undefined, 'opponent only sees "answered", no value');
  const ff = await A.call('duel-sync', { matchId: m2, forfeit: true });
  check(ff.match.status === 'finished' && ff.match.reason === 'forfeit', 'forfeit ends the match');
  check(ff.match.result === (ff.me === 0 ? 'p2' : 'p1'), 'forfeit = loss');

  console.log('Match 3: Bob stops answering and polling (left) → loss after 15 s');
  const m3 = await matchUp(A, B);
  let last;
  for (let i = 0; i < 60; i++) { last = await A.call('duel-sync', { matchId: m3 }); if (last.match.status !== 'live') break; await sleep(1000); }
  check(last.match.status === 'finished', `match settled without Bob (${last.match.reason})`);
  check(last.match.result === (last.me === 0 ? 'p1' : 'p2'), 'Alice wins');

  console.log('Match 4: friend challenge by invite link (unrated)');
  const ratingOrNull = async p => (await p.sb.from('ratings').select('elo, games').eq('user_id', p.id).maybeSingle()).data;
  const [a0, c0] = [await ratingOrNull(A), await ratingOrNull(C)];
  const inv1 = await A.call('duel-invite', { action: 'create' });
  check(/^[a-z0-9]{10}$/.test(inv1.code || ''), `invite code created (${inv1.code})`);
  const anon = await fetch(`${URL_}/functions/v1/duel-invite`, { method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'peek', code: inv1.code }) }).then(r => r.json());
  check(anon.host === A.name && anon.open && anon.waiting, 'anyone can see who sent the invite');
  const own = await A.call('duel-invite', { action: 'accept', code: inv1.code });
  check(own.status === 409 && /own invite/.test(own.error), 'cannot accept your own invite');
  const invRead = await A.sb.from('invites').select('*');
  check(!invRead.data?.length, 'client cannot read invites');
  const bad = await C.call('duel-invite', { action: 'accept', code: 'zzzzzzzzzz' });
  check(bad.status === 409, 'unknown code refused');
  console.log('    (waiting 11 s without host heartbeat…)');
  await sleep(11000);
  const stale = await C.call('duel-invite', { action: 'accept', code: inv1.code });
  check(stale.status === 409 && /no longer waiting/.test(stale.error), 'host gone → invite cannot be accepted');
  const inv2 = await A.call('duel-invite', { action: 'create' });
  const oldGone = await A.call('duel-invite', { action: 'peek', code: inv1.code });
  check(oldGone.open === false, 'a new link replaces the old one');
  const w = await A.call('duel-invite', { action: 'poll', code: inv2.code });
  check(w.status === 'waiting', 'host polls: waiting');
  const acc = await C.call('duel-invite', { action: 'accept', code: inv2.code });
  check(acc.status === 'matched' && !!acc.matchId, 'friend accepts → match');
  const hostPoll = await A.call('duel-invite', { action: 'poll', code: inv2.code });
  check(hostPoll.status === 'matched' && hostPoll.matchId === acc.matchId, 'host poll returns the same match');
  const again = await B.call('duel-invite', { action: 'accept', code: inv2.code });
  check(again.status === 409 && /already used/.test(again.error), 'an invite works once');
  const s4 = await A.call('duel-sync', { matchId: acc.matchId });
  check(s4.match.rated === false, 'friendly match is unrated');
  const P4 = s4.me === 0 ? [A, C] : [C, A], carolSeat = P4[0] === C ? 0 : 1;
  const final4 = await playDuel(P4, acc.matchId, (who, r) => (who === carolSeat && r === 0 ? 'wrong' : 'right'));
  check(final4.status === 'finished' && final4.reason === 'sudden death' && final4.result === (carolSeat === 0 ? 'p2' : 'p1'), `Alice wins the friendly (${final4.result}, ${final4.reason})`);
  check(final4.p1_delta == null && final4.p2_delta == null, 'no Elo deltas');
  const [a1, c1] = [await ratingOrNull(A), await ratingOrNull(C)];
  check(JSON.stringify(a0) === JSON.stringify(a1) && JSON.stringify(c0) === JSON.stringify(c1), 'ratings unchanged');

  const lad = await C.sb.from('elo_ladder').select('username, elo, rank').order('rank').limit(10);
  const mine = await C.sb.from('elo_ladder').select('username').eq('user_id', A.id);
  check(mine.data?.length === 1, 'ladder lists the players');
  console.log(lad.data);
  console.log(failures ? `${failures} FAILED` : 'all checks passed');
  process.exit(failures ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
