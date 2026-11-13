/* =========================================================
   EVENTS — buttons, keyboard shortcuts, auto-pause.
   Keyboard-first: Enter = start/submit/continue, Space = next
   card, Esc = pause/back, 1–5 = mode, H/S/D/P/R = actions.
   ========================================================= */
import { ACTIONS, MODES } from './core/config.js';
import { $ } from './dom.js';
import { S } from './state.js';
import { Store } from './store.js';
import {
  answerDev, autoPause, continueReview, endSession, isManual, quitToSettings, resume, startSession, step,
  submitCheck, submitTC, togglePause,
} from './session.js';
import { showScreen } from './ui/screens.js';
import { setSetting } from './ui/settings.js';
import { renderStats } from './ui/stats.js';
import { bindThemeToggle } from './theme.js';
import { onDuelKey } from './ui/duel.js';

export function bindEvents() {
  $('#startBtn').addEventListener('click', startSession);
  $('#againBtn').addEventListener('click', startSession);
  $('#backBtn').addEventListener('click', () => showScreen('settings'));
  $('#statsBtn').addEventListener('click', () => showScreen('stats'));
  $('#statsBack').addEventListener('click', () => showScreen('settings'));
  $('#accountBtn').addEventListener('click', () => showScreen('account'));
  $('#accountBack').addEventListener('click', () => showScreen('settings'));
  $('#brandBtn').addEventListener('click', () => { if (S.screen !== 'train') showScreen('settings'); });
  bindThemeToggle($('#themeBtn'));
  $('#statsFilter').addEventListener('change', renderStats);
  $('#statsLevel').addEventListener('change', renderStats);
  $('#clearBtn').addEventListener('click', () => {
    if (confirm('Clear all session history and personal bests? This cannot be undone.')) {
      Store.set('history', []); Store.set('bests', {}); renderStats();
    }
  });
  $('#pauseBtn').addEventListener('click', e => { e.currentTarget.blur(); togglePause(); });
  $('#resumeBtn').addEventListener('click', resume);
  $('#endBtn').addEventListener('click', endSession);
  $('#quitBtn').addEventListener('click', quitToSettings);
  $('#checkSubmit').addEventListener('click', submitCheck);
  $('#nextBtn').addEventListener('click', e => { e.currentTarget.blur(); if (S.phase === 'dealing' && isManual()) step(); });
  // Tap the felt for next card (manual modes).
  $('#stage').addEventListener('click', e => {
    if (e.target.closest('.overlay, button, input')) return;
    if (S.phase === 'dealing' && isManual()) step();
  });
  // ± buttons for mobile keyboards without a minus key.
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-sign]');
    if (!b) return;
    const input = document.getElementById(b.dataset.sign);
    if (!input || input.disabled) return;
    const v = input.value.trim();
    input.value = v.startsWith('-') || v.startsWith('−') ? v.slice(1) : '-' + v.replace(/^\+/, '');
    input.focus();
  });

  document.addEventListener('keydown', onKey);
  // Prevent Space from "clicking" a focused button while training.
  document.addEventListener('keyup', e => {
    if (S.screen === 'train' && e.code === 'Space' && !e.target.matches('input')) e.preventDefault();
  });
  window.addEventListener('blur', autoPause);
  document.addEventListener('visibilitychange', () => { if (document.hidden) autoPause(); });
}

function onKey(ev) {
  const key = ev.key;
  // Normalise the target so .closest() is always available (events dispatched on document have no Element target).
  const e = { key, repeat: ev.repeat, code: ev.code, ctrlKey: ev.ctrlKey, metaKey: ev.metaKey, altKey: ev.altKey,
              target: ev.target instanceof Element ? ev.target : document.body, preventDefault: () => ev.preventDefault() };
  if (onDuelKey(e)) return;
  if (S.screen === 'settings') {
    if (key === 'Enter' && !e.target.closest('button, a, textarea')) { e.preventDefault(); startSession(); }
    // 1–5 pick a training mode (when not typing in a field).
    else if (/^[1-5]$/.test(key) && !e.target.closest('input, select') && !e.ctrlKey && !e.metaKey && !e.altKey) {
      setSetting('mode', Object.keys(MODES)[Number(key) - 1]);
    }
    return;
  }
  if (S.screen === 'results') {
    if (e.repeat) return;
    if (key === 'Enter' && !e.target.closest('button')) { e.preventDefault(); startSession(); }
    else if (key === 'Escape') showScreen('settings');
    return;
  }
  if (S.screen === 'stats' || S.screen === 'account') { if (key === 'Escape') showScreen('settings'); return; }

  // ---- training screen ----
  if (key === 'Escape') {
    e.preventDefault();
    if (S.phase === 'countdown') quitToSettings(); else togglePause();
    return;
  }
  if (S.phase === 'paused') {
    if (key === 'Enter' || key === ' ') { e.preventDefault(); if (!e.target.closest('button')) resume(); }
    return;
  }
  if (S.phase === 'review') {
    if ((key === 'Enter' || key === ' ') && !e.repeat) { e.preventDefault(); continueReview(); }
    return;
  }
  if (S.phase === 'check') { if (key === 'Enter') { e.preventDefault(); submitCheck(); } return; }
  if (S.phase === 'question' && S.mode === 'truecount') { if (key === 'Enter') { e.preventDefault(); submitTC(); } return; }
  if (S.phase === 'question' && S.mode === 'deviations') {
    const k = key.toUpperCase();
    if (ACTIONS[k] && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); answerDev(k); }
    return;
  }
  if (key === ' ' || e.code === 'Space') {
    e.preventDefault();
    if (e.repeat) return;                 // no auto-repeat flipping
    if (S.phase === 'dealing' && isManual()) step();
  }
}
