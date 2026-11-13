// Friend challenges (unrated Count Duel) by invite link.
// POST { action: 'create' }               → { code, now }                    host: a fresh link (old open ones dropped)
//      { action: 'poll', code }           → { status: 'waiting' | 'matched', matchId?, now }   host heartbeat (~2 s)
//      { action: 'cancel', code }         → { status: 'cancelled' }
//      { action: 'peek', code }           → { host, elo, open, waiting }      anyone, signed in or not
//      { action: 'accept', code }         → { status: 'matched', matchId, now } friend: starts the match (SQL duel_accept)
// The host must keep the lobby open: an invite whose host has not polled for 10 s cannot be accepted.
import { DUEL, newDuelState, planDuel } from '../_shared/core/duel.js';
import { randomSeed } from '../_shared/core/rng.js';
import { advance } from '../_shared/duel.ts';
import { admin, handler, HttpError, json, requireUser } from '../_shared/http.ts';

const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';   // no 0/o, 1/l/i
const MAX_AGE_MS = 2 * 60 * 60 * 1000;               // links older than 2 h are cleaned up
const WAITING_MS = 10_000;

function newCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join('');
}
const validCode = (c: unknown): c is string => typeof c === 'string' && /^[a-z0-9]{6,16}$/.test(c);

async function loadInvite(code: string) {
  const { data, error } = await admin.from('invites').select('code, host, created_at, seen_at, match_id').eq('code', code).maybeSingle();
  if (error) throw error;
  return data;
}

Deno.serve(handler(async (req) => {
  const now = Date.now();
  const { action, code } = await req.json().catch(() => ({}));
  if (!['create', 'poll', 'cancel', 'peek', 'accept'].includes(action)) throw new HttpError(400, 'bad action');
  if (action !== 'create' && !validCode(code)) throw new HttpError(400, 'bad invite code');

  if (action === 'peek') {
    const inv = await loadInvite(code);
    if (!inv) return json({ open: false, now });
    const [{ data: p }, { data: r }] = await Promise.all([
      admin.from('profiles').select('username').eq('id', inv.host).maybeSingle(),
      admin.from('ratings').select('elo').eq('user_id', inv.host).maybeSingle(),
    ]);
    return json({
      host: p?.username ?? '?', elo: r?.elo ?? 1000, open: !inv.match_id,
      waiting: !inv.match_id && now - Date.parse(inv.seen_at) <= WAITING_MS, now,
    });
  }

  const user = await requireUser(req);
  const { data: profile } = await admin.from('profiles').select('id').eq('id', user.id).maybeSingle();
  if (!profile) throw new HttpError(400, 'choose a username first');

  if (action === 'create') {
    await admin.from('invites').delete().lt('created_at', new Date(now - MAX_AGE_MS).toISOString());
    await admin.from('invites').delete().eq('host', user.id).is('match_id', null);
    await admin.from('queue').delete().eq('user_id', user.id).is('match_id', null);   // inviting replaces searching
    for (let i = 0; i < 3; i++) {
      const c = newCode();
      const { error } = await admin.from('invites').insert({ code: c, host: user.id, seen_at: new Date(now).toISOString() });
      if (!error) return json({ code: c, now });
      if (error.code !== '23505') throw error;   // unique violation: draw another code
    }
    throw new HttpError(500, 'could not create an invite');
  }

  const inv = await loadInvite(code);

  if (action === 'cancel') {
    if (inv && inv.host === user.id && !inv.match_id) await admin.from('invites').delete().eq('code', code);
    return json({ status: 'cancelled', now });
  }

  if (action === 'poll') {
    if (!inv || inv.host !== user.id) throw new HttpError(404, 'invite not found');
    if (inv.match_id) {
      const m = await advance(inv.match_id, now);
      return json({ status: m.status === 'live' ? 'matched' : 'finished', matchId: inv.match_id, now });
    }
    await admin.from('invites').update({ seen_at: new Date(now).toISOString() }).eq('code', code);
    return json({ status: 'waiting', now });
  }

  // accept
  if (!inv) throw new HttpError(409, 'This invite link is not valid (it may have been cancelled).');
  const seed = randomSeed();
  const state = newDuelState(planDuel(seed), now + DUEL.startDelayMs);
  const { data: matchId, error } = await admin.rpc('duel_accept', { p_code: code, p_guest: user.id, p_seed: seed, p_state: state });
  if (error) {
    if (error.code === 'P0001') throw new HttpError(409, error.message);
    throw error;
  }
  return json({ status: 'matched', matchId, now });
}));
