/* =========================================================
   RANDOMNESS
   Everything that shapes a session (shoe order, check spacing,
   questions) draws from a seeded generator, so a session can be
   replayed exactly from its seed (needed later for server-side
   score verification). Cosmetic randomness (sound noise,
   distraction chatter) uses `looseRng` and is never replayed.
   ========================================================= */

/** Wrap a [0, 1) generator with the helpers the game uses. */
function withHelpers(next, seed = null) {
  return {
    seed,
    next,
    /** Integer in [a, b], inclusive. */
    int: (a, b) => a + Math.floor(next() * (b - a + 1)),
    pick: arr => arr[Math.floor(next() * arr.length)],
  };
}

/** mulberry32: small, fast, good enough for card games. Seed is a uint32. */
export function createRng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return withHelpers(next, seed >>> 0);
}

/** A fresh random uint32 seed (crypto when available). */
export function randomSeed() {
  const c = globalThis.crypto;
  if (c && c.getRandomValues) return c.getRandomValues(new Uint32Array(1))[0];
  return Math.floor(Math.random() * 4294967296) >>> 0;
}

/** Unseeded helpers for cosmetic effects only. */
export const looseRng = withHelpers(Math.random);
