/* =========================================================
   SESSION FLOW — countdown, dealing, checks, questions,
   pause / resume, end & scoring. Owns the phase machine in S.
   ========================================================= */
import { ACTIONS, LEVELED_MODES, QUESTION_MODES, UNTIMED_QUESTIONS, levelKeyOf } from './core/config.js';
import { clean, fmtDecks, fmtNum, parseAnswer } from './core/format.js';
import { sanitizeSettings } from './core/settings.js';
import { createRng, randomSeed } from './core/rng.js';
import {
  bestKey, computeResults, genDevQuestion, genTCQuestion, handName, minRoundCards, planRound,
} from './core/engine.js';
import * as Dealt from './core/dealt.js';
import { LIMITS, RULESETS, rulesetSettings } from './core/ranked.js';
import * as Backend from './backend.js';
import { $, $$ } from './dom.js';
import { S, restoreOwnSettings } from './state.js';
import { Store } from './store.js';
import { Sound } from './audio.js';
import { Clock, clearTimers, guard, later } from './timing.js';
import {
  cardEl, clearSeats, flash, renderDevQuestion, renderTCQuestion, renderTimer, setupStage, shake, toast,
  updateProgress, updateWheels,
} from './ui/stage.js';
import { Distraction } from './ui/distraction.js';
import { renderRankedStatus, renderResults } from './ui/results.js';
import { showScreen } from './ui/screens.js';

/* ---------- Shoe & counting ---------- */
export const interval = () => S.settings.speed * 1000;
export const isManual = () => S.mode === 'speed' || S.settings.manual;

/* Shoe & count rules live in core/dealt.js and mutate S directly, so the
   server-side replay (core/ranked.js) draws exactly the same cards. */
function countCard(card) {
  Dealt.countCard(S, card);
  Sound.deal();
  updateWheels();
}

/* ---------- Verified run log (see core/ranked.js for the format) ----------
   Only recorded when the session was started as a server-verified run
   (startSession({ verifiedRuleset })). No UI starts one yet: this is the
   plumbing for the 1v1 ranked mode, where both players get the same seed. */
function logEvent(k, extra) {
  if (!S.ranked) return;
  Clock.update();
  S.log.push({ k, t: Math.round(S.clock.elapsed), ...extra });
}

function scheduleNext(delay) {
  clearTimeout(S.dealTimer);
  if (isManual()) return;
  S.dealTimer = setTimeout(guard(step), delay);
}

/** Global 100 ms tick: refreshes the timer and fires onTimeUp(). Call once at init. */
export function startTicker() {
  setInterval(() => {
    if (S.screen !== 'train') return;
    Clock.update();
    renderTimer();
    const c = S.clock;
    if (c.limit && c.elapsed >= c.limit && (S.phase === 'dealing' || S.phase === 'question')) onTimeUp();
  }, 100);
}

/* ---------- Start ---------- */
/** Start a session. Buttons call it with a click event (a normal training session);
    startSession({ verifiedRuleset: 'flash-60' }) starts a server-verified run instead. */
export async function startSession(opts) {
  if (S.starting) return;
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); // commits pending number inputs
  restoreOwnSettings();
  sanitizeSettings(S.settings);
  Sound.ensure(); // unlock audio inside the user gesture

  // Verified run: the server issues the seed, and the fixed rules replace the player's settings for this run.
  let ranked = null;
  const id = opts && RULESETS[opts.verifiedRuleset] ? opts.verifiedRuleset : null;
  if (id && Backend.enabled) {
    if (!Backend.getUser() || !Backend.getProfile()) { showScreen('account'); return; }
    S.starting = true;
    $('#rankedNote').textContent = 'Starting ranked run…';
    try {
      const run = await Backend.startRun(id);
      ranked = { id, runId: run.runId, seed: run.seed };
      $('#rankedNote').textContent = '';
    } catch (err) {
      $('#rankedNote').textContent = `Could not start a ranked run: ${err.message}`;
      return;
    } finally { S.starting = false; }
    S.ownSettings = S.settings;
    S.settings = rulesetSettings(id, S.ownSettings);
  }

  const st = S.settings;
  clearTimers();
  Distraction.stop();
  S.sessionId++;
  S.mode = st.mode;
  S.sys = st.mode === 'deviations' ? 'hilo' : st.system;
  S.ranked = ranked;
  S.log = [];
  S.seed = ranked ? ranked.seed : randomSeed();
  S.rng = createRng(S.seed);
  Object.assign(S, {
    phase: 'idle', resumePhase: null, pauseRequested: false, shuffles: 0,
    cardsSeen: 0, rcTrace: [], checks: [], nextCheckAt: Infinity, checkKind: null,
    question: null, round: null, timeUp: false,
    clock: { elapsed: 0, last: 0, running: false, limit: (st.duration > 0 && S.mode !== 'speed') ? st.duration * 1000 : 0 },
  });
  if (!QUESTION_MODES.includes(S.mode)) Dealt.startDealt(S);

  showScreen('train');
  setupStage();
  renderTimer();
  updateProgress();
  updateWheels();
  startCountdown(begin);
}

function startCountdown(done) {
  S.phase = 'countdown';
  const ov = $('#countdownOv'), num = $('#countNum');
  const showIrc = !QUESTION_MODES.includes(S.mode);
  $('#countIrc').innerHTML = showIrc ? `Starting running count: <b>${fmtNum(S.irc)}</b>` : '';
  $('#countHint').textContent = S.mode === 'speed' ? 'Press Space (or tap) for each card — as fast as you can.'
    : (isManual() && !QUESTION_MODES.includes(S.mode)) ? 'Press Space (or tap) for each card.' : 'Get ready…';
  ov.hidden = false;
  let n = 3;
  const tick = guard(() => {
    if (n === 0) { ov.hidden = true; done(); return; }
    num.textContent = n;
    num.classList.remove('pop'); void num.offsetWidth; num.classList.add('pop');
    n--;
    S.fxTimer = setTimeout(tick, 550);
  });
  tick();
}

function begin() {
  Distraction.start();
  if (QUESTION_MODES.includes(S.mode)) {
    Clock.start();
    nextQuestion();
  } else {
    S.phase = 'dealing';
    Dealt.scheduleCheck(S);
    Clock.start();
    step();
  }
  if (S.pauseRequested) { S.pauseRequested = false; pause(); }
}

/* ---------- Dealing ---------- */
/** One dealing tick (flash / speed: one card; hands: one action). */
export function step() {
  if (S.phase !== 'dealing') return;
  clearTimeout(S.dealTimer);
  if (S.mode === 'hands') return stepHands();

  const next = Dealt.nextSingleEvent(S);
  if (next === 'periodic') return startCheck('periodic');
  if (next === 'end') return shoeEnd();
  const c = Dealt.drawSingle(S);
  Sound.deal();
  updateWheels();
  logEvent('card');
  $('#single').replaceChildren(cardEl(c));
  updateProgress();
  scheduleNext(interval());
}

function stepHands() {
  if (!S.round || S.round.queue.length === 0) {
    // Between rounds: checks, cut card, or a new round.
    if (Dealt.periodicDue(S)) return startCheck('periodic');
    if (S.pos >= S.cutAt || S.shoe.length - S.pos < minRoundCards(S.settings.players)) return shoeEnd();
    const planned = planRound(S.shoe, S.pos, S.settings);
    S.pos = planned.pos;
    S.round = { queue: planned.queue, holeEl: null };
    clearSeats();
  }
  const a = S.round.queue.shift();
  if (a.t === 'card') {
    S.shown++;
    const el = cardEl(a.c, a.down);
    $('#seat-' + a.seat).appendChild(el);
    if (a.down) { S.round.holeEl = el; Sound.deal(); }
    else countCard(a.c);
  } else if (a.t === 'reveal') {
    const face = cardEl(a.c);
    face.classList.remove('deal'); face.classList.add('flip');
    if (S.round.holeEl) S.round.holeEl.replaceWith(face);
    countCard(a.c);
  }
  updateProgress();
  // Hold the completed table a little longer before the next round.
  scheduleNext(S.round.queue.length === 0 ? Math.max(interval() * 2, 900) : interval());
}

/** Cut card / empty shoe reached. */
function shoeEnd() {
  const kind = Dealt.shoeEndKind(S);
  if (kind === 'reshuffle') reshuffle(); else startCheck(kind);
}
function reshuffle() {
  Dealt.reshuffle(S);
  if (S.mode === 'hands') clearSeats(); else $('#single').replaceChildren();
  toast(`Shuffle — new shoe. Count resets to ${fmtNum(S.irc)}.`);
  updateProgress();
  updateWheels();
  resumeDealing(Math.max(interval(), 1200));
}
function resumeDealing(delay) {
  S.phase = 'dealing';
  Clock.start();
  scheduleNext(delay);
  if (S.pauseRequested) { S.pauseRequested = false; pause(); }
}

function onTimeUp() {
  Clock.stop();
  S.clock.elapsed = S.clock.limit;
  S.timeUp = true;
  renderTimer();
  if (S.phase === 'dealing') { clearTimeout(S.dealTimer); startCheck('final'); }
  else if (S.phase === 'question') endSession();
}

/* ---------- Count checks ---------- */
function startCheck(kind) {
  clearTimeout(S.dealTimer);
  Clock.stop();
  S.phase = 'check';
  S.checkKind = kind;
  S.checkStart = performance.now();
  const titles = {
    periodic: "What's the running count?",
    shoe: 'Cut card! Running count?',
    final: S.mode === 'speed' ? 'Shoe done! Final running count?' : S.timeUp ? "Time's up! Final running count?" : 'Shoe complete! Final running count?',
  };
  $('#checkTitle').textContent = titles[kind];
  $('#checkMeta').textContent = `${kind === 'periodic' ? 'Count check' : kind === 'shoe' ? 'End of shoe' : 'Final check'} · card ${S.cardsSeen}`;
  const input = $('#checkInput');
  input.value = '';
  input.disabled = false;
  $('#checkFb').textContent = '';
  $('#checkFb').className = 'fb';
  $('#checkOv').hidden = false;
  setTimeout(() => { if (S.phase === 'check') input.focus(); }, 30);
}
export function submitCheck() {
  if (S.phase !== 'check') return;
  const input = $('#checkInput');
  const v = parseAnswer(input.value);
  if (v === null) { shake(input); return; }
  const correct = S.rc, ok = Math.abs(v - correct) < 1e-9;
  S.checks.push({ x: S.cardsSeen, label: String(S.cardsSeen), answer: v, correct, ok, ms: performance.now() - S.checkStart });
  logEvent('check', { kind: S.checkKind, v });
  S.phase = 'feedback';
  input.disabled = true;
  const fb = $('#checkFb');
  fb.className = 'fb ' + (ok ? 'good' : 'bad');
  fb.textContent = ok ? `✓ Correct — ${fmtNum(correct)}` : `✗ It was ${fmtNum(correct)} (you said ${fmtNum(v)})`;
  flash(ok);
  const kind = S.checkKind;
  later(() => {
    $('#checkOv').hidden = true;
    if (kind === 'final') return endSession();
    if (kind === 'shoe') return reshuffle();
    Dealt.scheduleCheck(S);
    resumeDealing(400);
  }, ok ? 750 : 1600);
}

/* ---------- Question modes ---------- */
/** After a question is answered: auto-advance, or (Training option) stop on a
    mistake with the clock frozen until the user presses Continue. */
function afterAnswer(ok, okMs, wrongMs) {
  if (ok || !S.settings.review) { later(nextQuestion, ok ? okMs : wrongMs); return; }
  Clock.stop();
  S.phase = 'review';
  const btn = document.createElement('button');
  btn.className = 'btn primary';
  btn.type = 'button';
  btn.id = 'contBtn';
  btn.innerHTML = 'Continue <kbd>Enter</kbd>';
  btn.style.alignSelf = 'center';
  btn.addEventListener('click', continueReview);
  $('#qFeedback').after(btn);
  setTimeout(() => { if (S.phase === 'review') btn.focus(); }, 30);
  if (S.pauseRequested) { S.pauseRequested = false; pause(); }
}
export function continueReview() {
  if (S.phase !== 'review') return;
  Clock.start();
  nextQuestion();
}
function nextQuestion() {
  const c = S.clock;
  if (c.limit && c.elapsed >= c.limit) { S.phase = 'question'; return onTimeUp(); }
  if (!c.limit && S.checks.length >= UNTIMED_QUESTIONS) return endSession();
  S.phase = 'question';
  S.qStart = performance.now();
  if (S.mode === 'truecount') renderTCQuestion(genTCQuestion(S.settings, S.sys, S.rng));
  else renderDevQuestion(genDevQuestion(S.rng));
  updateProgress();
  if (S.pauseRequested) { S.pauseRequested = false; pause(); }
}
export function submitTC() {
  if (S.phase !== 'question' || S.mode !== 'truecount') return;
  const input = $('#qInput');
  const v = parseAnswer(input.value);
  if (v === null) { shake(input); return; }
  const q = S.question, ok = Math.abs(v - q.correct) < 1e-9;
  const n = S.checks.length + 1;
  S.checks.push({ x: n, label: 'Q' + n, situation: `${fmtNum(q.rc)} ÷ ${fmtDecks(q.d)}`, answer: v, correct: q.correct, ok, ms: performance.now() - S.qStart });
  logEvent('answer', { v });
  S.phase = 'feedback';
  input.disabled = true;
  const fb = $('#qFeedback');
  fb.className = 'qfeedback ' + (ok ? 'good' : 'bad');
  fb.textContent = `${ok ? '✓' : '✗'} True count ${fmtNum(q.correct)}  (${fmtNum(q.rc)} ÷ ${fmtDecks(q.d)} = ${clean(q.rc / q.d).toFixed(2)})`;
  flash(ok);
  afterAnswer(ok, ...LIMITS.feedback.truecount);
}
export function answerDev(key) {
  if (S.phase !== 'question' || S.mode !== 'deviations' || !ACTIONS[key]) return;
  if (!S.question.allowed.includes(key)) return;   // illegal action (e.g. split a non-pair)
  const q = S.question, ok = key === q.correct;
  const n = S.checks.length + 1;
  S.checks.push({ x: n, label: 'Q' + n, situation: `${handName(q.d)} @ TC ${fmtNum(q.tc)}`, answer: ACTIONS[key], correct: ACTIONS[q.correct], ok, ms: performance.now() - S.qStart });
  logEvent('answer', { v: key });
  S.phase = 'feedback';
  $$('.dev-actions .btn').forEach(b => {
    b.disabled = true;
    if (b.dataset.act === q.correct) b.classList.add('right');
    else if (b.dataset.act === key) b.classList.add('wrong');
  });
  const fb = $('#qFeedback');
  fb.className = 'qfeedback ' + (ok ? 'good' : 'bad');
  fb.textContent = `${handName(q.d)}: ${ACTIONS[q.d.yes]} at TC ≥ ${fmtNum(q.d.idx)}, otherwise ${ACTIONS[q.d.no]}.`;
  flash(ok);
  afterAnswer(ok, ...LIMITS.feedback.deviations);
}

/* ---------- Pause / resume / quit ---------- */
export function pause() {
  if (!['dealing', 'check', 'question', 'review'].includes(S.phase)) {
    if (S.phase === 'feedback' || S.phase === 'countdown') S.pauseRequested = true;
    return;
  }
  S.resumePhase = S.phase;
  S.phase = 'paused';
  S.pausedAt = performance.now();
  Clock.stop();
  clearTimeout(S.dealTimer);
  Distraction.stop();
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  $('#screen-train').classList.add('is-paused');
  $('#pauseOv').hidden = false;
}
export function resume() {
  if (S.phase !== 'paused') return;
  const away = performance.now() - S.pausedAt;
  S.checkStart += away;   // don't count paused time against answer times
  S.qStart += away;
  S.phase = S.resumePhase;
  $('#pauseOv').hidden = true;
  $('#screen-train').classList.remove('is-paused');
  Distraction.start();
  if (S.phase === 'dealing') { Clock.start(); scheduleNext(Math.min(interval(), 600)); }
  else if (S.phase === 'check') { $('#checkInput').focus(); }
  else if (S.phase === 'question') { Clock.start(); const qi = $('#qInput'); if (qi) qi.focus(); }
  else if (S.phase === 'review') { const cb = $('#contBtn'); if (cb) cb.focus(); }   // clock stays stopped
}
export function togglePause() { S.phase === 'paused' ? resume() : pause(); }
export function autoPause() {
  if (S.screen !== 'train') return;
  if (['dealing', 'check', 'question', 'review'].includes(S.phase)) pause();
  else if (S.phase === 'feedback' || S.phase === 'countdown') S.pauseRequested = true;
}
function stopSession() {
  S.sessionId++;
  clearTimers();
  Clock.stop();
  Distraction.stop();
  ['#pauseOv', '#checkOv', '#countdownOv'].forEach(s => { $(s).hidden = true; });
  $('#screen-train').classList.remove('is-paused');
}
export function quitToSettings() { stopSession(); S.phase = 'idle'; showScreen('settings'); }

/* ---------- End & scoring ---------- */
export function endSession() {
  stopSession();
  S.phase = 'ended';
  const R = computeResults({ mode: S.mode, checks: S.checks, active: S.clock.elapsed, cardsSeen: S.cardsSeen, shoeLength: S.shoe.length });
  const key = bestKey(S.mode, S.sys, S.settings);
  const bests = Store.get('bests', {});
  const prev = bests[key] ? bests[key].score : null;
  let isNewBest = false;
  if (R.score != null && R.total > 0) {
    const better = prev == null || (R.lowerIsBetter ? R.score < prev : R.score > prev);
    if (better) { bests[key] = { score: R.score, t: Date.now() }; Store.set('bests', bests); isNewBest = true; }
  }
  R.best = isNewBest ? R.score : prev;
  R.isNewBest = isNewBest;
  if (R.total > 0) {
    const hist = Store.get('history', []);
    hist.push({ t: Date.now(), mode: S.mode, sys: S.sys, decks: S.settings.decks, acc: R.acc, cpm: R.cpm, score: R.score, total: R.total, correct: R.correct, cards: S.cardsSeen, ms: R.totalMs,
                level: LEVELED_MODES.includes(S.mode) ? levelKeyOf(S.settings) : null });
    Store.set('history', hist.slice(-100));
  }
  renderResults(R);
  showScreen('results');
  if (S.ranked) submitRanked(S.ranked, S.log);
}

/** Send a finished ranked run to the server, which replays it and records the verified score. */
async function submitRanked(ranked, log) {
  logEventTo(log, 'end');
  const id = S.sessionId;
  renderRankedStatus({ state: 'pending' });
  try {
    const res = await Backend.submitRun(ranked.runId, log);
    if (id === S.sessionId) renderRankedStatus({ state: res.status, ...res, ruleset: ranked.id });
  } catch (err) {
    if (id === S.sessionId) renderRankedStatus({ state: 'error', reason: err.message });
  }
}
function logEventTo(log, k) { log.push({ k, t: Math.round(S.clock.elapsed) }); }
