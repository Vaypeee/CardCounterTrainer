/* =========================================================
   NUMBER HELPERS & FORMATTING (pure)
   ========================================================= */
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const clean = n => Math.round(n * 1e9) / 1e9;           // kill float noise (e.g. 1.9999999)
export const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** Signed number with a real minus sign: +3, 0, −2.5 */
export function fmtNum(n) {
  n = clean(n);
  if (n === 0) return '0';
  return (n > 0 ? '+' : '−') + Math.abs(n);
}
export function fmtClock(totalSec) {
  const s = Math.max(0, totalSec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
export function fmtDuration(ms) {
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return fmtClock(Math.round(ms / 1000));
}
export function fmtDecks(d) { return Number.isInteger(d * 2) ? String(d) : d.toFixed(2); }
export const fmtScore = (mode, v) => (v == null ? '—' : mode === 'speed' ? `${v.toFixed(1)}s` : String(v));
export const fmtEdge = e => (e > 0 ? '+' : e < 0 ? '−' : '') + Math.abs(e).toFixed(1) + '%';

/** Parse a typed answer: accepts "+3", "-2", "−2", "2.5", "2,5". Returns null if invalid. */
export function parseAnswer(str) {
  const s = String(str).trim().replace(/[−–—]/g, '-').replace(',', '.').replace(/\s+/g, '');
  if (!/^[+-]?(\d+(\.\d+)?|\.\d+)$/.test(s)) return null;
  return clean(parseFloat(s));
}
