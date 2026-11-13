import { describe, expect, test } from 'bun:test';
import { createRng } from '../src/core/rng.js';
import { RULESETS, rulesetSettings, verifyRun, LIMITS } from '../src/core/ranked.js';
import { drawSingle, nextSingleEvent, reshuffle, scheduleCheck, shoeEndKind, startDealt } from '../src/core/dealt.js';
import { genDevQuestion, genTCQuestion } from '../src/core/engine.js';

/* A simulated player that follows the same rules as the trainer and logs like session.js.
   `answer(rc)` decides what the player answers at a check. */
function playDealt(rulesetId, seed, { gap = 300, answer = rc => rc } = {}) {
  const st = rulesetSettings(rulesetId), mode = RULESETS[rulesetId].mode;
  const g = { mode, sys: st.system, settings: st, rng: createRng(seed) };
  startDealt(g); scheduleCheck(g);
  const limit = mode === 'speed' ? 0 : st.duration * 1000;
  const log = [];
  let t = 0;
  for (;;) {
    if (limit && t >= limit) { log.push({ k: 'check', kind: 'final', v: answer(g.rc), t: limit }); t = limit; break; }
    const next = nextSingleEvent(g);
    if (next === 'card') { drawSingle(g); log.push({ k: 'card', t }); t += gap; continue; }
    const kind = next === 'periodic' ? 'periodic' : shoeEndKind(g);
    log.push({ k: 'check', kind, v: answer(g.rc), t });
    if (kind === 'final') break;
    if (kind === 'periodic') scheduleCheck(g); else reshuffle(g);
  }
  log.push({ k: 'end', t });
  return log;
}
function playQuestions(rulesetId, seed, { wrongEvery = 0, think = 400 } = {}) {
  const st = rulesetSettings(rulesetId), mode = RULESETS[rulesetId].mode, rng = createRng(seed);
  const [okDelay, badDelay] = LIMITS.feedback[mode];
  const log = [];
  let t = think, n = 0;
  while (t <= 60000) {
    const q = mode === 'truecount' ? genTCQuestion(st, st.system, rng) : genDevQuestion(rng);
    const wrong = wrongEvery && ++n % wrongEvery === 0;
    let v = q.correct;
    if (wrong) v = mode === 'truecount' ? q.correct + 1 : q.allowed.find(a => a !== q.correct);
    log.push({ k: 'answer', v, t });
    t += (wrong ? badDelay : okDelay) + think;
  }
  log.push({ k: 'end', t: 60000 });
  return log;
}

describe('verifyRun: honest runs', () => {
  test('Flash Cards: perfect run scores cards/min × accuracy', () => {
    const log = playDealt('flash-60', 123);
    const r = verifyRun('flash-60', 123, log);
    expect(r.ok).toBe(true);
    expect(r.results.acc).toBe(100);
    expect(r.score).toBe(200);   // one card every 300 ms = 200 cards/min
  });
  test('Flash Cards: a run long enough to reach the cut card reshuffles correctly', () => {
    const r = verifyRun('flash-60', 9, playDealt('flash-60', 9, { gap: 150 }));
    expect(r.ok).toBe(true);
    expect(r.results.acc).toBe(100);
  });
  test('Flash Cards: wrong answers lower the score but the run stays valid', () => {
    let i = 0;
    const r = verifyRun('flash-60', 5, playDealt('flash-60', 5, { answer: rc => (i++ % 2 ? rc + 1 : rc) }));
    expect(r.ok).toBe(true);
    expect(r.results.acc).toBeLessThan(100);
  });
  test('Speed Count: time is the score, only with the right final count', () => {
    expect(verifyRun('speed-1d', 77, playDealt('speed-1d', 77, { gap: 200 })).score).toBe(10.4);
    const wrong = verifyRun('speed-1d', 77, playDealt('speed-1d', 77, { gap: 200, answer: rc => rc + 1 }));
    expect(wrong.ok).toBe(true);
    expect(wrong.score).toBe(null);
  });
  test('True Count and Deviations: score = correct answers', () => {
    const tc = verifyRun('truecount-60', 42, playQuestions('truecount-60', 42, { wrongEvery: 4 }));
    expect(tc.ok).toBe(true);
    expect(tc.score).toBe(tc.results.correct);
    expect(tc.results.total - tc.results.correct).toBeGreaterThan(0);
    const dev = verifyRun('deviations-60', 42, playQuestions('deviations-60', 42));
    expect(dev.ok).toBe(true);
    expect(dev.results.acc).toBe(100);
  });
});

describe('verifyRun: tampered runs are rejected', () => {
  test('a log replayed against another seed fails the count checks', () => {
    const log = playDealt('flash-60', 1);
    const r = verifyRun('flash-60', 2, log);
    expect(r.ok && r.results.acc === 100).toBe(false);
  });
  test('skipping a count check', () => {
    const log = playDealt('flash-60', 3).filter(e => e.kind !== 'periodic');
    expect(verifyRun('flash-60', 3, log)).toEqual({ ok: false, reason: 'card dealt during a count check' });
  });
  test('impossible card speed', () => {
    expect(verifyRun('speed-1d', 4, playDealt('speed-1d', 4, { gap: 20 })).reason).toBe('cards dealt too fast');
    expect(verifyRun('speed-1d', 4, playDealt('speed-1d', 4, { gap: 60 })).reason).toBe('cards dealt too fast');
  });
  test('answering questions faster than the trainer allows', () => {
    const log = playQuestions('truecount-60', 8, { think: 0 }).map((e, i) => (e.k === 'answer' ? { ...e, t: i * 300 } : e));
    expect(verifyRun('truecount-60', 8, log).reason).toBe('answered too fast');
  });
  test('answers after time up, illegal actions, malformed logs', () => {
    const late = playQuestions('truecount-60', 8);
    late.splice(late.length - 1, 0, { k: 'answer', v: 0, t: 70000 });
    expect(verifyRun('truecount-60', 8, late).ok).toBe(false);
    const dev = playQuestions('deviations-60', 8);
    dev[0] = { ...dev[0], v: 'X' };
    expect(verifyRun('deviations-60', 8, dev).reason).toBe('illegal action');
    expect(verifyRun('flash-60', 1, []).ok).toBe(false);
    expect(verifyRun('flash-60', 1, [{ k: 'card', t: 0 }]).reason).toBe('log does not end');
    expect(verifyRun('nope', 1, [{ k: 'end', t: 0 }]).reason).toBe('unknown ruleset');
    expect(verifyRun('flash-60', -1, [{ k: 'end', t: 0 }]).reason).toBe('bad seed');
  });
  test('a claimed final check before time is up', () => {
    const log = playDealt('flash-60', 6).slice(0, 20);
    log.push({ k: 'check', kind: 'final', v: 0, t: 5000 }, { k: 'end', t: 5000 });
    expect(verifyRun('flash-60', 6, log).ok).toBe(false);
  });
});

test('ranked rules override the player settings except cosmetics', () => {
  const st = rulesetSettings('flash-60', { faceUp: false, sound: true, wheels: true, decks: 2 });
  expect(st).toMatchObject({ mode: 'flash', decks: 6, manual: true, wheels: false, faceUp: false, sound: true, duration: 60 });
});
