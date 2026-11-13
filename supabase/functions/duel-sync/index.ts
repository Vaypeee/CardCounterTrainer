// POST { matchId, forfeit? } → { now, me, match, cards }
// Heartbeat + state of a ranked duel. Called every ~2 s by both players, and just before each round
// to fetch its cards (released DUEL.leadMs before the first card). Also closes rounds whose window is
// over and settles forfeits, so a match always moves on as long as one player is still here.
import { advance, loadMatch, seatOf, touch, view } from '../_shared/duel.ts';
import { handler, HttpError, json, requireUser } from '../_shared/http.ts';

Deno.serve(handler(async (req) => {
  const now = Date.now();
  const user = await requireUser(req);
  const { matchId, forfeit } = await req.json().catch(() => ({}));
  if (typeof matchId !== 'string') throw new HttpError(400, 'missing matchId');
  const who = seatOf(await loadMatch(matchId), user.id);
  // Settle with the heartbeats as they were before this call: a player back after a long
  // absence has already forfeited.
  const m = await advance(matchId, now, forfeit === true ? { forfeitBy: who } : {});
  if (m.status === 'live') await touch(m, who, now);
  return json(await view(m, who, now));
}));
