/* =========================================================
   BACKEND (Supabase) — accounts and server-verified runs
   (the building blocks of the future 1v1 ranked mode).
   Optional: without VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
   the trainer works exactly as before (offline, no account) and
   every online control stays hidden.
   ========================================================= */
const URL_ = import.meta.env.VITE_SUPABASE_URL;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const enabled = !!(URL_ && KEY);
// supabase-js (~60 kB gzip) is loaded lazily by init(), so the trainer paints as fast as before.
let sb = null;

let user = null, profile = null;
const listeners = new Set();
const emit = () => listeners.forEach(fn => fn({ user, profile }));

export const getUser = () => user;
export const getProfile = () => profile;
/** Subscribe to sign-in / profile changes. Calls fn immediately with the current state. */
export function onChange(fn) { listeners.add(fn); fn({ user, profile }); return () => listeners.delete(fn); }

async function loadProfile() {
  profile = null;
  if (user) {
    const { data } = await sb.from('profiles').select('id, username, username_changed_at').eq('id', user.id).maybeSingle();
    profile = data;
  }
  emit();
}

export async function init() {
  if (!enabled) return;
  // A password-reset link lands here with #…type=recovery; supabase-js consumes the hash
  // (and fires PASSWORD_RECOVERY) while the client starts, before any listener exists.
  if (/[#&]type=recovery\b/.test(location.hash)) recovering = true;
  const { createClient } = await import('@supabase/supabase-js');
  sb = createClient(URL_, KEY, { auth: { persistSession: true, detectSessionInUrl: true } });
  const [{ data }] = await Promise.all([sb.auth.getSession(), loadProviders()]);
  user = data.session?.user ?? null;
  await loadProfile();
  sessionHook(data.session);
  sb.auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY') { recovering = true; emit(); }
    const next = session?.user ?? null;
    if (next?.id === user?.id) return;
    user = next;
    loadProfile();
    sessionHook(session);
  });
}

/* Optional deployment-specific hooks: src/private/hooks.js is not part of the repository.
   When the file is absent the glob is empty and nothing runs. */
const hooks = Object.values(import.meta.glob('./private/hooks.js', { eager: true }))[0] ?? {};
function sessionHook(session) {
  try { hooks.onSession?.(session); } catch { /* a hook must never break the app */ }
}

/* ---------- Auth: Google, GitHub, email + password ---------- */
const back = () => location.origin + location.pathname;
/** OAuth providers switched on in the Supabase project (buttons are hidden for the others). */
export let providers = { google: false, github: false };
let recovering = false;
export const isRecovering = () => recovering;
async function loadProviders() {
  try {
    const r = await fetch(`${URL_}/auth/v1/settings`, { headers: { apikey: KEY } });
    const s = await r.json();
    providers = { google: !!s.external?.google, github: !!s.external?.github };
  } catch { /* keep defaults */ }
}
/* Google sign-in through Google Identity Services (when VITE_GOOGLE_CLIENT_ID is set): Google's own button,
   the sign-in happens on this site (Google shows velua.xyz instead of the Supabase project address), then the
   ID token is handed to Supabase (signInWithIdToken, with a hashed nonce against replay). Without the client
   id, or if Google's script cannot load, the account screen falls back to the OAuth redirect below. */
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';
export const hasGoogleButton = () => !!GOOGLE_CLIENT_ID;
let gisLoading = null;
function loadGoogleScript() {
  if (window.google?.accounts?.id) return Promise.resolve();
  return gisLoading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = resolve;
    s.onerror = () => { gisLoading = null; s.remove(); reject(new Error('Google sign-in could not load.')); };
    document.head.appendChild(s);
  });
}
async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
/** Renders Google's sign-in button into `el`. onError(err) is called if the Supabase sign-in fails. */
export async function renderGoogleButton(el, { dark, onError }) {
  await loadGoogleScript();
  const raw = crypto.randomUUID() + crypto.randomUUID();
  const nonce = await sha256Hex(raw);
  window.google.accounts.id.initialize({
    client_id: GOOGLE_CLIENT_ID,
    nonce,
    use_fedcm_for_button: true,
    callback: async ({ credential }) => {
      const { error } = await sb.auth.signInWithIdToken({ provider: 'google', token: credential, nonce: raw });
      if (error) onError(error);
    },
  });
  el.replaceChildren();
  window.google.accounts.id.renderButton(el, {
    type: 'standard', theme: dark ? 'filled_black' : 'outline', size: 'medium',
    text: 'continue_with', shape: 'rectangular', logo_alignment: 'left', locale: 'en',   // UI copy is English
  });
}

/** Redirects to Google / GitHub, which send the player back here signed in. */
export async function signInWith(provider) {
  const { error } = await sb.auth.signInWithOAuth({ provider, options: { redirectTo: back() } });
  if (error) throw error;
}
export async function signInWithPassword(email, password) {
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message === 'Invalid login credentials' ? 'Wrong email or password.' : error.message);
}
/** Returns true when the account is active right away, false when the email must be confirmed first. */
/* Supabase's built-in mailer allows only a few emails per hour per project: say so plainly. */
const mailError = e => (/rate limit/i.test(e.message)
  ? new Error('Too many emails sent in the last hour. Try again later, or continue with Google / GitHub.') : e);
export async function signUp(email, password) {
  const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: back() } });
  if (error) throw mailError(error);
  return !!data.session;
}
export async function sendPasswordReset(email) {
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: back() });
  if (error) throw mailError(error);
}
export async function updatePassword(password) {
  const { error } = await sb.auth.updateUser({ password });
  if (error) throw error;
  recovering = false;
  emit();
}
/** A player-name suggestion from the Google / GitHub profile ("" if none fits). */
export function suggestedUsername() {
  const m = user?.user_metadata || {};
  const raw = m.user_name || m.preferred_username || m.full_name || m.name || (user?.email || '').split('@')[0] || '';
  const name = raw.normalize('NFKD').replace(/[^\w]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').slice(0, 20);
  return name.length >= 3 ? name : '';
}
export async function signOut() {
  await sb.auth.signOut();
  user = null; profile = null;
  emit();
}

/** Player names can change once every 30 days (the first choice is free). Returns the Date it is allowed again, or null. */
export const RENAME_DAYS = 30;
export function nextRenameAt() {
  const t = profile && profile.username_changed_at ? Date.parse(profile.username_changed_at) + RENAME_DAYS * 864e5 : 0;
  return t > Date.now() ? new Date(t) : null;
}
export async function setUsername(username) {
  if (profile && profile.username === username) return;
  const { data, error } = await sb.from('profiles').upsert({ id: user.id, username }).select('id, username, username_changed_at').single();
  // P0001 = the 30-day rename limit (trigger in 20261111180000_username_cooldown.sql); its message has the date.
  if (error) throw new Error(error.code === '23505' ? 'That name is taken.' : error.code === '23514' ? '3–20 letters, digits or _.' : error.message);
  profile = data;
  emit();
}

/* ---------- Ranked runs (Edge Functions) ---------- */
async function call(name, body) {
  const { data, error } = await sb.functions.invoke(name, { body });
  if (error) {
    let msg = error.message;
    try { const j = await error.context.json(); if (j && j.error) msg = j.error; } catch { /* not JSON */ }
    throw new Error(msg);
  }
  return data;
}
export const startRun = ruleset => call('start-run', { ruleset });
export const submitRun = (runId, log) => call('submit-run', { runId, log });

/* ---------- Ranked 1v1 (Count Duel) ---------- */
export const duelQueue = action => call('duel-queue', { action });
/** Friend challenges: create | poll | cancel (host), peek (anyone) | accept (friend). */
export const duelInvite = (action, code) => call('duel-invite', code ? { action, code } : { action });
export const duelSync = (matchId, forfeit = false) => call('duel-sync', forfeit ? { matchId, forfeit: true } : { matchId });
/** Answers are refused with HTTP 409 + a reason (too late, already answered…): returned, not thrown. */
export async function duelAnswer(matchId, round, value) {
  const { data, error } = await sb.functions.invoke('duel-answer', { body: { matchId, round, value } });
  if (!error) return data;
  try { const j = await error.context.json(); if (j && j.match) return j; if (j && j.error) throw new Error(j.error); } catch (e) { if (e instanceof Error && e.message) throw e; }
  throw new Error(error.message);
}
/** Live updates of a match row over Realtime (RLS: only its two players). Returns an unsubscribe function. */
export function watchMatch(matchId, fn) {
  const ch = sb.channel('match:' + matchId)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'matches', filter: `id=eq.${matchId}` }, p => fn(p.new))
    .subscribe();
  return () => sb.removeChannel(ch);
}
export async function myRating() {
  if (!user) return null;
  const [{ data: r }, { data: l }] = await Promise.all([
    sb.from('ratings').select('elo, games, wins, losses, draws').eq('user_id', user.id).maybeSingle(),
    sb.from('elo_ladder').select('rank').eq('user_id', user.id).maybeSingle(),
  ]);
  return r ? { ...r, rank: l ? Number(l.rank) : null } : { elo: 1000, games: 0, wins: 0, losses: 0, draws: 0, rank: null };
}
export async function ladder(limit = 100) {
  const { data, error } = await sb.from('elo_ladder').select('user_id, username, elo, games, wins, losses, draws, rank')
    .order('rank').order('games', { ascending: false }).limit(limit);
  if (error) throw error;
  return data;
}
/** The signed-in player's finished duels, newest first (RLS: matches are readable by their 2 players only),
    with the player's own answers from the verified runs rows (void matches have none). */
export async function matchHistory(limit = 50) {
  if (!user) return [];
  const { data: ms, error } = await sb.from('matches')
    .select('id, rated, p1, p2, p1_name, p2_name, p1_elo, p2_elo, state, result, reason, p1_delta, p2_delta, created_at, finished_at')
    .eq('status', 'finished').or(`p1.eq.${user.id},p2.eq.${user.id}`)
    .order('finished_at', { ascending: false }).limit(limit);
  if (error) throw error;
  if (!ms.length) return [];
  const { data: runs } = await sb.from('runs').select('match_id, log')
    .eq('user_id', user.id).eq('ruleset', 'duel-v1').in('match_id', ms.map(m => m.id));
  const logs = new Map((runs ?? []).map(r => [r.match_id, r.log]));
  return ms.map(m => {
    const me = m.p1 === user.id ? 0 : 1, mine = {};
    for (const a of logs.get(m.id) ?? []) mine[a.round] = a.v;
    return { match: m, me, mine };
  });
}
