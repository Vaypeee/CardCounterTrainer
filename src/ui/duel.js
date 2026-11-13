/* =========================================================
   RANKED 1v1 (Count Duel) — lobby + queue, the duel itself, result, ladder.

   The server is the referee (supabase/functions/duel-*): it pairs players,
   sets when each round starts (server clock), releases a round's cards just
   before it, timestamps answers and decides. This module only shows cards at
   the agreed times and sends the player's answers:
   - clock: serverNow() = Date.now() + offset, offset measured on every call
     (kept from the lowest round-trip sample);
   - updates: Realtime (postgres_changes on the match row) for instant ✓/✗,
     plus a heartbeat call every 2 s, which also tells the server we are here
     (silent for 15 s = loss).
   No pause: the opponent keeps playing.
   ========================================================= */
import { $, $$ } from '../dom.js';
import * as Backend from '../backend.js';
import { DUEL, DUEL_RULES, deadlineOf, questionAt } from '../core/duel.js';
import { QUEUE } from '../core/elo.js';
import { fmtClock, fmtNum, parseAnswer } from '../core/format.js';
import { S } from '../state.js';
import { Sound } from '../audio.js';
import { cardEl, shake } from './stage.js';
import { showScreen } from './screens.js';
import { share } from './share.js';

const HEARTBEAT_MS = 2000, POLL_MS = 2000;
const signed = n => fmtNum(n);   // fmtNum already writes +3 / −2
const secs = ms => (ms / 1000).toFixed(1) + ' s';

/* ---------- Queue ---------- */
const Q = { searching: false, poll: null, clock: null, startedAt: 0, keep: false, busy: false };
let last = null;              // last finished match { match, me, mine }

const lobbyMsg = (t, ok = false) => { const m = $('#lobbyMsg'); m.textContent = t; m.className = 'fb ' + (t ? (ok ? 'good' : 'bad') : ''); };

export async function renderLobby() {
  $('#duelRules').textContent = `${DUEL.name}: ${DUEL_RULES}.`;
  const user = Backend.getUser(), profile = Backend.getProfile();
  $('#lobbySignedOut').hidden = !!user;
  $('#lobbySignedIn').hidden = !user;
  renderChallenge();
  if (!user) return;
  $('#lobbyStart').hidden = Q.searching || !!I.code;
  $('#lobbySearch').hidden = !Q.searching;
  $('#inviteBox').hidden = !I.code;
  $('#findBtn').textContent = last ? 'Play again' : 'Play ranked';
  renderLast();
  if (!profile) { lobbyMsg('Choose a player name first (account).'); return; }
  try {
    const r = await Backend.myRating();
    $('#lobbyElo').textContent = r.elo;
    $('#lobbyRecord').textContent = r.games
      ? `${r.games} game${r.games > 1 ? 's' : ''} · ${r.wins}W ${r.losses}L ${r.draws}D${r.rank ? ` · #${r.rank}` : ''}${r.games < 10 ? ' · provisional' : ''}`
      : 'no games yet · provisional';
  } catch { /* offline: keep what is shown */ }
  // Back after a reload in the middle of a match: rejoin it.
  if (!Q.searching && !D.id) {
    try { const res = await Backend.duelQueue('poll'); if (res.status === 'matched') enterDuel(res.matchId); } catch { /* ignore */ }
  }
}

export async function findMatch() {
  if (Q.searching || Q.busy || D.id || I.code) return;
  if (!Backend.getUser()) { showScreen('account'); return; }
  if (!Backend.getProfile()) { showScreen('account'); return; }
  Sound.ensure();
  lobbyMsg('');
  Q.busy = true;
  try {
    const res = await Backend.duelQueue('join');
    Q.searching = true; Q.keep = false; Q.startedAt = Date.now();
    $('#lobbyStart').hidden = true; $('#lobbySearch').hidden = false; $('#keepBtn').hidden = true;
    $('#searchText').textContent = 'Searching for an opponent…';
    onQueue(res);
    Q.poll = setInterval(pollQueue, POLL_MS);
    Q.clock = setInterval(renderSearchClock, 250);
    renderSearchClock();
  } catch (err) { lobbyMsg(err.message); }
  finally { Q.busy = false; }
}
async function pollQueue() {
  if (!Q.searching || Q.busy) return;
  Q.busy = true;
  try { onQueue(await Backend.duelQueue('poll')); }
  catch (err) { lobbyMsg(err.message); }
  finally { Q.busy = false; }
}
function onQueue(res) {
  if (!Q.searching) return;
  if (res.status === 'matched') { stopSearch(); enterDuel(res.matchId); return; }
  if (res.status === 'idle') { stopSearch(); lobbyMsg('Search stopped.'); return; }
  if (res.window) $('#searchWindow').textContent = `Elo ±${res.window}`;
}
function renderSearchClock() {
  const ms = Date.now() - Q.startedAt;
  $('#searchClock').textContent = fmtClock(Math.floor(ms / 1000));
  if (ms >= QUEUE.offerMs && !Q.keep) {
    $('#searchText').textContent = 'No opponent yet.';
    $('#keepBtn').hidden = false;
  }
}
function stopSearch() {
  Q.searching = false;
  clearInterval(Q.poll); clearInterval(Q.clock);
  $('#lobbyStart').hidden = false; $('#lobbySearch').hidden = true;
}
export async function cancelSearch() {
  if (!Q.searching) return;
  stopSearch();
  try { await Backend.duelQueue('cancel'); } catch { /* the entry expires by itself */ }
}
function keepWaiting() {
  Q.keep = true;
  $('#keepBtn').hidden = true;
  $('#searchText').textContent = 'Searching for an opponent…';
}

/* ---------- Friend challenges (unrated) ----------
   Host: "challenge a friend" creates a link (/?duel=CODE) and waits in the lobby, polling (the poll is its
   heartbeat: the server refuses an invite whose host stopped polling). Friend: opening the link keeps the code
   in sessionStorage (it survives an OAuth sign-in round trip), shows who is challenging, and Accept starts
   the match on the server (duel-invite accept). Friendly matches use the normal rules but never change Elo. */
const I = { code: null, poll: null, clock: null, startedAt: 0, busy: false };
const PENDING_KEY = 'cct.invite';
const pending = {
  get() { try { return sessionStorage.getItem(PENDING_KEY); } catch { return null; } },
  set(c) { try { if (c) sessionStorage.setItem(PENDING_KEY, c); else sessionStorage.removeItem(PENDING_KEY); } catch { /* private mode */ } },
};
/** Called at startup: takes ?duel=CODE out of the address bar and keeps it until the player accepts or declines. */
export function captureInvite() {
  const url = new URL(location.href), code = url.searchParams.get('duel');
  if (code == null) return;
  if (/^[a-z0-9]{6,16}$/.test(code)) pending.set(code);
  url.searchParams.delete('duel');
  window.history.replaceState(null, '', url.pathname + url.search + url.hash);
}
export const hasPendingInvite = () => !!pending.get();
const inviteLink = code => `${location.origin}/?duel=${code}`;
const challengeMsg = t => { const m = $('#challengeMsg'); m.textContent = t; m.className = 'fb ' + (t ? 'bad' : ''); };

async function renderChallenge() {
  const code = pending.get(), box = $('#challengeBox');
  box.hidden = !code || !!D.id;
  if (box.hidden) return;
  $('#acceptBtn').innerHTML = Backend.getUser() ? 'Accept <kbd>Enter</kbd>' : 'Sign in to accept';
  try {
    const p = await Backend.duelInvite('peek', code);
    if (!p.open) {
      $('#challengeText').textContent = 'This invite was already used or cancelled.';
      $('#acceptBtn').hidden = true; $('#declineBtn').textContent = 'Dismiss';
      challengeMsg('');
      return;
    }
    $('#acceptBtn').hidden = false; $('#declineBtn').textContent = 'Decline';
    $('#challengeText').innerHTML = `<b>${p.host}</b> <span class="muted">(${p.elo})</span> challenges you to a friendly Count Duel. No Elo change.`;
    challengeMsg(p.waiting ? '' : `${p.host} is not waiting on the page right now: accepting only works while they are.`);
  } catch (err) { challengeMsg(err.message); }
}
async function acceptChallenge() {
  const code = pending.get();
  if (!code || D.id || I.busy) return;
  if (!Backend.getUser() || !Backend.getProfile()) { showScreen('account'); return; }
  Sound.ensure();
  challengeMsg('');
  I.busy = true;
  try {
    const res = await Backend.duelInvite('accept', code);
    pending.set(null);
    $('#challengeBox').hidden = true;
    stopInvite(); await cancelSearch();
    enterDuel(res.matchId);
  } catch (err) { challengeMsg(err.message); }
  finally { I.busy = false; }
}
function declineChallenge() {
  pending.set(null);
  $('#challengeBox').hidden = true;
}

async function createInvite() {
  if (I.code || I.busy || Q.searching || D.id) return;
  if (!Backend.getUser() || !Backend.getProfile()) { showScreen('account'); return; }
  Sound.ensure();
  lobbyMsg('');
  I.busy = true;
  try {
    const { code } = await Backend.duelInvite('create');
    I.code = code; I.startedAt = Date.now();
    $('#inviteUrl').value = inviteLink(code);
    $('#inviteCopy').textContent = 'Copy';
    $('#inviteText').textContent = 'Waiting for your friend…';
    $('#inviteClock').textContent = '0:00';
    $('#lobbyStart').hidden = true; $('#inviteBox').hidden = false;
    I.poll = setInterval(pollInvite, POLL_MS);
    I.clock = setInterval(() => { $('#inviteClock').textContent = fmtClock(Math.floor((Date.now() - I.startedAt) / 1000)); }, 250);
    $('#inviteUrl').select();
  } catch (err) { lobbyMsg(err.message); }
  finally { I.busy = false; }
}
async function pollInvite() {
  if (!I.code || I.busy) return;
  I.busy = true;
  try {
    const res = await Backend.duelInvite('poll', I.code);
    if (res.status === 'matched') { stopInvite(false); enterDuel(res.matchId); }
  } catch (err) {
    if (/not found/i.test(err.message)) { stopInvite(false); lobbyMsg('The invite expired. Create a new link.'); }
  } finally { I.busy = false; }
}
/** Stops waiting for a friend; cancel = also delete the invite on the server. */
function stopInvite(cancel = true) {
  if (!I.code) return;
  const code = I.code;
  I.code = null;
  clearInterval(I.poll); clearInterval(I.clock);
  $('#inviteBox').hidden = true; $('#lobbyStart').hidden = Q.searching;
  if (cancel) Backend.duelInvite('cancel', code).catch(() => { /* it stops being accepted 10 s after the last poll anyway */ });
}
async function copyInvite() {
  const input = $('#inviteUrl');
  input.select();
  try { await navigator.clipboard.writeText(input.value); }
  catch { try { document.execCommand('copy'); } catch { /* the link stays selected */ } }
  $('#inviteCopy').textContent = 'Copied';
}

/* ---------- Duel ---------- */
const D = {
  id: null, me: 0, match: null, cards: {}, offset: 0, rtt: Infinity,
  tick: null, beat: null, unwatch: null, fetching: false, lastFetch: 0,
  shown: '', answered: {}, mine: {}, view: '', sounded: -1, ending: false,
};
const serverNow = () => Date.now() + D.offset;

function apply(res, t0) {
  const t1 = Date.now(), rtt = t1 - t0;
  // Keep the clock offset of the fastest round trip (least network noise); refresh it when one is close.
  if (rtt <= D.rtt + 15) { D.offset = res.now - (t0 + t1) / 2; D.rtt = Math.min(D.rtt, rtt); }
  D.me = res.me;
  setMatch(res.match);
  if (res.cards) D.cards[res.cards.round] = res.cards.cards;
}
function setMatch(m) {
  if (!m || (D.match && m.version < D.match.version)) return;
  D.match = m;
}
async function sync(forfeit = false) {
  if (!D.id) return;
  const t0 = Date.now();
  try { apply(await Backend.duelSync(D.id, forfeit), t0); $('#duelHud').textContent = hudText(); }
  catch (err) { $('#duelHud').textContent = 'connection problem: ' + err.message; }
}
async function fetchCards() {
  if (D.fetching || Date.now() - D.lastFetch < 300) return;
  D.fetching = true; D.lastFetch = Date.now();
  try { await sync(); } finally { D.fetching = false; }
}

export async function enterDuel(matchId) {
  if (D.id === matchId) return;
  Object.assign(D, { id: matchId, match: null, cards: {}, offset: 0, rtt: Infinity, shown: '', answered: {}, mine: {}, view: '', sounded: -1, ending: false });
  showScreen('duel');
  ['#duelCheckOv', '#duelRevealOv', '#duelLeaveOv'].forEach(s => { $(s).hidden = true; });
  $('#duelCountOv').hidden = false; $('#duelCountNum').textContent = '…';
  $('#duelCard').replaceChildren();
  $('#duelRounds').textContent = DUEL.maxRounds;
  await sync();
  if (!D.match) return;
  D.unwatch = Backend.watchMatch(matchId, m => setMatch(m));
  D.beat = setInterval(() => sync(), HEARTBEAT_MS);
  D.tick = setInterval(tick, 40);
  tick();
}

const opp = () => (D.me === 0 ? 1 : 0);
const names = m => [m.p1_name, m.p2_name];
const elos = m => [m.p1_elo, m.p2_elo];
function hudText() {
  const m = D.match;
  return m ? `${names(m)[D.me]} vs ${names(m)[opp()]} · ${DUEL.name}${m.rated === false ? ' · friendly' : ''}` : '';
}

function renderStrip(m) {
  const rounds = m.state.rounds;
  const sig = JSON.stringify(rounds.map(rd => [rd.a, rd.res && rd.res.map(x => x.ok)]));
  if (sig === D.view) return;
  D.view = sig;
  const row = who => {
    const boxes = Array.from({ length: DUEL.maxRounds }, (_, r) => {
      const rd = rounds[r];
      if (!rd) return '<span class="box"></span>';
      if (rd.res) return rd.res[who].ok ? '<span class="box ok" title="right">✓</span>' : '<span class="box ko" title="wrong">✗</span>';
      return `<span class="box cur${rd.a[who] ? ' ans' : ''}" title="${rd.a[who] ? 'answered' : 'playing'}">${rd.a[who] ? '•' : ''}</span>`;
    }).join('');
    return `<div class="duel-row${who === D.me ? ' me' : ''}"><span class="who">${names(m)[who]}<small>${elos(m)[who]}</small>${who === D.me ? '<small>you</small>' : ''}</span><span class="boxes">${boxes}</span></div>`;
  };
  $('#duelStrip').innerHTML = row(D.me) + row(opp());
}

function showOnly(id) {
  ['#duelCountOv', '#duelCheckOv', '#duelRevealOv'].forEach(s => { $(s).hidden = s !== id; });
}

function renderReveal(rd, r, final = false) {
  const me = rd.res[D.me], op = rd.res[opp()], m = D.match;
  $('#duelRevealMeta').textContent = final ? 'Final round' : `Round ${r + 1} · next round at ${secs(paceOfNext(r))}/card`;
  $('#duelRevealTitle').textContent = `Running count: ${signed(rd.rc)}`;
  const mine = D.mine[r];
  const you = me.ok ? `<span class="good">✓ you ${secs(me.ms)}</span>` : `<span class="bad">✗ you${mine != null ? ' said ' + signed(mine) : ' (no answer)'}</span>`;
  const them = op.ok ? `<span class="good">✓ ${names(m)[opp()]}</span>` : `<span class="bad">✗ ${names(m)[opp()]}</span>`;
  $('#duelRevealLine').innerHTML = `${you} · ${them}`;
  if (D.sounded !== r) { D.sounded = r; me.ok ? Sound.good() : Sound.bad(); }
}
const paceOfNext = r => (D.match.state.rounds[r + 1] ? D.match.state.rounds[r + 1].pace : DUEL.paceFloor);

function tick() {
  const m = D.match;
  if (!m || !D.id) return;
  renderStrip(m);
  if (m.status !== 'live') { endDuel(); return; }
  const now = serverNow(), rounds = m.state.rounds, r = rounds.length - 1, rd = rounds[r];
  $('#duelRound').textContent = r + 1;
  $('#duelPace').textContent = (rd.pace / 1000).toFixed(2);
  if (!D.cards[r] && now >= rd.dealAt - DUEL.leadMs) fetchCards();

  if (now < rd.dealAt) {
    $('#duelBar').style.width = '0%';
    if (r === 0) {
      showOnly('#duelCountOv');
      $('#duelCountNum').textContent = Math.max(1, Math.ceil((rd.dealAt - now) / 1000));
      $('#duelVs').textContent = `${names(m)[D.me]} (${elos(m)[D.me]}) vs ${names(m)[opp()]} (${elos(m)[opp()]})`;
    } else {
      showOnly('#duelRevealOv');
      renderReveal(rounds[r - 1], r - 1);
    }
    $('#duelCard').replaceChildren();
    D.shown = '';
    return;
  }
  const qAt = questionAt(rd);
  if (now < qAt) {
    showOnly(null);
    $('#duelBar').style.width = `${Math.min(100, ((now - rd.dealAt) / (qAt - rd.dealAt)) * 100)}%`;
    const i = Math.floor((now - rd.dealAt) / rd.pace), key = `${r}:${i}`;
    if (D.cards[r] && key !== D.shown) {
      D.shown = key;
      $('#duelCard').replaceChildren(cardEl(D.cards[r][i]));
      Sound.deal();
    }
    return;
  }
  // Question time.
  $('#duelCard').replaceChildren();
  const left = deadlineOf(rd) - now;
  $('#duelBar').style.width = `${Math.max(0, Math.min(100, (left / DUEL.answerMs) * 100))}%`;
  const ov = $('#duelCheckOv'), input = $('#duelInput');
  if (ov.hidden) {
    showOnly('#duelCheckOv');
    input.value = ''; input.disabled = false; $('#duelSubmit').disabled = false;
    $('#duelFb').textContent = ''; $('#duelFb').className = 'fb';
    if (!D.answered[r]) setTimeout(() => input.focus(), 0);
  }
  const answered = D.answered[r];
  $('#duelCheckMeta').textContent = `Round ${r + 1} · ${rd.n} cards · ${left > 0 ? secs(left) + ' left' : "time's up"}`;
  if (answered || left <= -DUEL.graceMs) {
    input.disabled = true; $('#duelSubmit').disabled = true;
    if (!answered && !$('#duelFb').textContent) { $('#duelFb').textContent = "Time's up."; $('#duelFb').className = 'fb bad'; }
    // The opponent may never answer: nudge the server to close the round once its window is over.
    if (now > deadlineOf(rd) + DUEL.graceMs + DUEL.closeSlackMs + 200) fetchCards();
  }
}

async function submitDuel() {
  const m = D.match;
  if (!m || m.status !== 'live') return;
  const r = m.state.rounds.length - 1, rd = m.state.rounds[r];
  if (D.answered[r] || serverNow() < questionAt(rd) - DUEL.earlyMs) return;
  const input = $('#duelInput'), v = parseAnswer(input.value);
  if (v === null) { shake(input); return; }
  D.answered[r] = true; D.mine[r] = v;
  input.disabled = true; $('#duelSubmit').disabled = true;
  $('#duelFb').textContent = `${signed(v)} sent · waiting for ${names(m)[opp()]}…`; $('#duelFb').className = 'fb';
  const t0 = Date.now();
  try {
    const res = await Backend.duelAnswer(D.id, r, v);
    apply(res, t0);
    if (!res.accepted) {
      $('#duelFb').textContent = res.reason === 'too late' ? 'Too late: counted as a miss.' : `Not counted: ${res.reason}.`;
      $('#duelFb').className = 'fb bad';
      if (res.reason !== 'already answered') D.mine[r] = null;
    }
  } catch (err) {
    D.answered[r] = false; D.mine[r] = null;
    input.disabled = false; $('#duelSubmit').disabled = false;
    $('#duelFb').textContent = err.message; $('#duelFb').className = 'fb bad';
  }
}

function toggleLeave(show = $('#duelLeaveOv').hidden) {
  $('#duelLeaveOv').hidden = !show;
  if (show) $('#duelStayBtn').focus();
  else if (!$('#duelCheckOv').hidden && !$('#duelInput').disabled) $('#duelInput').focus();
}
async function leaveDuel() {
  $('#duelLeaveOv').hidden = true;
  await sync(true);
  tick();
}

function stopDuel() {
  clearInterval(D.tick); clearInterval(D.beat);
  if (D.unwatch) D.unwatch();
  D.unwatch = null;
}
function endDuel() {
  if (D.ending) return;
  D.ending = true;
  stopDuel();
  const m = D.match, rounds = m.state.rounds, lastRd = rounds[rounds.length - 1];
  last = { match: m, me: D.me, mine: { ...D.mine } };
  const won = (m.result === 'p1' && D.me === 0) || (m.result === 'p2' && D.me === 1);
  $('#duelLeaveOv').hidden = true;
  if (lastRd && lastRd.res) { showOnly('#duelRevealOv'); renderReveal(lastRd, rounds.length - 1, true); }
  else showOnly(null);
  if (m.result !== 'void' && m.result !== 'draw') setTimeout(() => (won ? Sound.good() : Sound.bad()), 300);
  setTimeout(() => { D.id = null; showScreen('ranked'); }, lastRd && lastRd.res ? 2200 : 300);
}

/* ---------- Result (shown in the lobby) ---------- */
const REASONS = {
  'sudden death': (won, m, r, o) => (won ? `Round ${r}: you counted it, ${o} missed.` : `Round ${r}: ${o} counted it, you missed.`),
  speed: won => `Level after ${DUEL.maxRounds} rounds: ${won ? 'your' : 'their'} answers were faster in total.`,
  draw: () => `Level after ${DUEL.maxRounds} rounds, same total answer time.`,
  forfeit: won => (won ? 'Your opponent left the match.' : 'You left the match.'),
  'opponent left': won => (won ? 'Your opponent disconnected.' : 'You were away for more than 15 s.'),
  'both players left': () => 'Both players disconnected: no rating change.',
};
const outcome = (m, me) => (m.result === 'void' ? 'void' : m.result === 'draw' ? 'draw'
  : (m.result === 'p1') === (me === 0) ? 'win' : 'loss');
/** HTML of a finished match seen by player `me` (0 | 1); `mine` = that player's answers by round, when known. */
function matchHtml({ match: m, me, mine = {} }) {
  const o = me === 0 ? 1 : 0, res = outcome(m, me), won = res === 'win';
  const title = { void: 'No contest', draw: 'Draw', win: 'Victory', loss: 'Defeat' }[res];
  const cls = res === 'win' ? 'good' : res === 'loss' ? 'bad' : '';
  const delta = me === 0 ? m.p1_delta : m.p2_delta, before = me === 0 ? m.p1_elo : m.p2_elo;
  const elo = m.rated === false ? 'friendly · no Elo change' : delta == null ? '' : `${before} → ${before + delta} (${delta ? signed(delta) : '0'})`;
  const rounds = m.state.rounds.filter(rd => rd.res);
  const why = REASONS[m.reason] ? REASONS[m.reason](won, m, rounds.length, names(m)[o]) : (m.reason || '');
  const cell = (r, val) => (r.ok ? `<td class="good">✓ ${secs(r.ms)}</td>` : `<td class="bad">✗${val != null ? ' ' + signed(val) : ''}</td>`);
  return `<div class="res-top"><h2 class="${cls}">${title}</h2><span class="mono">${elo}</span></div>
    <span class="small muted sub">vs ${names(m)[o]} (${elos(m)[o]}) · ${why}</span>
    <div class="table-wrap"><table><thead><tr><th>Round</th><th>Cards</th><th>s/card</th><th>Count</th><th>You</th><th>${names(m)[o]}</th></tr></thead><tbody>${
    rounds.length ? rounds.map((rd, r) => `<tr><td>${r + 1}</td><td>${rd.n}</td><td>${(rd.pace / 1000).toFixed(2)}</td><td>${signed(rd.rc)}</td>${cell(rd.res[me], mine[r])}${cell(rd.res[o])}</tr>`).join('')
      : '<tr><td class="empty" colspan="6">No round was completed.</td></tr>'}</tbody></table></div>`;
}
function renderLast() {
  const box = $('#lastMatch');
  box.hidden = !last;
  if (!last) return;
  box.innerHTML = matchHtml(last) + '<div class="last-share"><button class="link small" type="button" id="duelShareBtn">share</button></div>';
  $('#duelShareBtn').addEventListener('click', e => share(duelText(last), e.currentTarget));
}
/** Text shared from the lobby's last result. */
function duelText({ match: m, me }) {
  const o = me === 0 ? 1 : 0, res = outcome(m, me), opp = names(m)[o];
  const kind = m.rated === false ? 'a friendly Count Duel' : 'a ranked Count Duel';
  const rounds = m.state.rounds.filter(rd => rd.res).length;
  const delta = me === 0 ? m.p1_delta : m.p2_delta, before = me === 0 ? m.p1_elo : m.p2_elo;
  const elo = m.rated !== false && delta != null ? ` (Elo ${before} → ${before + delta})` : '';
  const verb = { win: `I won ${kind} against ${opp}`, loss: `I lost ${kind} to ${opp}`, draw: `I drew ${kind} with ${opp}`, void: `I played ${kind} against ${opp}` }[res];
  return `${verb} after ${rounds} round${rounds === 1 ? '' : 's'}${elo} on Velua: 1v1 card counting, same cards at the same time. Think you count faster?`;
}

/* ---------- Match history ---------- */
let history = [];
const when = iso => new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
export async function renderHistory() {
  const t = $('#historyTable'), detail = $('#historyDetail');
  detail.hidden = true;
  t.innerHTML = '<tbody><tr><td class="empty">Loading…</td></tr></tbody>';
  try {
    history = await Backend.matchHistory(50);
    const n = { win: 0, loss: 0, draw: 0 };
    history.forEach(h => { const r = outcome(h.match, h.me); if (r in n) n[r]++; });
    $('#historyMe').textContent = history.length
      ? `Your last ${history.length} ranked match${history.length > 1 ? 'es' : ''}: ${n.win}W ${n.loss}L ${n.draw}D. Click one to see its rounds.`
      : 'Your ranked matches will appear here.';
    const label = { win: '<span class="good">Win</span>', loss: '<span class="bad">Loss</span>', draw: 'Draw', void: '<span class="muted">No contest</span>' };
    t.innerHTML = `<thead><tr><th>Date</th><th class="l">Opponent</th><th class="l">Result</th><th>Rounds</th><th>Elo</th></tr></thead><tbody>${
      history.length ? history.map(({ match: m, me }, i) => {
        const o = me === 0 ? 1 : 0, d = me === 0 ? m.p1_delta : m.p2_delta;
        return `<tr class="pick" tabindex="0" data-i="${i}"><td>${when(m.finished_at || m.created_at)}</td><td class="l">${names(m)[o]} <span class="muted">${elos(m)[o]}</span></td><td class="l">${label[outcome(m, me)]}${m.rated === false ? ' <span class="muted">friendly</span>' : ''}</td><td>${m.state.rounds.filter(rd => rd.res).length}</td><td>${d == null ? '—' : d ? signed(d) : '0'}</td></tr>`;
      }).join('') : '<tr><td class="empty" colspan="5">No ranked match yet.</td></tr>'}</tbody>`;
  } catch (err) {
    t.innerHTML = `<tbody><tr><td class="empty">${err.message}</td></tr></tbody>`;
  }
}
function pickHistory(tr) {
  const h = history[Number(tr.dataset.i)];
  if (!h) return;
  $$('#historyTable tr.sel').forEach(el => el.classList.remove('sel'));
  tr.classList.add('sel');
  const box = $('#historyDetail');
  box.innerHTML = matchHtml(h);
  box.hidden = false;
  box.scrollIntoView({ block: 'nearest' });
}

/* ---------- Ladder ---------- */
export async function renderLadder() {
  const t = $('#ladderTable');
  t.innerHTML = '<tbody><tr><td class="empty">Loading…</td></tr></tbody>';
  try {
    const [rows, me] = await Promise.all([Backend.ladder(100), Backend.getUser() ? Backend.myRating() : null]);
    const uid = Backend.getUser()?.id;
    $('#ladderMe').textContent = me && me.rank
      ? `You: #${me.rank} · ${me.elo} Elo · ${me.wins}W ${me.losses}L ${me.draws}D. Everyone starts at 1000.`
      : 'Count Duel Elo ratings. Everyone starts at 1000; play a ranked match to appear here.';
    t.innerHTML = `<thead><tr><th>#</th><th class="l">Player</th><th>Elo</th><th>Games</th><th>W</th><th>L</th><th>D</th></tr></thead><tbody>${
      rows.length ? rows.map(r => `<tr${r.user_id === uid ? ' class="me"' : ''}><td>${r.rank}</td><td class="l">${r.username}</td><td>${r.elo}</td><td>${r.games}</td><td>${r.wins}</td><td>${r.losses}</td><td>${r.draws}</td></tr>`).join('')
        : '<tr><td class="empty" colspan="7">No ranked games yet.</td></tr>'}</tbody>`;
  } catch (err) {
    t.innerHTML = `<tbody><tr><td class="empty">${err.message}</td></tr></tbody>`;
  }
}

/* ---------- Wiring ---------- */
/** Called by showScreen before switching. Returns false to stay (a live duel cannot be left by navigation). */
export function beforeScreen(name) {
  if (S.screen === 'duel' && D.id && name !== 'duel') return false;
  if (name !== 'ranked') { cancelSearch(); stopInvite(); }
  return true;
}

export function initDuelUI() {
  if (!Backend.enabled) return;
  $('#rankedBtn').addEventListener('click', () => showScreen('ranked'));
  $('#ladderBtn').addEventListener('click', () => showScreen('ladder'));
  $('#rankedBack').addEventListener('click', () => showScreen('settings'));
  $('#ladderBack').addEventListener('click', () => showScreen('settings'));
  $('#historyBtn').addEventListener('click', () => showScreen('history'));
  $('#historyBack').addEventListener('click', () => showScreen('ranked'));
  $('#historyTable').addEventListener('click', e => { const tr = e.target.closest('tr.pick'); if (tr) pickHistory(tr); });
  $('#lobbySignIn').addEventListener('click', () => showScreen('account'));
  $('#findBtn').addEventListener('click', findMatch);
  $('#inviteBtn').addEventListener('click', createInvite);
  $('#inviteCopy').addEventListener('click', copyInvite);
  $('#inviteCancel').addEventListener('click', () => stopInvite());
  $('#acceptBtn').addEventListener('click', acceptChallenge);
  $('#declineBtn').addEventListener('click', declineChallenge);
  $('#cancelSearchBtn').addEventListener('click', cancelSearch);
  $('#keepBtn').addEventListener('click', keepWaiting);
  $('#duelSubmit').addEventListener('click', submitDuel);
  $('#duelEscBtn').addEventListener('click', e => { e.currentTarget.blur(); toggleLeave(true); });
  $('#duelStayBtn').addEventListener('click', () => toggleLeave(false));
  $('#duelLeaveBtn').addEventListener('click', leaveDuel);
  Backend.onChange(({ user, profile }) => {
    // Signed in (and named) from the account screen while holding an invite: back to the challenge.
    if (pending.get() && user && profile && S.screen === 'account') { showScreen('ranked'); return; }
    if (S.screen === 'ranked') renderLobby();
    if (S.screen === 'history') renderHistory();
  });
  if (pending.get() && S.screen === 'settings') showScreen('ranked');   // opened an invite link
}

/** Keyboard for the ranked screens. Returns true when the key was handled. */
export function onDuelKey(e) {
  const k = e.key;
  if (S.screen === 'ranked') {
    if (k === 'Escape') { if (I.code) stopInvite(); else if (Q.searching) cancelSearch(); else showScreen('settings'); return true; }
    if (k === 'Enter' && !e.target.closest('button, a, input') && !e.repeat) {
      e.preventDefault();
      if (!$('#challengeBox').hidden && !$('#acceptBtn').hidden) acceptChallenge(); else if (!I.code) findMatch();
      return true;
    }
    return true;
  }
  if (S.screen === 'ladder') { if (k === 'Escape') showScreen('settings'); return true; }
  if (S.screen === 'history') {
    const tr = e.target.closest && e.target.closest('tr.pick');
    if (k === 'Escape') showScreen('ranked');
    else if (k === 'Enter' && tr) { e.preventDefault(); pickHistory(tr); }
    return true;
  }
  if (S.screen === 'duel') {
    if (k === 'Escape') { e.preventDefault(); if (D.id) toggleLeave(); return true; }
    if (k === 'Enter' && $('#duelLeaveOv').hidden && !$('#duelCheckOv').hidden && !e.target.closest('button')) { e.preventDefault(); submitDuel(); }
    return true;
  }
  return false;
}
