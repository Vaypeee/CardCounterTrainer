import { describe, expect, test } from 'bun:test';
import { DEFAULTS, DEVIATIONS, SYSTEMS } from '../src/core/config.js';
import { createRng } from '../src/core/rng.js';
import { fmtNum, parseAnswer } from '../src/core/format.js';
import { sanitizeSettings } from '../src/core/settings.js';
import {
  bestKey, buildShoe, computeResults, cutPosition, estimateDecks, genDevQuestion, genTCQuestion, handTotal,
  planRound, roundTC, tagOf,
} from '../src/core/engine.js';

const settings = over => sanitizeSettings({ ...DEFAULTS, ...over });
const ids = shoe => shoe.map(c => c.r + c.s).join(' ');

describe('rng', () => {
  test('same seed gives the same sequence', () => {
    const a = createRng(42), b = createRng(42);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });
  test('values stay in [0, 1) and int() is inclusive', () => {
    const r = createRng(7), seen = new Set();
    for (let i = 0; i < 5000; i++) {
      const x = r.next();
      expect(x >= 0 && x < 1).toBe(true);
      seen.add(r.int(-3, 3));
    }
    expect([...seen].sort((x, y) => x - y)).toEqual([-3, -2, -1, 0, 1, 2, 3]);
  });
});

describe('shoe', () => {
  test('is deterministic per seed and differs across seeds', () => {
    expect(ids(buildShoe(6, createRng(1)))).toBe(ids(buildShoe(6, createRng(1))));
    expect(ids(buildShoe(6, createRng(1)))).not.toBe(ids(buildShoe(6, createRng(2))));
  });
  test('contains every card exactly `decks` times', () => {
    const shoe = buildShoe(2, createRng(3));
    expect(shoe.length).toBe(104);
    const counts = {};
    for (const c of shoe) counts[c.r + c.s] = (counts[c.r + c.s] || 0) + 1;
    expect(Object.keys(counts).length).toBe(52);
    expect(Object.values(counts).every(n => n === 2)).toBe(true);
  });
  test('a full shoe ends at 0 for balanced systems and at +4 for KO', () => {
    for (const [key, sys] of Object.entries(SYSTEMS)) {
      for (const decks of [1, 2, 6, 8]) {
        const end = buildShoe(decks, createRng(decks)).reduce((rc, c) => rc + tagOf(key, c), sys.irc(decks));
        expect(Math.round(end * 1e9) / 1e9).toBe(sys.balanced ? 0 : 4);
      }
    }
  });
  test('cut card respects penetration except in Speed Count', () => {
    expect(cutPosition(312, 'flash', 75)).toBe(234);
    expect(cutPosition(312, 'speed', 75)).toBe(312);
  });
});

describe('true count', () => {
  test('deck estimates', () => {
    expect(estimateDecks(130, 'half')).toBe(2.5);
    expect(estimateDecks(10, 'half')).toBe(0.5);
    expect(estimateDecks(130, 'whole')).toBe(3);
    expect(estimateDecks(130, 'exact')).toBe(2.5);
  });
  test('rounding modes', () => {
    expect(roundTC(-1.5, 'floor')).toBe(-2);
    expect(roundTC(-1.5, 'trunc')).toBe(-1);
    expect(roundTC(-1.5, 'round')).toBe(-2);
    expect(Object.is(roundTC(-0.2, 'trunc'), 0)).toBe(true);
  });
  test('generated questions are self-consistent', () => {
    const st = settings({ mode: 'truecount' }), rng = createRng(9);
    for (let i = 0; i < 200; i++) {
      const q = genTCQuestion(st, 'hilo', rng);
      expect(q.cardsLeft).toBeGreaterThanOrEqual(26);
      expect(q.correct).toBe(roundTC(q.rc / q.d, st.tcRounding));
    }
  });
});

describe('hands', () => {
  test('soft and hard totals', () => {
    const c = r => ({ r });
    expect(handTotal([c('A'), c('6')])).toEqual({ total: 17, soft: true });
    expect(handTotal([c('A'), c('6'), c('K')])).toEqual({ total: 17, soft: false });
    expect(handTotal([c('A'), c('A'), c('9')])).toEqual({ total: 21, soft: true });
  });
  test('planned rounds draw cards in shoe order and hide only the hole card', () => {
    const shoe = buildShoe(6, createRng(5)), st = settings({ mode: 'hands', players: 3 });
    const { queue, pos } = planRound(shoe, 0, st);
    const dealt = queue.filter(a => a.t === 'card').map(a => a.c);
    expect(dealt).toEqual(shoe.slice(0, pos));
    expect(queue.filter(a => a.down).length).toBe(1);
    expect(queue.filter(a => a.t === 'reveal').length).toBe(1);
  });
});

describe('deviations', () => {
  test('answers and legal actions follow the index table', () => {
    const rng = createRng(11);
    for (let i = 0; i < 500; i++) {
      const q = genDevQuestion(rng);
      expect(q.correct).toBe(q.tc >= q.d.idx ? q.d.yes : q.d.no);
      expect(q.allowed.includes('P')).toBe(q.d.hand === 'TT');
      expect(q.allowed.includes('R')).toBe(q.d.ls);
      expect(q.allowed.includes(q.correct)).toBe(true);
    }
    expect(DEVIATIONS.length).toBe(21);
  });
});

describe('settings & scoring', () => {
  test('sanitize clamps values and derives the level from the speed', () => {
    const st = settings({ speed: 0.5, players: 12, penetration: 99, checkMin: 40, checkMax: 20, decks: 3 });
    expect(st.level).toBe('hard');
    expect(st.players).toBe(7);
    expect(st.penetration).toBe(95);
    expect(st.checkMax).toBe(40);
    expect(st.decks).toBe(6);
    expect(settings({ speed: 0.7 }).level).toBe('custom');
  });
  test('best keys keep the stored format', () => {
    expect(bestKey('flash', 'hilo', settings({ speed: 0.5 }))).toBe('flash|hilo|6|hard');
    expect(bestKey('hands', 'ko', settings({ speed: 0.7 }))).toBe('hands|ko|6|custom-0.7');
    expect(bestKey('flash', 'hilo', settings({ manual: true }))).toBe('flash|hilo|6|manual');
    expect(bestKey('truecount', 'hilo', settings({}))).toBe('truecount|hilo|6|half|floor');
    expect(bestKey('speed', 'zen', settings({ decks: 1 }))).toBe('speed|zen|1');
    expect(bestKey('deviations', 'hilo', settings({}))).toBe('deviations');
  });
  test('Speed Count only scores a fully dealt shoe with a correct final count', () => {
    const base = { mode: 'speed', active: 25340, cardsSeen: 52, shoeLength: 52 };
    expect(computeResults({ ...base, checks: [{ ok: true, ms: 0 }] }).score).toBe(25.3);
    expect(computeResults({ ...base, checks: [{ ok: false, ms: 0 }] }).score).toBe(null);
  });
  test('dealt-mode score = cards/min × accuracy', () => {
    const R = computeResults({ mode: 'flash', active: 60000, cardsSeen: 60, shoeLength: 312,
      checks: [{ ok: true, ms: 1000 }, { ok: false, ms: 1000 }] });
    expect(R.cpm).toBe(60);
    expect(R.score).toBe(30);
    expect(R.totalMs).toBe(62000);
  });
});

describe('format', () => {
  test('answers accept the usual notations', () => {
    expect(parseAnswer('+3')).toBe(3);
    expect(parseAnswer('−2')).toBe(-2);
    expect(parseAnswer('2,5')).toBe(2.5);
    expect(parseAnswer('abc')).toBe(null);
    expect(fmtNum(-2.5)).toBe('−2.5');
  });
});
