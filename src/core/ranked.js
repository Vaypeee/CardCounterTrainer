/* =========================================================
   RANKED PLAY (pure) — fixed rulesets and the replay verifier.

   A ranked run is: ruleset id + seed (issued by the server) +
   an event log recorded by the client:
     { k: 'card',   t }                 a card was shown (flash / speed)
     { k: 'check',  t, kind, v }        count check answered (periodic | shoe | final)
     { k: 'answer', t, v }              question answered (truecount: number, deviations: H/S/D/P/R)
     { k: 'end',    t }                 session ended
   t = session clock in ms (the clock that excludes count checks and pauses).

   verifyRun() replays the log against the seed with the same core
   rules the trainer uses and recomputes the score. The client's own
   score is never trusted. It runs unchanged in the browser, in tests
   and in the Supabase Edge Function.
   ========================================================= */
import { DEFAULTS } from './config.js';
import { sanitizeSettings } from './settings.js';
import { createRng } from './rng.js';
import { computeResults, genDevQuestion, genTCQuestion } from './engine.js';
import { drawSingle, nextSingleEvent, reshuffle, scheduleCheck, shoeEndKind, startDealt } from './dealt.js';

/* Ranked rules are fixed so every player is judged on the same drill.
   Cosmetic settings (card graphics, sound) stay the player's own. */
const LOCKED = { wheels: false, distraction: false, review: false };
export const RULESETS = {
  'flash-60': {
    mode: 'flash', name: 'Flash Cards', rules: 'Hi-Lo · 6 decks · manual (Space) · checks every 10–30 cards · 60 s',
    settings: { system: 'hilo', decks: 6, manual: true, duration: 60, checksEnabled: true, checkMin: 10, checkMax: 30, penetration: 75 },
  },
  'speed-1d': {
    mode: 'speed', name: 'Speed Count', rules: 'Hi-Lo · 1 deck · fastest correct count',
    settings: { system: 'hilo', decks: 1 },
  },
  'truecount-60': {
    mode: 'truecount', name: 'True Count', rules: 'Hi-Lo · 6 decks · decks to nearest ½ · floor · 60 s',
    settings: { system: 'hilo', decks: 6, duration: 60, deckRounding: 'half', tcRounding: 'floor' },
  },
  'deviations-60': {
    mode: 'deviations', name: 'Deviations', rules: 'Illustrious 18 + Fab 4 · 60 s',
    settings: { duration: 60 },
  },
};
/** Ranked ruleset for a trainer mode (Hands is not ranked). */
export const RANKED_FOR_MODE = Object.fromEntries(Object.entries(RULESETS).map(([id, r]) => [r.mode, id]));
export const lowerIsBetter = id => RULESETS[id]?.mode === 'speed';
/** Higher sort key = better, for every ruleset. */
export const sortKey = (id, score) => (lowerIsBetter(id) ? -score : score);

/** Full settings for a ruleset, keeping the player's cosmetic choices. */
export function rulesetSettings(id, own = {}) {
  const r = RULESETS[id];
  return sanitizeSettings({ ...DEFAULTS, faceUp: own.faceUp ?? DEFAULTS.faceUp, sound: own.sound ?? DEFAULTS.sound,
    ...r.settings, ...LOCKED, mode: r.mode });
}

/* Replay limits. The trainer waits after each answer before the next
   question (feedback delay) and humans cannot press Space every few ms. */
export const LIMITS = {
  maxEvents: 3000,
  tolerance: 50,          // ms of slack on clock comparisons
  minCardGap: 40,         // ms between two manually dealt cards
  minAvgCardGap: 100,     // ms average over a run of 10+ cards
  feedback: { truecount: [650, 1700], deviations: [900, 2200] },   // [after right, after wrong]
};

const fail = reason => ({ ok: false, reason });
const isTime = t => typeof t === 'number' && Number.isFinite(t) && t >= 0;

/**
 * Replay a ranked run. Returns { ok: true, score, results } or { ok: false, reason }.
 * score is null when the run is valid but does not score (e.g. Speed Count with a wrong final count).
 */
export function verifyRun(rulesetId, seed, events) {
  const r = RULESETS[rulesetId];
  if (!r) return fail('unknown ruleset');
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xFFFFFFFF) return fail('bad seed');
  if (!Array.isArray(events) || events.length === 0) return fail('empty log');
  if (events.length > LIMITS.maxEvents) return fail('log too long');
  let prev = 0;
  for (const ev of events) {
    if (!ev || typeof ev !== 'object' || !isTime(ev.t)) return fail('bad event');
    if (ev.t + LIMITS.tolerance < prev) return fail('time went backwards');
    prev = Math.max(prev, ev.t);
  }
  const last = events[events.length - 1];
  if (last.k !== 'end') return fail('log does not end');
  if (events.slice(0, -1).some(ev => ev.k === 'end')) return fail('events after end');
  const st = rulesetSettings(rulesetId);
  return (r.mode === 'truecount' || r.mode === 'deviations')
    ? replayQuestions(r.mode, st, seed, events)
    : replayDealt(r.mode, st, seed, events);
}

function replayDealt(mode, st, seed, events) {
  const T = LIMITS.tolerance;
  const g = { mode, sys: st.system, settings: st, rng: createRng(seed) };
  startDealt(g);       // startSession()
  scheduleCheck(g);    // begin()
  const limit = mode !== 'speed' && st.duration > 0 ? st.duration * 1000 : 0;
  const checks = [], cardTimes = [];
  let finalDone = false, endT = 0;

  for (const ev of events) {
    if (ev.k === 'end') { endT = ev.t; break; }
    if (finalDone) return fail('events after the final check');
    if (limit && ev.t > limit + T) return fail('event after time up');
    if (ev.k === 'card') {
      const next = nextSingleEvent(g);
      if (next !== 'card') return fail(next === 'periodic' ? 'card dealt during a count check' : 'card dealt past the cut card');
      const lastT = cardTimes[cardTimes.length - 1];
      if (lastT != null && ev.t - lastT < LIMITS.minCardGap) return fail('cards dealt too fast');
      cardTimes.push(ev.t);
      drawSingle(g);
    } else if (ev.k === 'check') {
      if (typeof ev.v !== 'number' || !Number.isFinite(ev.v)) return fail('bad answer');
      const next = nextSingleEvent(g);
      const timeUp = limit && ev.t >= limit - T;
      if (ev.kind === 'periodic') { if (next !== 'periodic') return fail('unexpected count check'); }
      else if (ev.kind === 'shoe') { if (next !== 'end' || shoeEndKind(g) !== 'shoe') return fail('unexpected shoe check'); }
      else if (ev.kind === 'final') { if (!timeUp && !(next === 'end' && shoeEndKind(g) === 'final')) return fail('unexpected final check'); }
      else return fail('bad check kind');
      checks.push({ ok: Math.abs(ev.v - g.rc) < 1e-9, ms: 0 });
      if (ev.kind === 'periodic') scheduleCheck(g);
      else if (ev.kind === 'shoe') reshuffle(g);
      else finalDone = true;
    } else return fail('unexpected event');
  }

  if (cardTimes.length >= 10) {
    const avg = (cardTimes[cardTimes.length - 1] - cardTimes[0]) / (cardTimes.length - 1);
    if (avg < LIMITS.minAvgCardGap) return fail('cards dealt too fast');
  }
  if (cardTimes.length && endT + T < cardTimes[cardTimes.length - 1]) return fail('ended before the last card');
  if (limit && endT > limit + T) return fail('ended after time up');
  const results = computeResults({ mode, checks, active: Math.min(endT, limit || endT), cardsSeen: g.cardsSeen, shoeLength: g.shoe.length });
  return { ok: true, score: results.total > 0 ? results.score : null, results };
}

function replayQuestions(mode, st, seed, events) {
  const T = LIMITS.tolerance;
  const rng = createRng(seed);
  const gen = () => (mode === 'truecount' ? genTCQuestion(st, st.system, rng) : genDevQuestion(rng));
  const limit = st.duration * 1000;
  const [okDelay, badDelay] = LIMITS.feedback[mode];
  const checks = [];
  let q = gen(), prevT = null, prevOk = true, endT = 0;

  for (const ev of events) {
    if (ev.k === 'end') { endT = ev.t; break; }
    if (ev.k !== 'answer') return fail('unexpected event');
    if (ev.t > limit + T) return fail('answer after time up');
    if (prevT != null && ev.t < prevT + (prevOk ? okDelay : badDelay) - T) return fail('answered too fast');
    let ok;
    if (mode === 'truecount') {
      if (typeof ev.v !== 'number' || !Number.isFinite(ev.v)) return fail('bad answer');
      ok = Math.abs(ev.v - q.correct) < 1e-9;
    } else {
      if (!q.allowed.includes(ev.v)) return fail('illegal action');
      ok = ev.v === q.correct;
    }
    checks.push({ ok, ms: 0 });
    prevT = ev.t; prevOk = ok;
    q = gen();
  }
  const results = computeResults({ mode, checks, active: Math.min(endT, limit), cardsSeen: 0, shoeLength: 0 });
  return { ok: true, score: results.total > 0 ? results.score : null, results };
}
