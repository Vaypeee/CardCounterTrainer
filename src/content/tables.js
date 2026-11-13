/* =========================================================
   CONTENT TABLES (pure: returns HTML strings, no DOM)
   Rendered at build time into the static pages by the Vite
   `site` plugin, so search engines see real tables. Generated
   from the same config the trainer uses.
   ========================================================= */
import { ACTIONS, DEVIATIONS, SYSTEMS, TAG_KEYS } from '../core/config.js';
import { clean, fmtEdge, fmtNum } from '../core/format.js';
import { handName } from '../core/engine.js';
import { edgeAt, verdict } from '../core/edge.js';

/** Small 5-cell bar used next to verdicts. */
export function meter(m) {
  const n = Math.abs(m), cls = m < 0 ? 'meter neg' : 'meter';
  return `<span class="${cls}">${Array.from({ length: 5 }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('')}</span>`;
}

const wrap = inner => `<div class="table-wrap"><table>${inner}</table></div>`;
const tagCell = v => `<td class="c ${v > 0 ? 'good' : v < 0 ? 'bad' : ''}">${fmtNum(v)}</td>`;

/** Edge and betting advice for true counts −3…+6. */
export function edgeTable() {
  const rows = [-3, -2, -1, 0, 1, 2, 3, 4, 5, 6].map(tc => {
    const v = verdict(tc), e = edgeAt(tc);
    return `<tr><td class="num">${fmtNum(tc)}${tc === -3 ? ' or less' : tc === 6 ? ' or more' : ''}</td><td class="num ${e > 0 ? 'good' : e < 0 ? 'bad' : ''}">${fmtEdge(e)}</td><td>${meter(v.m)} <b>${v.label}</b></td><td>${v.advice}</td></tr>`;
  }).join('');
  return wrap(`<tr><th>True count</th><th>Your edge</th><th>Rating</th><th>What to do</th></tr>${rows}`);
}

/** Worked running count → true count examples. */
export function scenarioTable() {
  const scenarios = [[7, 5], [7, 1.5], [5, 2.5], [11, 2], [11, 5], [-2, 3], [-6, 2]];
  return wrap('<tr><th>Running count</th><th>Decks left</th><th>True count</th><th>Rating</th></tr>' +
    scenarios.map(([rc, d]) => {
      const raw = rc / d, tc = Math.floor(clean(raw)), v = verdict(tc);
      return `<tr><td class="num">${fmtNum(rc)}</td><td class="num">${d}</td><td class="num">${fmtNum(clean(Math.round(raw * 10) / 10))} → <b>${fmtNum(tc)}</b></td><td>${meter(v.m)} ${v.label} (${fmtEdge(edgeAt(tc))})</td></tr>`;
    }).join(''));
}

/** Card values of one system, one column per rank. */
export function tagTable(key) {
  const s = SYSTEMS[key];
  const head = TAG_KEYS.map(k => `<th class="c">${k === 'T' ? '10–K' : k}</th>`).join('');
  return wrap(`<tr><th>Card</th>${head}</tr><tr><th>${s.name}</th>${TAG_KEYS.map(k => tagCell(s.tags[k])).join('')}</tr>`);
}

/* Published efficiency figures (betting correlation, playing efficiency,
   insurance correlation), as commonly quoted in the blackjack literature. */
const EFFICIENCY = {
  hilo:   { bc: 0.97, pe: 0.51, ic: 0.76 },
  ko:     { bc: 0.98, pe: 0.55, ic: 0.78 },
  omega2: { bc: 0.92, pe: 0.67, ic: 0.85 },
  zen:    { bc: 0.96, pe: 0.63, ic: 0.85 },
  halves: { bc: 0.99, pe: 0.56, ic: 0.72 },
};

/** Every system: card values side by side. */
export function systemsTagTable() {
  const head = TAG_KEYS.map(k => `<th class="c">${k === 'T' ? '10–K' : k}</th>`).join('');
  const rows = Object.values(SYSTEMS).map(s => `<tr><th>${s.name}</th>${TAG_KEYS.map(k => tagCell(s.tags[k])).join('')}</tr>`).join('');
  return wrap(`<tr><th>System</th>${head}</tr>${rows}`);
}

/** Every system: level, balance, starting count, efficiency. */
export function systemsCompareTable() {
  const rows = Object.entries(SYSTEMS).map(([k, s]) => {
    const e = EFFICIENCY[k];
    const irc = s.balanced ? '0' : `${fmtNum(s.irc(1))} (1 deck) · ${fmtNum(s.irc(6))} (6 decks)`;
    return `<tr><td>${s.name}</td><td class="c">${s.level}</td><td>${s.balanced ? 'Balanced' : 'Unbalanced'}</td><td>${s.balanced ? 'Yes' : 'No'}</td><td class="num">${irc}</td>` +
      (e ? `<td class="c num">${e.bc.toFixed(2)}</td><td class="c num">${e.pe.toFixed(2)}</td><td class="c num">${e.ic.toFixed(2)}</td>` : '<td></td><td></td><td></td>') + '</tr>';
  }).join('');
  return wrap(`<tr><th>System</th><th class="c">Level</th><th>Type</th><th>True count?</th><th>Starting count</th><th class="c">BC</th><th class="c">PE</th><th class="c">IC</th></tr>${rows}`);
}

/** Hi-Lo index plays quizzed by the Deviations mode. */
export function deviationsTable(set) {
  const rows = DEVIATIONS.filter(d => !set || d.set === set).map(d =>
    `<tr><td>${handName(d)}</td><td class="c num">${fmtNum(d.idx)}</td><td>${ACTIONS[d.yes]} at TC ≥ ${fmtNum(d.idx)}</td><td>${ACTIONS[d.no]} below</td></tr>`).join('');
  return wrap(`<tr><th>Hand</th><th class="c">Index</th><th>Play</th><th>Otherwise</th></tr>${rows}`);
}

/* Basic strategy, 4–8 decks, dealer stands on soft 17, double after split, late surrender.
   Columns: dealer up card 2…9, T, A. Codes: H hit, S stand, D double (else hit), Ds double (else stand),
   P split, Rh surrender (else hit). */
const UP = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'A'];
const row = s => s.trim().split(/\s+/);
const BASIC = {
  hard: [
    ['5–8', row('H H H H H H H H H H')],
    ['9', row('H D D D D H H H H H')],
    ['10', row('D D D D D D D D H H')],
    ['11', row('D D D D D D D D D H')],
    ['12', row('H H S S S H H H H H')],
    ['13', row('S S S S S H H H H H')],
    ['14', row('S S S S S H H H H H')],
    ['15', row('S S S S S H H H Rh H')],
    ['16', row('S S S S S H H Rh Rh Rh')],
    ['17+', row('S S S S S S S S S S')],
  ],
  soft: [
    ['A,2', row('H H H D D H H H H H')],
    ['A,3', row('H H H D D H H H H H')],
    ['A,4', row('H H D D D H H H H H')],
    ['A,5', row('H H D D D H H H H H')],
    ['A,6', row('H D D D D H H H H H')],
    ['A,7', row('S Ds Ds Ds Ds S S H H H')],
    ['A,8', row('S S S S S S S S S S')],
    ['A,9', row('S S S S S S S S S S')],
  ],
  pairs: [
    ['2,2', row('P P P P P P H H H H')],
    ['3,3', row('P P P P P P H H H H')],
    ['4,4', row('H H H P P H H H H H')],
    ['5,5', row('D D D D D D D D H H')],
    ['6,6', row('P P P P P H H H H H')],
    ['7,7', row('P P P P P P H H H H')],
    ['8,8', row('P P P P P P P P P P')],
    ['9,9', row('P P P P P S P P S S')],
    ['T,T', row('S S S S S S S S S S')],
    ['A,A', row('P P P P P P P P P P')],
  ],
};
const BS_CLASS = { H: 'H', S: 'S', D: 'D', Ds: 'D', P: 'P', Rh: 'R' };
/** One basic strategy chart: 'hard' | 'soft' | 'pairs'. */
export function basicStrategyTable(kind) {
  const head = UP.map(u => `<th class="c">${u === 'T' ? '10' : u}</th>`).join('');
  const rows = BASIC[kind].map(([hand, plays]) =>
    `<tr><th>${hand}</th>${plays.map(p => `<td class="c ${BS_CLASS[p]}">${p}</td>`).join('')}</tr>`).join('');
  return `<div class="table-wrap bs"><table><tr><th>${kind === 'pairs' ? 'Pair' : kind === 'soft' ? 'Soft hand' : 'Hard total'}</th>${head}</tr>${rows}</table></div>`;
}

/** Running count ÷ decks remaining, floored (the trainer's default rounding). */
export function tcConversionTable() {
  const decks = [6, 5, 4, 3, 2, 1, 0.5];
  const rcs = [-6, -3, 2, 4, 6, 8, 10, 12];
  const head = decks.map(d => `<th class="c">${d === 0.5 ? '½' : d}</th>`).join('');
  const rows = rcs.map(rc => `<tr><th>${fmtNum(rc)}</th>${decks.map(d => {
    const tc = Math.floor(clean(rc / d));
    return `<td class="c num ${tc >= 2 ? 'good' : tc < 0 ? 'bad' : ''}">${fmtNum(tc)}</td>`;
  }).join('')}</tr>`).join('');
  return wrap(`<tr><th>Running count ↓ · decks left →</th>${head}</tr>${rows}`);
}

/** Placeholder name → HTML, for `<!--@table:name-->` in page sources. */
export const TABLES = {
  'basic-hard': () => basicStrategyTable('hard'),
  'basic-soft': () => basicStrategyTable('soft'),
  'basic-pairs': () => basicStrategyTable('pairs'),
  'tc-conversion': tcConversionTable,
  edge: edgeTable,
  scenarios: scenarioTable,
  'tags-hilo': () => tagTable('hilo'),
  'systems-tags': systemsTagTable,
  'systems-compare': systemsCompareTable,
  'deviations-i18': () => deviationsTable('Illustrious 18'),
  'deviations-fab4': () => deviationsTable('Fab 4'),
};
