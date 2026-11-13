import { describe, expect, test } from 'bun:test';
import {
  DUEL, checkAnswer, closeRound, currentRound, decide, markAnswered, newDuelState, paceOf, planDuel,
  questionAt, roundDue, verifyDuel, cardsReleased, deadlineOf,
} from '../src/core/duel.js';
import { ELO, eloUpdate, expected, kFactor, searchWindow } from '../src/core/elo.js';
import { tagOf } from '../src/core/engine.js';

const T0 = 1_800_000_000_000;

/* Plays a duel the way the server does. `answer(who, r, rc, rd)` returns { v, delay } or null (no answer). */
function play(seed, answer) {
  const plan = planDuel(seed);
  let state = newDuelState(plan, T0), outcome = null;
  const stored = [];
  while (!outcome && currentRound(state) >= 0) {
    const r = currentRound(state), rd = state.rounds[r];
    const rows = [null, null];
    for (const who of [0, 1]) {
      const a = answer(who, r, plan.rounds[r].rc, rd);
      if (!a) continue;
      const at = questionAt(rd) + a.delay;
      expect(checkAnswer(state, who, r, a.v, at)).toBeNull();
      state = markAnswered(state, who);
      rows[who] = { v: a.v, at };
      stored.push({ who, round: r, v: a.v, at });
    }
    const now = rows[0] && rows[1] ? Math.max(rows[0].at, rows[1].at) : deadlineOf(rd) + DUEL.graceMs + DUEL.closeSlackMs + 1;
    expect(roundDue(state, now)).toBe(true);
    ({ state, outcome } = closeRound(state, plan, rows, now));
  }
  return { plan, state, outcome, stored };
}

describe('planDuel', () => {
  test('deterministic, 12 rounds of 8–15 cards, distinct cards from one shoe', () => {
    const a = planDuel(42), b = planDuel(42);
    expect(a).toEqual(b);
    expect(a.rounds.length).toBe(12);
    for (const rd of a.rounds) { expect(rd.n).toBeGreaterThanOrEqual(8); expect(rd.n).toBeLessThanOrEqual(15); expect(rd.cards.length).toBe(rd.n); }
    expect(planDuel(43)).not.toEqual(a);
  });
  test('rc is the cumulative Hi-Lo count', () => {
    let rc = 0;
    for (const rd of planDuel(7).rounds) { for (const c of rd.cards) rc += tagOf('hilo', c); expect(rd.rc).toBe(rc); }
  });
  test('pace ramps ×0.85 down to the floor', () => {
    expect(paceOf(0)).toBe(1000);
    expect(paceOf(1)).toBe(850);
    expect(paceOf(11)).toBe(DUEL.paceFloor);
    for (let r = 1; r < 12; r++) expect(paceOf(r)).toBeLessThanOrEqual(paceOf(r - 1));
  });
});

describe('rounds and outcome', () => {
  test('sudden death: first round where only one is right decides', () => {
    const { outcome, state, stored } = play(1, (who, r, rc) => ({ v: who === 1 && r === 3 ? rc + 1 : rc, delay: 1200 }));
    expect(outcome).toEqual({ winner: 0, reason: 'sudden death', round: 3 });
    expect(state.rounds.length).toBe(4);
    expect(verifyDuel(1, state.rounds.map(r => r.dealAt), stored).outcome).toEqual(outcome);
  });
  test('both wrong in the same round: play on', () => {
    const { outcome } = play(2, (who, r, rc) => ({ v: r === 0 ? rc + 5 : (who === 0 && r === 2 ? rc - 1 : rc), delay: 900 }));
    expect(outcome.winner).toBe(1);
    expect(outcome.round).toBe(2);
  });
  test('12 rounds level → faster total wins; equal → draw', () => {
    const fast = play(3, (who, r, rc) => ({ v: rc, delay: who === 0 ? 1500 : 1400 }));
    expect(fast.outcome).toEqual({ winner: 1, reason: 'speed', round: 11 });
    const tie = play(3, (who, r, rc) => ({ v: rc, delay: 1000 }));
    expect(tie.outcome).toEqual({ winner: null, reason: 'draw', round: 11 });
  });
  test('no answer = wrong, closed at the deadline', () => {
    const { outcome } = play(4, (who, r, rc) => (who === 1 && r === 1 ? null : { v: rc, delay: 800 }));
    expect(outcome).toEqual({ winner: 0, reason: 'sudden death', round: 1 });
  });
  test('next round is scheduled after the reveal pause; count revealed only on close', () => {
    const plan = planDuel(5);
    let state = newDuelState(plan, T0);
    expect(state.rounds[0].rc).toBeUndefined();
    expect(JSON.stringify(state)).not.toContain('"cards"');
    const at = questionAt(state.rounds[0]) + 1000;
    const { state: s2 } = closeRound(state, plan, [{ v: plan.rounds[0].rc, at }, { v: plan.rounds[0].rc, at }], at);
    expect(s2.rounds[0].rc).toBe(plan.rounds[0].rc);
    expect(s2.rounds[1].dealAt).toBe(at + DUEL.revealMs);
    expect(s2.rounds[1].rc).toBeUndefined();
  });
});

describe('server-side answer checks (cheating attempts)', () => {
  const plan = planDuel(9), state = newDuelState(plan, T0), rd = state.rounds[0];
  test('answer before the question shows is refused', () => {
    expect(checkAnswer(state, 0, 0, 3, questionAt(rd) - 1000)).toBe('too early');
    expect(checkAnswer(state, 0, 0, 3, rd.dealAt)).toBe('too early');
  });
  test('answer after the window is refused', () => {
    expect(checkAnswer(state, 0, 0, 3, deadlineOf(rd) + DUEL.graceMs + 1)).toBe('too late');
  });
  test('wrong round, second answer, junk values', () => {
    expect(checkAnswer(state, 0, 1, 3, questionAt(rd))).toBe('not the current round');
    expect(checkAnswer(markAnswered(state, 0), 0, 0, 3, questionAt(rd))).toBe('already answered');
    for (const v of ['3', NaN, Infinity, null, 1e9]) expect(checkAnswer(state, 0, 0, v, questionAt(rd))).toBe('bad answer');
  });
  test('cards are released only shortly before the round', () => {
    expect(cardsReleased(rd, rd.dealAt - DUEL.leadMs - 1)).toBe(false);
    expect(cardsReleased(rd, rd.dealAt - DUEL.leadMs)).toBe(true);
  });
  test('verifyDuel rejects tampered answer rows', () => {
    const { state: s, stored } = play(11, (who, r, rc) => ({ v: who === 0 && r === 5 ? rc + 2 : rc, delay: 1000 }));
    const deals = s.rounds.map(r => r.dealAt);
    expect(verifyDuel(11, deals, stored).ok).toBe(true);
    expect(verifyDuel(11, deals, [...stored, stored[0]]).reason).toBe('duplicate answer');
    const early = stored.map((a, i) => (i === 2 ? { ...a, at: a.at - 5000 } : a));
    expect(verifyDuel(11, deals, early).reason).toBe('answer outside its window');
    expect(verifyDuel(11, [...deals, deals.at(-1) + 99999], stored).reason).toBe('rounds after the decision');
    // flipping the loser's wrong answer to the right count changes the outcome: the replay is what decides
    const fixed = stored.map(a => (a.who === 0 && a.round === 5 ? { ...a, v: planDuel(11).rounds[5].rc } : a));
    expect(verifyDuel(11, deals, fixed).outcome).toBeNull();
  });
  test('decide() never declares a winner on an open round', () => {
    expect(decide(newDuelState(plan, T0).rounds)).toBeNull();
  });
});

describe('Elo', () => {
  test('equal ratings: winner +K/2', () => {
    expect(expected(1000, 1000)).toBe(0.5);
    expect(eloUpdate({ elo: 1000, games: 0 }, { elo: 1000, games: 0 }, 1)).toEqual([20, -20]);
    expect(eloUpdate({ elo: 1000, games: 30 }, { elo: 1000, games: 30 }, 0)).toEqual([-10, 10]);
  });
  test('K = 40 for the first 10 games, then 20', () => {
    expect(kFactor(0)).toBe(40); expect(kFactor(9)).toBe(40); expect(kFactor(10)).toBe(20);
    expect(eloUpdate({ elo: 1000, games: 3 }, { elo: 1000, games: 50 }, 1)).toEqual([20, -10]);
  });
  test('draw moves ratings toward each other; upset pays more', () => {
    const [a, b] = eloUpdate({ elo: 1200, games: 20 }, { elo: 1000, games: 20 }, 0.5);
    expect(a).toBeLessThan(0); expect(b).toBeGreaterThan(0); expect(a + b).toBe(0);
    const [up] = eloUpdate({ elo: 1000, games: 20 }, { elo: 1300, games: 20 }, 1);
    const [fav] = eloUpdate({ elo: 1300, games: 20 }, { elo: 1000, games: 20 }, 1);
    expect(up).toBeGreaterThan(fav);
    expect(ELO.start).toBe(1000);
  });
  test('search window ±100, +50 every 5 s, capped at ±400', () => {
    expect(searchWindow(0)).toBe(100);
    expect(searchWindow(4999)).toBe(100);
    expect(searchWindow(5000)).toBe(150);
    expect(searchWindow(30000)).toBe(400);
    expect(searchWindow(600000)).toBe(400);
  });
});
