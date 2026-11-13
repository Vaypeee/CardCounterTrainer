/* Account screen (Google / GitHub / email + password, player name) and the top-line online links. */
import { $, $$ } from '../dom.js';
import * as Backend from '../backend.js';
import { S } from '../state.js';
import { renderSettings } from './settings.js';
import { showScreen } from './screens.js';

const msg = (text, ok = false) => { const m = $('#acctMsg'); m.textContent = text; m.className = 'fb ' + (text ? (ok ? 'good' : 'bad') : ''); };

export function renderAccount() {
  const user = Backend.getUser(), profile = Backend.getProfile(), recovering = Backend.isRecovering();
  $('#newPwForm').hidden = !recovering;
  $('#acctSignedOut').hidden = !!user || recovering;
  $('#acctSignedIn').hidden = !user || recovering;
  if (recovering) { setTimeout(() => $('#acctNewPw').focus(), 30); return; }
  if (user) {
    $('#acctWho').textContent = user.email || user.user_metadata?.user_name || '';
    if (document.activeElement !== $('#acctName')) $('#acctName').value = profile ? profile.username : Backend.suggestedUsername();
    if (!profile) msg('Choose your player name.');
    // Renaming is limited to once every 30 days (enforced by the database).
    const next = Backend.nextRenameAt();
    $('#acctName').disabled = $('#nameSave').disabled = !!next;
    $('#nameHelp').textContent = next ? `Next change possible on ${next.toISOString().slice(0, 10)}`
      : profile ? `3–20 letters, digits or _ · you can change it once every ${Backend.RENAME_DAYS} days` : '3–20 letters, digits or _';
  } else {
    const { google, github } = Backend.providers;
    renderGoogle(google);
    $('[data-provider="github"]').hidden = !github;
    $('#oauthRow').hidden = $('#orLine').hidden = !google && !github;
  }
}

/* Google: Google's own button (sign-in stays on this site) when configured, else the redirect button.
   Re-rendered only when the theme changes; a load failure falls back to the redirect button. */
let googleShown = '';
function renderGoogle(enabled) {
  const box = $('#googleBtn'), redirectBtn = $('[data-provider="google"]');
  const useGis = enabled && Backend.hasGoogleButton() && googleShown !== 'failed';
  box.hidden = !useGis;
  redirectBtn.hidden = !enabled || useGis;
  if (!useGis) return;
  const dark = document.documentElement.dataset.theme !== 'light';
  const key = dark ? 'dark' : 'light';
  if (googleShown === key) return;
  googleShown = key;
  Backend.renderGoogleButton(box, { dark, onError: err => msg(err.message) })
    .catch(() => { googleShown = 'failed'; renderGoogle(enabled); });
}

/** Top line: "sign in" / player name, only when a backend is configured. */
function renderTopline({ user, profile }) {
  $$('[data-online]').forEach(el => { el.hidden = !Backend.enabled; });
  $('#accountBtn').textContent = user ? (profile ? profile.username : 'account') : 'sign in';
}

export function initAccountUI() {
  if (!Backend.enabled) return;
  let prevUser = null;
  Backend.onChange(state => {
    renderTopline(state);
    // Just signed in (e.g. back from Google / GitHub) without a player name, or resetting a password: go to the account page.
    const fresh = state.user && state.user.id !== prevUser;
    prevUser = state.user ? state.user.id : null;
    if ((fresh && !state.profile) || Backend.isRecovering()) { if (S.screen !== 'train') showScreen('account'); }
    if (S.screen === 'account') renderAccount();
    if (S.screen === 'settings') renderSettings();
  });

  $$('[data-provider]').forEach(b => b.addEventListener('click', async () => {
    msg('Redirecting…', true);
    try { await Backend.signInWith(b.dataset.provider); } catch (err) { msg(err.message); }
  }));

  $('#pwForm').addEventListener('submit', async e => {
    e.preventDefault();
    const email = $('#acctEmail').value.trim(), pw = $('#acctPw').value;
    const signup = e.submitter && e.submitter.dataset.action === 'signup';
    msg(signup ? 'Creating account…' : 'Signing in…', true);
    try {
      if (!signup) { await Backend.signInWithPassword(email, pw); msg(''); }
      else if (await Backend.signUp(email, pw)) msg('Account created.', true);
      else msg(`Almost done: confirm your account with the link sent to ${email}.`, true);
      $('#acctPw').value = '';
    } catch (err) { msg(err.message); }
  });
  $('#forgotBtn').addEventListener('click', async () => {
    const email = $('#acctEmail').value.trim();
    if (!email) { msg('Type your email first.'); $('#acctEmail').focus(); return; }
    try { await Backend.sendPasswordReset(email); msg(`Password reset link sent to ${email}.`, true); }
    catch (err) { msg(err.message); }
  });
  $('#newPwForm').addEventListener('submit', async e => {
    e.preventDefault();
    try { await Backend.updatePassword($('#acctNewPw').value); $('#acctNewPw').value = ''; msg('Password updated.', true); renderAccount(); }
    catch (err) { msg(err.message); }
  });

  $('#nameForm').addEventListener('submit', async e => {
    e.preventDefault();
    const name = $('#acctName').value.trim(), current = Backend.getProfile();
    if (current && current.username !== name && !confirm(`Change your player name to "${name}"? You won't be able to change it again for ${Backend.RENAME_DAYS} days.`)) return;
    try { await Backend.setUsername(name); msg('Saved.', true); renderAccount(); }
    catch (err) { msg(err.message); }
  });
  $('#signOutBtn').addEventListener('click', async () => { await Backend.signOut(); msg(''); renderAccount(); });
}
