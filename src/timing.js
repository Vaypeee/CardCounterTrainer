/* =========================================================
   TIMING — clock (only runs while dealing / answering
   questions), guarded timeouts
   ========================================================= */
import { S } from './state.js';

export const Clock = {
  start() { if (!S.clock.running) { S.clock.running = true; S.clock.last = performance.now(); } },
  stop()  { if (S.clock.running) { this.update(); S.clock.running = false; } },
  update() {
    if (!S.clock.running) return;
    const now = performance.now();
    S.clock.elapsed += now - S.clock.last;
    S.clock.last = now;
  },
};
/** Wrap a callback so it is ignored if the session changed meanwhile. */
export function guard(fn) { const id = S.sessionId; return () => { if (id === S.sessionId) fn(); }; }
export function later(fn, ms) { clearTimeout(S.fxTimer); S.fxTimer = setTimeout(guard(fn), ms); }
export function clearTimers() { clearTimeout(S.dealTimer); clearTimeout(S.fxTimer); }
