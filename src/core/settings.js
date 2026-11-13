/* =========================================================
   SETTINGS VALIDATION (pure)
   The single place that validates and clamps user settings.
   ========================================================= */
import { DEFAULTS, LEVELS, MODES, SYSTEMS } from './config.js';
import { clamp, clean } from './format.js';

/** Validate and clamp a settings object in place (and return it). Re-derives `level` from `speed`. */
export function sanitizeSettings(st) {
  if (!MODES[st.mode]) st.mode = DEFAULTS.mode;
  if (!SYSTEMS[st.system]) st.system = DEFAULTS.system;
  if (![1, 2, 4, 6, 8].includes(st.decks)) st.decks = DEFAULTS.decks;
  if (![0, 60, 120, 300].includes(st.duration)) st.duration = DEFAULTS.duration;
  if (!['2', '3', 'auto'].includes(st.cardsPerHand)) st.cardsPerHand = DEFAULTS.cardsPerHand;
  if (!['half', 'whole', 'exact'].includes(st.deckRounding)) st.deckRounding = DEFAULTS.deckRounding;
  if (!['floor', 'trunc', 'round'].includes(st.tcRounding)) st.tcRounding = DEFAULTS.tcRounding;
  st.speed = clean(Math.round(clamp(Number(st.speed) || 1, 0.2, 3) * 10) / 10);
  st.players = clamp(Math.round(Number(st.players) || 3), 1, 7);
  st.penetration = clamp(Math.round((Number(st.penetration) || 75) / 5) * 5, 50, 95);
  st.checkMin = clamp(Math.round(Number(st.checkMin) || 10), 3, 300);
  st.checkMax = clamp(Math.round(Number(st.checkMax) || 30), 3, 300);
  if (st.checkMax < st.checkMin) st.checkMax = st.checkMin;
  for (const k of ['manual', 'checksEnabled', 'faceUp', 'sound', 'wheels', 'distraction', 'review']) st[k] = !!st[k];
  delete st.ranked;   // removed setting (the solo "Ranked" checkbox, 2026-11-11)
  // Level follows the speed: a preset only if the speed matches it exactly.
  if (LEVELS[st.level] && LEVELS[st.level].speed !== st.speed) st.level = 'custom';
  if (!LEVELS[st.level]) st.level = (Object.keys(LEVELS).find(k => LEVELS[k].speed === st.speed)) || 'custom';
  return st;
}
