/* =========================================================
   GAME ENGINE (pure: no DOM, no global state)
   Shoe, counting, true count, hands, questions and scoring.
   Every random draw goes through the `rng` argument (see rng.js),
   so the same seed always gives the same session. This module is
   meant to run unchanged in the browser and on a server.
   ========================================================= */
import { DEVIATIONS, LEVELED_MODES, QUESTION_MODES, RANKS, SUITS, SYSTEMS, levelKeyOf } from './config.js';
import { clean } from './format.js';

/* ---------- Cards & shoe ---------- */
/** Fisher–Yates in-place shuffle. */
export function shuffle(a, rng) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
export function makeCard(r, suit) { return { r, s: suit.sym, red: suit.red }; }
export function buildShoe(decks, rng) {
  const cards = [];
  for (let d = 0; d < decks; d++) for (const suit of SUITS) for (const r of RANKS) cards.push(makeCard(r, suit));
  return shuffle(cards, rng);
}
export const tagKey = r => (r === 'A' ? 'A' : (r === '10' || r === 'J' || r === 'Q' || r === 'K') ? 'T' : r);
export const tagOf = (sys, card) => SYSTEMS[sys].tags[tagKey(card.r)];
export const bjValue = r => (r === 'A' ? 11 : tagKey(r) === 'T' ? 10 : Number(r));

/** Cut-card position: Speed Count ignores penetration and deals the whole shoe. */
export const cutPosition = (shoeLength, mode, penetration) =>
  (mode === 'speed' ? shoeLength : Math.round(shoeLength * penetration / 100));

export function handTotal(cards) {
  let t = 0, aces = 0;
  for (const c of cards) { t += bjValue(c.r); if (c.r === 'A') aces++; }
  while (t > 21 && aces) { t -= 10; aces--; }
  return { total: t, soft: aces > 0 };
}

/* ---------- True count ---------- */
/** Decks remaining estimate, per the user's rounding preference (half | whole | exact). */
export function estimateDecks(cardsLeft, deckRounding) {
  const x = cardsLeft / 52;
  switch (deckRounding) {
    case 'half':  return Math.max(0.5, Math.round(x * 2) / 2);
    case 'whole': return Math.max(1, Math.round(x));
    default:      return Math.max(0.01, Math.round(x * 100) / 100);
  }
}
/** Round a raw true count per preference (floor | trunc | round; symmetric rounding for 'round'). */
export function roundTC(x, tcRounding) {
  x = clean(x);
  let r;
  switch (tcRounding) {
    case 'floor': r = Math.floor(x); break;
    case 'trunc': r = Math.trunc(x); break;
    default:      r = Math.sign(x) * Math.round(Math.abs(x));
  }
  return r === 0 ? 0 : r; // normalise −0
}
export const TC_LABEL = { floor: 'floored', trunc: 'truncated toward 0', round: 'rounded to nearest' };

/** Card count at which the next periodic check is asked (Infinity = never). */
export function nextCheckAt(cardsSeen, st, mode, rng) {
  if (!st.checksEnabled || mode === 'speed') return Infinity;
  return cardsSeen + rng.int(Math.min(st.checkMin, st.checkMax), Math.max(st.checkMin, st.checkMax));
}

/* ---------- Hands ---------- */
/** Simple, realistic player decisions for "play it out" hands. */
export function wantsHit(cards, up) {
  const { total, soft } = handTotal(cards);
  if (total >= 21) return false;
  if (soft) return total <= 17 || (total === 18 && up >= 9);
  if (total <= 11) return true;
  if (total === 12) return !(up >= 4 && up <= 6);
  if (total <= 16) return up >= 7;
  return false;
}

/** Plan a full blackjack round up-front as a queue of dealing actions, drawing from
    `shoe` starting at `pos`. Cards are drawn now but only counted when shown face-up.
    Returns { queue, pos } where pos is the shoe position after the round. */
export function planRound(shoe, pos, st) {
  const n = st.players, q = [];
  const draw = () => (pos < shoe.length ? shoe[pos++] : null);
  const hands = Array.from({ length: n }, () => []);
  const dealer = [];
  let hole = null, ok = true;

  // Two passes: each player, then dealer (second dealer card is the face-down hole card).
  outer:
  for (let pass = 0; pass < 2; pass++) {
    for (let p = 0; p < n; p++) {
      const c = draw(); if (!c) { ok = false; break outer; }
      hands[p].push(c); q.push({ t: 'card', seat: p, c });
    }
    const c = draw(); if (!c) { ok = false; break; }
    dealer.push(c);
    if (pass === 1) { hole = c; q.push({ t: 'card', seat: 'D', c, down: true }); }
    else q.push({ t: 'card', seat: 'D', c });
  }

  // Player draws.
  if (ok && st.cardsPerHand !== '2') {
    const up = bjValue(dealer[0].r);
    for (let p = 0; p < n && ok; p++) {
      let hits = 0;
      while (st.cardsPerHand === '3' ? hits < 1 : (wantsHit(hands[p], up) && hands[p].length < 7)) {
        const c = draw(); if (!c) { ok = false; break; }
        hands[p].push(c); hits++; q.push({ t: 'card', seat: p, c });
      }
    }
  }

  // Reveal hole card, dealer draws to hard/soft 17 (S17) unless every player busted.
  if (hole) {
    q.push({ t: 'reveal', c: hole });
    const allBust = st.cardsPerHand === 'auto' && hands.every(h => handTotal(h).total > 21);
    if (ok && !allBust) {
      while (handTotal(dealer).total < 17) {
        const c = draw(); if (!c) break;
        dealer.push(c); q.push({ t: 'card', seat: 'D', c });
      }
    }
  }
  return { queue: q, pos };
}
export const minRoundCards = players => (players + 1) * 2;

/* ---------- Question modes ---------- */
const TENS = ['10', 'J', 'Q', 'K'];
/** Two-card hard hand for a deviation question (no pairs except T,T). */
export function cardsForHand(hand, rng) {
  const ten = () => makeCard(rng.pick(TENS), rng.pick(SUITS));
  if (hand === 'TT') return [ten(), ten()];
  const t = Number(hand), opts = [];
  for (let a = 2; a <= 10; a++) { const b = t - a; if (b > a && b <= 10) opts.push([a, b]); }
  const [a, b] = rng.pick(opts);
  const mk = v => (v === 10 ? ten() : makeCard(String(v), rng.pick(SUITS)));
  const cards = [mk(a), mk(b)];
  return rng.next() < 0.5 ? cards : cards.reverse();
}
export const upCardFor = (up, rng) => makeCard(up === 'T' ? rng.pick(TENS) : up, rng.pick(SUITS));
export const handName = d => (d.hand === 'TT' ? '10,10' : `Hard ${d.hand}`) + ' vs ' + (d.up === 'T' ? '10' : d.up);

/** True-count question. `st` needs decks, deckRounding, tcRounding. */
export function genTCQuestion(st, sys, rng) {
  const cardsLeft = rng.int(26, st.decks * 52);     // at least half a deck left
  const d = estimateDecks(cardsLeft, st.deckRounding);
  let rc = (rng.next() * 12 - 6) * d;               // targets TC roughly in [−6, +6]
  rc = sys === 'halves' ? Math.round(rc * 2) / 2 : Math.round(rc);
  rc = rc === 0 ? 0 : rc;
  return { rc, d, cardsLeft, correct: roundTC(rc / d, st.tcRounding) };
}
/** Deviation question with the legal actions: Split only on a pair, Surrender only when late surrender is offered. */
export function genDevQuestion(rng) {
  const d = rng.pick(DEVIATIONS);
  const tc = d.idx + rng.int(-3, 3);
  const allowed = ['H', 'S', 'D'];
  if (d.hand === 'TT') allowed.push('P');
  if (d.ls) allowed.push('R');
  return { d, tc, player: cardsForHand(d.hand, rng), up: upCardFor(d.up, rng), correct: tc >= d.idx ? d.yes : d.no, allowed };
}

/* ---------- Scoring ---------- */
/** Key under which a personal best is stored: mode|system|decks[|levelKey][|rounding]. */
export function bestKey(mode, sys, st) {
  if (mode === 'deviations') return 'deviations';
  let k = `${mode}|${sys}|${st.decks}`;
  if (LEVELED_MODES.includes(mode)) k += `|${levelKeyOf(st)}`;  // bests are per difficulty
  if (mode === 'truecount') k += `|${st.deckRounding}|${st.tcRounding}`;
  return k;
}

/** Session results. `active` = clock time (ms) spent dealing / answering. */
export function computeResults({ mode, checks, active, cardsSeen, shoeLength }) {
  const total = checks.length, correct = checks.filter(c => c.ok).length;
  const acc = total ? (correct / total) * 100 : 0;
  let streak = 0, best = 0;
  for (const c of checks) { streak = c.ok ? streak + 1 : 0; best = Math.max(best, streak); }
  const q = QUESTION_MODES.includes(mode);
  const checkMs = q ? 0 : checks.reduce((s, c) => s + c.ms, 0);
  const units = q ? total : cardsSeen;
  const perMin = active > 0 ? units / (active / 60000) : 0;
  let score = null, lowerIsBetter = false;
  if (mode === 'speed') { lowerIsBetter = true; score = total && checks[total - 1].ok && cardsSeen === shoeLength ? Math.round(active / 100) / 10 : null; }
  else if (q) score = correct;
  else score = Math.round(perMin * acc / 100);
  return { total, correct, acc, streak: best, active, totalMs: active + checkMs, units, perMin,
           avgMs: units ? active / units : 0, cpm: q ? null : Math.round(perMin), score, lowerIsBetter };
}
