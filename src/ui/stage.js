/* =========================================================
   TRAINING STAGE — felt, cards, question panels, HUD,
   timer / progress bar, feedback effects.
   ========================================================= */
import { ACTIONS, MODES, QUESTION_MODES, SYSTEMS, UNTIMED_QUESTIONS } from '../core/config.js';
import { fmtClock, fmtDecks, fmtNum } from '../core/format.js';
import { TC_LABEL, estimateDecks, roundTC } from '../core/engine.js';
import { $, $$ } from '../dom.js';
import { S } from '../state.js';
import { Sound } from '../audio.js';
import { answerDev, isManual, submitTC } from '../session.js';

export function setupStage() {
  const st = S.settings, content = $('#stageContent');
  $('#stage').classList.remove('flash-good', 'flash-bad');
  $('#hudMode').textContent = MODES[S.mode].name;
  $('#hudSys').textContent = S.mode === 'deviations' ? 'Hi-Lo indices' : `${SYSTEMS[S.sys].name} · ${st.decks}D`;
  $('#clockLabel').textContent = S.clock.limit ? 'Time left:' : 'Time:';
  $('#progLabel').textContent = QUESTION_MODES.includes(S.mode) ? 'Score:' : 'Cards left:';
  if (S.mode === 'hands') {
    const seats = Array.from({ length: st.players }, (_, i) =>
      `<div class="seat"><div class="seat-cards" id="seat-${i}"></div><div class="seat-label">Player ${i + 1}</div></div>`).join('');
    content.innerHTML = `<div class="table-hands">
      <div class="seat"><div class="seat-label">Dealer</div><div class="seat-cards" id="seat-D"></div></div>
      <div class="players">${seats}</div></div>`;
  } else if (QUESTION_MODES.includes(S.mode)) {
    content.innerHTML = '';
  } else {
    content.innerHTML = '<div class="single" id="single"></div>';
  }
  const manual = isManual() && !QUESTION_MODES.includes(S.mode);
  $('#nextBtn').hidden = !manual;
  $('#hint').innerHTML = S.mode === 'truecount' ? 'Type the true count, <kbd>Enter</kbd> to submit · <kbd>Esc</kbd> pause'
    : S.mode === 'deviations' ? 'Keys: <kbd>H</kbd> Hit <kbd>S</kbd> Stand <kbd>D</kbd> Double <kbd>P</kbd> Split <kbd>R</kbd> Surrender · <kbd>Esc</kbd> pause'
    : manual ? '<kbd>Space</kbd> or tap for next card · <kbd>Esc</kbd> pause' : '<kbd>Esc</kbd> pause';
  $('#cutMark').hidden = QUESTION_MODES.includes(S.mode) || S.mode === 'speed';
}
export function clearSeats() { $$('.seat-cards', $('#stageContent')).forEach(el => el.replaceChildren()); }

export function cardEl(c, faceDown = false) {
  const el = document.createElement('div');
  if (faceDown) { el.className = 'card back deal'; return el; }
  if (!S.settings.faceUp) {
    el.className = 'card text-only deal' + (c.red ? ' red' : '');
    el.innerHTML = `${c.r}<small>${c.s}</small>`;
    return el;
  }
  const isFace = c.r === 'J' || c.r === 'Q' || c.r === 'K';
  el.className = 'card deal' + (c.red ? ' red' : '');
  el.setAttribute('aria-label', `${c.r} of ${c.s}`);
  el.innerHTML = `<div class="corner tl"><span>${c.r}</span><span>${c.s}</span></div>
    <div class="pip${isFace ? ' face' : ''}">${isFace ? c.r + c.s : c.s}</div>
    <div class="corner br"><span>${c.r}</span><span>${c.s}</span></div>`;
  return el;
}

export function renderTCQuestion(q) {
  S.question = q;
  const roundLbl = { half: 'nearest ½ deck', whole: 'nearest deck', exact: 'exact' }[S.settings.deckRounding];
  const deckTicks = S.settings.decks > 1
    ? `background-image:repeating-linear-gradient(90deg, transparent 0 calc(${100 / S.settings.decks}% - 1px), rgba(0,0,0,.55) calc(${100 / S.settings.decks}% - 1px) ${100 / S.settings.decks}%)` : '';
  $('#stageContent').innerHTML = `<div class="tcq">
    <div class="qpanel">
      <div class="tcq-stats">
        <div class="stat"><span>Running count</span><b>${fmtNum(q.rc)}</b></div>
        <div class="stat"><span>Decks left · ${roundLbl}</span><b>${fmtDecks(q.d)}</b></div>
      </div>
      <div class="shoe-viz" title="Shoe remaining"><div style="width:${Math.min(100, (q.cardsLeft / (S.settings.decks * 52)) * 100)}%;${deckTicks}"></div></div>
    </div>
    <label class="q-label" for="qInput">True count · ${TC_LABEL[S.settings.tcRounding]}</label>
    <div class="answer-row">
      <button class="btn sign" type="button" data-sign="qInput" aria-label="Toggle sign">±</button>
      <div class="prompt"><input type="text" id="qInput" inputmode="decimal" autocomplete="off" spellcheck="false" aria-label="True count"></div>
      <button class="btn primary" type="button" id="qSubmit">OK</button>
    </div>
    <p class="qfeedback" id="qFeedback" aria-live="polite"></p>
  </div>`;
  $('#qSubmit').addEventListener('click', submitTC);
  $('#qInput').focus();
}
export function renderDevQuestion(q) {
  S.question = q;
  $('#stageContent').innerHTML = `<div class="dev">
    <div class="dev-meta"><span class="pill">${q.d.set}</span><span class="pill">${q.d.ls ? 'Late surrender' : 'No surrender'}</span><span class="pill">Shoe · S17 · DAS</span></div>
    <div class="seat"><div class="seat-label">Dealer</div><div class="seat-cards" id="devDealer"></div></div>
    <div class="tc-chip">TC<b>${fmtNum(q.tc)}</b></div>
    <div class="seat"><div class="seat-cards" id="devPlayer"></div><div class="seat-label">You</div></div>
    <div class="dev-actions">${Object.entries(ACTIONS).map(([k, v]) => {
      const ok = q.allowed.includes(k);
      const why = k === 'P' ? 'Only a pair can be split' : 'Surrender is not offered here';
      return `<button class="btn" type="button" data-act="${k}"${ok ? '' : ` disabled title="${why}"`}>${v}<kbd>${k}</kbd></button>`;
    }).join('')}</div>
    <p class="qfeedback" id="qFeedback" aria-live="polite"></p>
  </div>`;
  $('#devDealer').appendChild(cardEl(q.up));
  q.player.forEach(c => $('#devPlayer').appendChild(cardEl(c)));
  $$('.dev-actions .btn').forEach(b => b.addEventListener('click', () => answerDev(b.dataset.act)));
}

export function renderTimer() {
  const c = S.clock, el = $('#timer');
  if (c.limit) {
    const left = Math.max(0, c.limit - c.elapsed);
    el.textContent = fmtClock(Math.ceil(left / 1000));
    el.classList.toggle('low', left <= 10000);
  } else {
    el.textContent = S.mode === 'speed' ? `${(c.elapsed / 1000).toFixed(1)}s` : fmtClock(Math.floor(c.elapsed / 1000));
    el.classList.remove('low');
  }
}
export function updateProgress() {
  const bar = $('#progBar'), text = $('#progText');
  if (QUESTION_MODES.includes(S.mode)) {
    const n = S.checks.length, ok = S.checks.filter(c => c.ok).length;
    if (S.clock.limit) { text.textContent = `${ok}/${n}`; bar.style.width = `${Math.min(100, S.clock.elapsed / S.clock.limit * 100)}%`; }
    else { text.textContent = `${ok}/${n} (of ${UNTIMED_QUESTIONS})`; bar.style.width = `${(n / UNTIMED_QUESTIONS) * 100}%`; }
    return;
  }
  const total = S.shoe.length, left = total - S.shown;
  bar.style.width = `${(S.shown / total) * 100}%`;
  $('#cutMark').style.left = `${(S.cutAt / total) * 100}%`;
  text.textContent = String(left) + (S.shuffles ? ` (shoe ${S.shuffles + 1})` : '');
}
/** "Show running count" HUD (#wheels) — also exposes the true RC to automated tests. */
export function updateWheels() {
  const el = $('#wheels');
  const on = S.settings.wheels && !QUESTION_MODES.includes(S.mode);
  $('#wheelsCell').hidden = !on;
  if (!on) return;
  const d = estimateDecks(S.shoe.length - S.shown, S.settings.deckRounding);
  el.textContent = `RC ${fmtNum(S.rc)} · TC ${fmtNum(roundTC(S.rc / d, S.settings.tcRounding))}`;
}
export function flash(ok) {
  const st = $('#stage');
  st.classList.remove('flash-good', 'flash-bad');
  void st.offsetWidth;
  st.classList.add(ok ? 'flash-good' : 'flash-bad');
  setTimeout(() => st.classList.remove('flash-good', 'flash-bad'), 650);
  ok ? Sound.good() : Sound.bad();
}
export function shake(input) {
  const box = input.closest('.prompt') || input;
  box.classList.remove('shake'); void box.offsetWidth; box.classList.add('shake');
  input.focus();
}
let toastTimer = null;
export function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
}
