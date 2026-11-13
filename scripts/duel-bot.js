/* A bot opponent for testing the ranked 1v1 in the browser against the LOCAL stack.
   It signs up, joins the queue, plays honestly (its own running count from the cards it is shown)
   and misses on purpose from round MISS on. Usage: bun scripts/duel-bot.js [missRound=4] [delayMs=1800] [host|CODE]
   Friend challenges: 'host' creates an invite and prints the link, CODE accepts that invite instead of queueing.
   Refuses to run against anything but 127.0.0.1 / localhost. */
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { questionAt } from '../src/core/duel.js';
import { tagOf } from '../src/core/engine.js';

const env = Object.fromEntries(readFileSync(new URL('../.env.development.local', import.meta.url), 'utf8')
  .split(/\r?\n/).filter(l => /^\w+=/.test(l)).map(l => l.split(/=(.*)/s).slice(0, 2)));
if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(env.VITE_SUPABASE_URL)) throw new Error('local stack only');
const MISS = Number(process.argv[2] ?? 4) - 1, DELAY = Number(process.argv[3] ?? 1800), FRIEND = process.argv[4];
const sleep = ms => new Promise(r => setTimeout(r, ms));

const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const { data: su, error } = await sb.auth.signUp({ email: `bot_${Date.now()}@sim.test`, password: 'sim-password-123' });
if (error) throw error;
const name = `Bot_${String(Date.now()).slice(-5)}`;
await sb.from('profiles').insert({ id: su.user.id, username: name });
const call = async (fn, body) => {
  const { data, error: e } = await sb.functions.invoke(fn, { body });
  if (e) { try { return await e.context.json(); } catch { return { error: e.message }; } }
  return data;
};
let matchId;
if (FRIEND === 'host') {
  const { code } = await call('duel-invite', { action: 'create' });
  console.log(`${name} invites: http://localhost:5180/?duel=${code}`);
  let q;
  do { await sleep(1500); q = await call('duel-invite', { action: 'poll', code }); } while (q.status !== 'matched');
  matchId = q.matchId;
} else if (FRIEND) {
  const q = await call('duel-invite', { action: 'accept', code: FRIEND });
  if (!q.matchId) throw new Error(q.error || 'accept failed');
  matchId = q.matchId;
} else {
  console.log(`${name} in the queue`);
  let q = await call('duel-queue', { action: 'join' });
  while (q.status !== 'matched') { await sleep(1500); q = await call('duel-queue', { action: 'poll' }); }
  matchId = q.matchId;
}
console.log('matched', matchId);
let rc = 0, done = new Set();
for (;;) {
  const s = await call('duel-sync', { matchId });
  if (s.match.status !== 'live') { console.log('finished', s.match.result, s.match.reason, 'deltas', s.match.p1_delta, s.match.p2_delta); break; }
  const rounds = s.match.state.rounds, r = rounds.length - 1, rd = rounds[r];
  if (r > 0 && rounds[r - 1].rc != null) rc = rounds[r - 1].rc;
  if (s.cards && !done.has(r) && s.now >= questionAt(rd) + DELAY) {
    done.add(r);
    let v = rc;
    for (const c of s.cards.cards) v += tagOf('hilo', c);
    if (r >= MISS) v += 2;
    const a = await call('duel-answer', { matchId, round: r, value: v });
    console.log(`round ${r + 1}: answered ${v}`, a.accepted ? '' : a.reason);
  }
  await sleep(300);
}
