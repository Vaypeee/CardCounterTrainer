// POST { matchId, round, value } → { now, me, match, cards, accepted, reason? }
// A player's running count for the current round. Timestamped here (server clock), checked against the
// round's window (src/core/duel.js checkAnswer), stored privately (match_answers: one per player per round).
// The public state only learns that the player answered; the round closes when both have.
import { checkAnswer, currentRound, markAnswered } from '../_shared/core/duel.js';
import { advance, loadMatch, seatOf, touch, view } from '../_shared/duel.ts';
import { admin, handler, HttpError, json, requireUser } from '../_shared/http.ts';

Deno.serve(handler(async (req) => {
  const now = Date.now();
  const user = await requireUser(req);
  const { matchId, round, value } = await req.json().catch(() => ({}));
  if (typeof matchId !== 'string') throw new HttpError(400, 'missing matchId');
  const who = seatOf(await loadMatch(matchId), user.id);

  let m = await advance(matchId, now);
  if (m.status !== 'live') return json({ ...(await view(m, who, now)), accepted: false, reason: 'match over' });
  await touch(m, who, now);

  const reason = checkAnswer(m.state, who, round, value, now);
  if (reason) return json({ ...(await view(m, who, now)), accepted: false, reason }, 409);

  const { error } = await admin.from('match_answers').insert({
    match_id: m.id, user_id: user.id, round, value, received_at: new Date(now).toISOString(),
  });
  if (error) {
    if (error.code === '23505') return json({ ...(await view(m, who, now)), accepted: false, reason: 'already answered' }, 409);
    throw error;
  }

  // Flag "answered" in the public state (optimistic retry if the opponent's request got there first).
  for (let i = 0; i < 5; i++) {
    if (currentRound(m.state) !== round || m.state.rounds[round].a[who]) break;
    const { data: ok, error: e } = await admin.rpc('duel_commit', { p_id: m.id, p_version: m.version, p_state: markAnswered(m.state, who) });
    if (e) throw e;
    if (ok) break;
    m = await loadMatch(matchId);
    if (m.status !== 'live') break;
  }
  m = await advance(matchId, Date.now());
  return json({ ...(await view(m, who, Date.now())), accepted: true });
}));
