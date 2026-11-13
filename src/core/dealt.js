/* =========================================================
   DEALT GAME RULES (pure) — the shoe/count state machine shared
   by the trainer (session.js, with S as the state object) and the
   server-side replay (ranked.js, with a plain object).

   The state object `g` must have: mode, sys, settings, rng, and
   holds shoe, pos, shown, cutAt, irc, rc, cardsSeen, rcTrace,
   nextCheckAt, shuffles. Keeping every rule that consumes the rng
   in this file guarantees that a replay draws the same cards.
   ========================================================= */
import { SYSTEMS } from './config.js';
import { clean } from './format.js';
import { buildShoe, cutPosition, nextCheckAt, tagOf } from './engine.js';

/** Fresh shoe; KO starts at its IRC, balanced systems at 0. */
export function newShoe(g) {
  const st = g.settings;
  g.shoe = buildShoe(st.decks, g.rng);
  g.pos = 0;
  g.shown = 0;
  g.cutAt = cutPosition(g.shoe.length, g.mode, st.penetration);
  g.irc = SYSTEMS[g.sys].irc(st.decks);
  g.rc = g.irc;
}

/** Add a face-up card to the running count. */
export function countCard(g, card) {
  g.rc = clean(g.rc + tagOf(g.sys, card));
  g.cardsSeen++;
  g.rcTrace.push(g.rc);
}

/** Draw the next periodic check position from the rng. */
export function scheduleCheck(g) {
  g.nextCheckAt = nextCheckAt(g.cardsSeen, g.settings, g.mode, g.rng);
}

/** Reset the shoe and count state for a new session (rng must be fresh). */
export function startDealt(g) {
  Object.assign(g, { cardsSeen: 0, rcTrace: [], shuffles: 0, nextCheckAt: Infinity });
  newShoe(g);
  g.rcTrace.push(g.rc);
}

export const periodicDue = g => g.cardsSeen >= g.nextCheckAt;
export const shoeDone = g => g.pos >= g.cutAt || g.pos >= g.shoe.length;

/** What a single-card dealing tick (flash / speed) does next: 'periodic' | 'end' | 'card'. */
export function nextSingleEvent(g) {
  if (periodicDue(g)) return 'periodic';
  if (shoeDone(g)) return 'end';
  return 'card';
}

/** Show the next card of the shoe (single-card modes). */
export function drawSingle(g) {
  const c = g.shoe[g.pos++];
  g.shown++;
  countCard(g, c);
  return c;
}

/** At the cut card / end of shoe: 'final' check, 'shoe' check, or 'reshuffle' directly. */
export function shoeEndKind(g) {
  if (g.mode === 'speed' || g.settings.duration === 0) return 'final';
  if (g.settings.checksEnabled) return 'shoe';
  return 'reshuffle';
}

/** New shoe after the cut card, then schedule the next check. */
export function reshuffle(g) {
  newShoe(g);
  g.shuffles++;
  g.round = null;
  scheduleCheck(g);
}
