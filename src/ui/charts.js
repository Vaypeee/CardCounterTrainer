/* Tiny inline-SVG line chart (no library), shared by results and stats. */
import { clean, fmtNum } from '../core/format.js';

function niceStep(raw) {
  if (!(raw > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p;
  return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p;
}
/**
 * line: [{x,y}] series; step: draw as step line; dots: [{x,y,cls}];
 * yMin/yMax: fixed range (else auto, includes 0); lineDots: dot every line point.
 */
export function lineChart({ line = [], step = false, dots = [], yMin = null, yMax = null, lineDots = false, xInt = true, yFmt = fmtNum }) {
  const all = line.concat(dots);
  if (!all.length) return '<p class="muted empty">No data yet.</p>';
  const W = 720, H = 240, P = { l: 40, r: 10, t: 10, b: 24 };
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of all) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
  if (yMin != null) y0 = yMin; else y0 = Math.min(y0, 0);
  if (yMax != null) y1 = yMax; else y1 = Math.max(y1, 0);
  if (x0 === x1) { x0 -= 1; x1 += 1; }
  if (y0 === y1) { y0 -= 1; y1 += 1; }
  if (yMin == null) { const pad = (y1 - y0) * 0.08; y0 -= pad; y1 += pad; }
  const sx = x => (P.l + (x - x0) / (x1 - x0) * (W - P.l - P.r)).toFixed(1);
  const sy = y => (H - P.b - (y - y0) / (y1 - y0) * (H - P.t - P.b)).toFixed(1);
  let g = '';
  const ys = niceStep((y1 - y0) / 5);
  for (let v = Math.ceil(y0 / ys) * ys; v <= y1 + 1e-9; v += ys) {
    g += `<line class="grid" stroke-dasharray="2 4" x1="${P.l}" x2="${W - P.r}" y1="${sy(v)}" y2="${sy(v)}"/><text x="${P.l - 8}" y="${+sy(v) + 3.5}" text-anchor="end">${yFmt(v)}</text>`;
  }
  let xs = niceStep((x1 - x0) / 6); if (xInt) xs = Math.max(1, Math.round(xs));
  for (let v = Math.ceil(x0 / xs) * xs; v <= x1 + 1e-9; v += xs) {
    g += `<text x="${sx(v)}" y="${H - 8}" text-anchor="middle">${clean(v)}</text>`;
  }
  g += `<line class="axis" x1="${P.l}" x2="${W - P.r}" y1="${H - P.b}" y2="${H - P.b}"/>`;
  const base = y0 < 0 && y1 > 0 ? 0 : y0;
  if (y0 < 0 && y1 > 0 && yMin == null) g += `<line class="zero" x1="${P.l}" x2="${W - P.r}" y1="${sy(0)}" y2="${sy(0)}"/>`;
  if (line.length) {
    let d = `M${sx(line[0].x)} ${sy(line[0].y)}`;
    for (let i = 1; i < line.length; i++) d += step ? `H${sx(line[i].x)}V${sy(line[i].y)}` : `L${sx(line[i].x)} ${sy(line[i].y)}`;
    g += `<path class="area" d="${d}V${sy(base)}H${sx(line[0].x)}Z"/><path class="line" d="${d}"/>`;
    if (lineDots) g += line.map(p => `<circle class="ldot" cx="${sx(p.x)}" cy="${sy(p.y)}" r="2.6"><title>${clean(p.x)}: ${yFmt(p.y)}</title></circle>`).join('');
  }
  // Answer markers: small squares (green = correct, red = miss) with native tooltips.
  g += dots.map(p => `<rect class="${p.cls}" x="${+sx(p.x) - 3.5}" y="${+sy(p.y) - 3.5}" width="7" height="7"><title>#${clean(p.x)} · answer ${fmtNum(p.y)}</title></rect>`).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Chart">${g}</svg>`;
}
