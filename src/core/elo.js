/* =========================================================
   ELO (pure) — ratings of the ranked 1v1 and the matchmaking window.
   ========================================================= */
export const ELO = {
  start: 1000,
  kProvisional: 40,       // K for the first `provisionalGames` games
  provisionalGames: 10,
  k: 20,
};

export const kFactor = games => (games < ELO.provisionalGames ? ELO.kProvisional : ELO.k);
/** Expected score of a player rated `ra` against one rated `rb`. */
export const expected = (ra, rb) => 1 / (1 + 10 ** ((rb - ra) / 400));

/**
 * Rating changes after a game. a, b = { elo, games } before the game,
 * scoreA = 1 (a won), 0.5 (draw) or 0 (b won). Returns [deltaA, deltaB] (integers).
 * Each player uses their own K, so a provisional player moves faster than a settled one.
 */
export function eloUpdate(a, b, scoreA) {
  const ea = expected(a.elo, b.elo);
  const da = Math.round(kFactor(a.games) * (scoreA - ea));
  const db = Math.round(kFactor(b.games) * ((1 - scoreA) - (1 - ea)));
  return [da, db];
}

/* Matchmaking: the accepted rating gap widens while a player waits. */
export const QUEUE = {
  window0: 100,           // ± Elo at first
  widenBy: 50,            // + every `widenEveryMs`
  widenEveryMs: 5000,
  windowMax: 400,
  offerMs: 60000,         // after this the client offers "keep waiting / cancel"
  staleMs: 10000,         // a queue entry not polled for this long is dropped
};
export const searchWindow = waitMs =>
  Math.min(QUEUE.windowMax, QUEUE.window0 + QUEUE.widenBy * Math.floor(Math.max(0, waitMs) / QUEUE.widenEveryMs));
