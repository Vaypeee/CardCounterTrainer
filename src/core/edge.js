/* =========================================================
   PLAYER EDGE (pure) — used by the guide
   ========================================================= */

/** Rough Hi-Lo player edge (%) for a 6-deck S17 DAS game: −0.5% + 0.5% per true count. */
export const edgeAt = tc => -0.5 + 0.5 * tc;

/** Verdict for a (floored) true count: label, advice, meter level −3..5. */
export function verdict(tc) {
  if (tc <= -2) return { label: 'Bad', advice: 'House edge over 1%. Bet the minimum or leave the table.', m: -3 };
  if (tc === -1) return { label: 'Poor', advice: 'House edge about 1%. Minimum bet.', m: -1 };
  if (tc === 0) return { label: 'Neutral', advice: 'Normal shoe, small house edge. Minimum bet.', m: 0 };
  if (tc === 1) return { label: 'Break-even', advice: 'Roughly an even game. Minimum bet.', m: 1 };
  if (tc === 2) return { label: 'Good', advice: 'Small edge for you. Start raising (2 units).', m: 2 };
  if (tc <= 4) return { label: 'Very good', advice: 'Clear edge. Bet big (4–6 units).', m: tc };
  return { label: 'Excellent', advice: 'Big edge. Maximum bet.', m: 5 };
}
