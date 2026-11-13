/* =========================================================
   STORAGE (localStorage, fail-safe). Keys are prefixed `cct.`:
   settings, theme, history (≤ 100 sessions), bests.
   ========================================================= */
export const Store = {
  get(key, def) {
    try { const v = localStorage.getItem('cct.' + key); return v == null ? def : JSON.parse(v); }
    catch { return def; }
  },
  set(key, val) { try { localStorage.setItem('cct.' + key, JSON.stringify(val)); } catch { /* quota / private mode */ } },
};
