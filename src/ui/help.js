/* True-count calculator on the guide page (the tables around it are rendered at build time). */
import { clean, fmtEdge, fmtNum } from '../core/format.js';
import { edgeAt, verdict } from '../core/edge.js';
import { meter } from '../content/tables.js';
import { $ } from '../dom.js';

export function updateCalc() {
  const rc = parseFloat($('#calcRc').value), d = parseFloat($('#calcDecks').value);
  const out = $('#calcOut');
  if (!isFinite(rc) || !isFinite(d) || d <= 0) { out.textContent = 'Enter a running count and the decks left (e.g. 2.5).'; return; }
  const raw = rc / d, tc = Math.floor(clean(raw)), v = verdict(tc);
  out.innerHTML = `True count ${fmtNum(clean(Math.round(raw * 100) / 100))} → <b>${fmtNum(tc)}</b> &nbsp;${meter(v.m)} <b>${v.label}</b> · edge ≈ ${fmtEdge(edgeAt(tc))}<br><span class="muted">${v.advice}</span>`;
}
export function initCalc() {
  if (!$('#calcOut')) return;
  $('#calcRc').addEventListener('input', updateCalc);
  $('#calcDecks').addEventListener('input', updateCalc);
  updateCalc();
}
