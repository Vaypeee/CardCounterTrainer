/* Statistics screen: lifetime tiles, accuracy chart, session table. */
import { LEVELS, MODES, SYSTEMS, levelLabel } from '../core/config.js';
import { fmtScore } from '../core/format.js';
import { $ } from '../dom.js';
import { Store } from '../store.js';
import { lineChart } from './charts.js';

/** Stats level filter: 'all', a preset key, 'custom' (custom speeds + manual). */
function levelMatch(h, lvl) {
  if (lvl === 'all') return true;
  if (!h.level) return false;                     // modes without a level (or old sessions)
  if (lvl === 'custom') return !LEVELS[h.level];
  return h.level === lvl;
}
export function renderStats() {
  const sel = $('#statsFilter');
  if (!sel.options.length) {
    sel.innerHTML = '<option value="all">All modes</option>' + Object.entries(MODES).map(([k, m]) => `<option value="${k}">${m.name}</option>`).join('');
  }
  const lvl = $('#statsLevel').value;
  const all = Store.get('history', []);
  const filtered = all.filter(h => (sel.value === 'all' || h.mode === sel.value) && levelMatch(h, lvl));
  const list = filtered.slice(-20);
  const avgAcc = list.length ? list.reduce((s, h) => s + h.acc, 0) / list.length : 0;
  const cpms = filtered.map(h => h.cpm).filter(v => v != null);
  const cards = filtered.reduce((s, h) => s + (h.cards || 0), 0);
  $('#statsTiles').innerHTML = [
    ['Sessions', String(filtered.length)],
    ['Avg accuracy (last 20)', list.length ? `${Math.round(avgAcc)}%` : '—'],
    ['Best cards / min', cpms.length ? String(Math.max(...cpms)) : '—'],
    ['Cards counted', String(cards)],
  ].map(([k, v]) => `<div class="tile"><span>${k}</span><b>${v}</b></div>`).join('');
  $('#statsChart').innerHTML = lineChart({ line: list.map((h, i) => ({ x: i + 1, y: Math.round(h.acc) })), yMin: 0, yMax: 100, lineDots: true, yFmt: v => v + '%' });
  const t = $('#statsTable');
  if (!list.length) { t.innerHTML = '<tr><td class="muted empty">No sessions yet — go count some cards.</td></tr>'; return; }
  const rows = list.slice().reverse().map(h => {
    const d = new Date(h.t);
    const date = d.toLocaleDateString([], { day: '2-digit', month: '2-digit' }) + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const sys = h.mode === 'deviations' ? '—' : `${SYSTEMS[h.sys] ? SYSTEMS[h.sys].name : h.sys} ${h.decks}D`;
    return `<tr><td>${date}</td><td class="l">${MODES[h.mode] ? MODES[h.mode].name : h.mode}</td><td class="l">${sys}</td><td class="l">${levelLabel(h.level)}</td><td>${Math.round(h.acc)}%</td><td>${h.cpm != null ? h.cpm : '—'}</td><td>${fmtScore(h.mode, h.score)}</td></tr>`;
  }).join('');
  t.innerHTML = `<thead><tr><th>Date</th><th class="l">Mode</th><th class="l">System</th><th class="l">Level</th><th>Acc.</th><th>CPM</th><th>Score</th></tr></thead><tbody>${rows}</tbody>`;
}
