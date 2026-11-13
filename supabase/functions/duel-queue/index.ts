// POST { action: 'join' | 'poll' | 'cancel' }
//   → { status: 'searching' | 'matched' | 'idle', matchId?, window, waitedMs, rating, now }
// Ranked 1v1 matchmaking. The client polls every ~2 s while searching; each poll widens the
// accepted Elo gap (src/core/elo.js searchWindow) and tries to pair atomically in SQL (duel_pair).
import { DUEL, newDuelState, planDuel } from '../_shared/core/duel.js';
import { QUEUE, searchWindow } from '../_shared/core/elo.js';
import { randomSeed } from '../_shared/core/rng.js';
import { advance } from '../_shared/duel.ts';
import { admin, handler, HttpError, json, requireUser } from '../_shared/http.ts';

async function rating(uid: string) {
  await admin.from('ratings').upsert({ user_id: uid }, { onConflict: 'user_id', ignoreDuplicates: true });
  const { data, error } = await admin.from('ratings').select('elo, games, wins, losses, draws').eq('user_id', uid).single();
  if (error) throw error;
  return data;
}

/** The caller's live match, after bringing it up to date (it may just have ended by forfeit / void). */
async function liveMatch(uid: string, now: number) {
  const { data } = await admin.from('matches').select('id').eq('status', 'live').or(`p1.eq.${uid},p2.eq.${uid}`).limit(1);
  if (!data?.length) return null;
  const m = await advance(data[0].id, now);
  return m.status === 'live' ? m.id : null;
}

Deno.serve(handler(async (req) => {
  const now = Date.now();
  const user = await requireUser(req);
  const { action } = await req.json().catch(() => ({}));
  if (!['join', 'poll', 'cancel'].includes(action)) throw new HttpError(400, 'bad action');

  const { data: profile } = await admin.from('profiles').select('id').eq('id', user.id).maybeSingle();
  if (!profile) throw new HttpError(400, 'choose a username first');

  if (action === 'cancel') {
    await admin.from('queue').delete().eq('user_id', user.id).is('match_id', null);
    return json({ status: 'idle', now });
  }

  const r = await rating(user.id);
  // Already playing (e.g. reloaded the page): go back to that match.
  const live = await liveMatch(user.id, now);
  if (live) return json({ status: 'matched', matchId: live, rating: r, now });

  // Drop players who stopped polling.
  await admin.from('queue').delete().is('match_id', null).lt('seen_at', new Date(now - QUEUE.staleMs).toISOString());

  let { data: row } = await admin.from('queue').select('*').eq('user_id', user.id).maybeSingle();
  if (action === 'join' || !row || row.match_id) {
    if (action === 'poll' && !row) return json({ status: 'idle', rating: r, now });
    // A stale match_id (match already over) or a fresh join: (re)enter the queue.
    if (action === 'join' || row?.match_id) {
      const { data, error } = await admin.from('queue').upsert({
        user_id: user.id, elo: r.elo, joined_at: action === 'join' ? new Date(now).toISOString() : row.joined_at,
        seen_at: new Date(now).toISOString(), match_id: null,
      }).select('*').single();
      if (error) throw error;
      row = data;
    }
  } else {
    await admin.from('queue').update({ seen_at: new Date(now).toISOString() }).eq('user_id', user.id);
  }

  const waitedMs = now - Date.parse(row.joined_at);
  const window = searchWindow(waitedMs);
  const seed = randomSeed();
  const state = newDuelState(planDuel(seed), now + DUEL.startDelayMs);
  const { data: matchId, error } = await admin.rpc('duel_pair', { p_user: user.id, p_window: window, p_seed: seed, p_state: state });
  if (error) throw error;
  if (matchId) return json({ status: 'matched', matchId, rating: r, window, waitedMs, now });
  return json({ status: 'searching', rating: r, window, waitedMs, now });
}));
