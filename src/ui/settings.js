/* =========================================================
   SETTINGS SCREEN — DOM ↔ S.settings binding.
   Controls declare data-setting="<key>" (+ data-type="num").
   .seg containers hold button[data-value]; data-show="modes…"
   hides an element unless the current mode is listed.
   ========================================================= */
import { LEVELS, MODES, QUESTION_MODES, SYSTEMS, TAG_KEYS, UNTIMED_QUESTIONS } from '../core/config.js';
import { fmtNum, fmtScore, plural } from '../core/format.js';
import { sanitizeSettings } from '../core/settings.js';
import { bestKey } from '../core/engine.js';
import { $, $$ } from '../dom.js';
import { S } from '../state.js';
import { Store } from '../store.js';

export function initSettingsUI() {
  $('#systemSel').innerHTML = Object.entries(SYSTEMS).map(([k, s]) => `<option value="${k}">${s.name}</option>`).join('');
  $('#modeGrid').innerHTML = Object.entries(MODES).map(([k, m]) =>
    `<button type="button" data-value="${k}"><b>${m.name}</b><span>${m.desc}</span></button>`).join('');
  $$('[data-setting]').forEach(el => {
    const key = el.dataset.setting;
    const cast = v => (el.dataset.type === 'num' ? Number(v) : v);
    if (el.classList.contains('seg')) {
      el.addEventListener('click', e => {
        const b = e.target.closest('button[data-value]');
        if (b) setSetting(key, cast(b.dataset.value));
      });
    } else {
      el.addEventListener(el.type === 'range' ? 'input' : 'change', () => {
        setSetting(key, el.type === 'checkbox' ? el.checked : cast(el.value));
      });
    }
  });
  $('#refBtn').addEventListener('click', () => {
    const box = $('#refBox');
    box.hidden = !box.hidden;
    $('#refBtn').setAttribute('aria-expanded', String(!box.hidden));
    $('#refBtn').textContent = box.hidden ? 'Show tag values' : 'Hide tag values';
    renderRef();
  });
}
export function setSetting(key, val) {
  if (key === 'level') {
    if (LEVELS[val]) { S.settings.speed = LEVELS[val].speed; S.settings.manual = false; }
    else if (val === 'custom') { $('#speedRange').focus(); return; } // keep current speed, let the user type one
  }
  S.settings[key] = val;
  sanitizeSettings(S.settings);
  Store.set('settings', S.settings);
  renderSettings();
}
export function renderSettings() {
  const st = S.settings;
  $$('[data-setting]').forEach(el => {
    const v = st[el.dataset.setting];
    if (el.classList.contains('seg')) {
      $$('button[data-value]', el).forEach(b => {
        const on = b.dataset.value === String(v);
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', String(on));
      });
    } else if (el.type === 'checkbox') el.checked = !!v;
    else if (document.activeElement !== el || el.type === 'range') el.value = v;
  });
  $$('[data-show]').forEach(el => { el.hidden = !el.dataset.show.split(' ').includes(st.mode); });
  $('#speedVal').textContent = st.manual ? 'manual' : `${st.speed.toFixed(1)} s / card`;
  $('#speedRange').disabled = st.manual;
  $('#penVal').textContent = `${st.penetration}%`;
  $$('[data-setting="checkMin"], [data-setting="checkMax"]').forEach(el => { el.disabled = !st.checksEnabled; });
  $('#durFull').textContent = QUESTION_MODES.includes(st.mode) ? `${UNTIMED_QUESTIONS} questions` : 'Full shoe';
  renderRef();
  renderHeadStats();
  // Best-score preview for the current configuration.
  const b = Store.get('bests', {})[bestKey(st.mode, st.mode === 'deviations' ? 'hilo' : st.system, st)];
  $('#bestPreview').textContent = b ? `Personal best: ${fmtScore(st.mode, b.score)}` : '';
  renderConfigLine();
}
/** One-line summary of the session about to run. */
function renderConfigLine() {
  const st = S.settings, m = st.mode, q = QUESTION_MODES.includes(m), parts = [MODES[m].name];
  if (m !== 'deviations') parts.push(SYSTEMS[st.system].name, plural(st.decks, 'deck'));
  if (m === 'flash' || m === 'hands') parts.push(st.manual ? 'manual' : `${LEVELS[st.level] ? LEVELS[st.level].name : 'Custom'} (${st.speed.toFixed(1)} s per card)`);
  if (m === 'hands') parts.push(plural(st.players, 'player'));
  if (m !== 'speed') parts.push(st.duration ? `${st.duration} s` : q ? `${UNTIMED_QUESTIONS} questions` : 'full shoe');
  $('#configLine').textContent = parts.join(' · ');
}
/** Small lifetime stats block in the page header. */
function renderHeadStats() {
  const hist = Store.get('history', []), last = hist.slice(-20);
  const acc = last.length ? Math.round(last.reduce((s, h) => s + h.acc, 0) / last.length) + '%' : '—';
  const cpms = hist.map(h => h.cpm).filter(v => v != null);
  const cards = hist.reduce((s, h) => s + (h.cards || 0), 0);
  $('#headStats').textContent = hist.length
    ? `${plural(hist.length, 'session')} played · ${acc} average accuracy (last 20)` + (cpms.length ? ` · best ${Math.max(...cpms)} cards/min` : '') + ` · ${cards.toLocaleString()} cards counted`
    : '';
}
function renderRef() {
  const box = $('#refBox');
  if (box.hidden) return;
  const s = SYSTEMS[S.settings.system];
  const ranks = TAG_KEYS.map(k => `<th>${k === 'T' ? '10–K' : k}</th>`).join('');
  const vals = TAG_KEYS.map(k => {
    const v = s.tags[k], cls = v > 0 ? 'pos' : v < 0 ? 'neg' : 'zero';
    return `<td class="${cls}">${fmtNum(v)}</td>`;
  }).join('');
  const irc = s.irc(S.settings.decks);
  box.innerHTML = `<table><tr>${ranks}</tr><tr>${vals}</tr></table>
    <p class="small muted" style="margin:8px 0 0">${s.note}${irc ? ` Starting count for ${plural(S.settings.decks, 'deck')}: <b>${fmtNum(irc)}</b>.` : ''}</p>`;
}
