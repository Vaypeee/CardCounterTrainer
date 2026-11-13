/* =========================================================
   STATE — the single global session/app state object.
   ========================================================= */
import { DEFAULTS } from './core/config.js';
import { sanitizeSettings } from './core/settings.js';
import { createRng, randomSeed } from './core/rng.js';
import { Store } from './store.js';

export const S = {
  settings: null,
  screen: 'settings',
  phase: 'idle',          // idle | countdown | dealing | check | feedback | question | review | paused | ended
  resumePhase: null,
  pauseRequested: false,
  pausedAt: 0,
  sessionId: 0,           // bumps on start/quit/end → stale timeouts are ignored
  mode: 'flash', sys: 'hilo',
  // seeded randomness for the session (see core/rng.js)
  seed: 0, rng: createRng(randomSeed()),
  // ranked: { id, runId, seed } while a ranked run is played; log = its event log
  ranked: null, log: [], ownSettings: null, starting: false,
  // shoe
  shoe: [], pos: 0, cutAt: 0, shown: 0, shuffles: 0,
  // count
  irc: 0, rc: 0, cardsSeen: 0, rcTrace: [],
  // checks / questions
  checks: [], nextCheckAt: Infinity, checkKind: null, checkStart: 0,
  question: null, qStart: 0, timeUp: false,
  // hands mode
  round: null,
  // timers
  dealTimer: null, fxTimer: null,
  clock: { elapsed: 0, last: 0, running: false, limit: 0 },
};

/** After a ranked run, give the player their own settings back (ranked rules are never saved). */
export function restoreOwnSettings() {
  if (S.ownSettings) { S.settings = S.ownSettings; S.ownSettings = null; }
}

export function loadSettings() {
  S.settings = Object.assign({}, DEFAULTS, Store.get('settings', {}));
  sanitizeSettings(S.settings);
}
