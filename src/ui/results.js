/* Results screen: score sheet, running-count chart, check log. */
import { MODES, QUESTION_MODES, SYSTEMS } from '../core/config.js';
import { fmtDuration, fmtNum, fmtScore, plural } from '../core/format.js';
import { $ } from '../dom.js';
import { S } from '../state.js';
import { lineChart } from './charts.js';
import { share } from './share.js';

/** Ranked verification line under the accuracy: pending → verified (rank) / rejected / error. */
export function renderRankedStatus(st) {
  const el = $('#resRanked');
  el.hidden = !st;
  if (!st) return;
  const mode = S.mode;
  el.className = 'ranked-status' + (st.state === 'verified' ? ' good' : st.state === 'pending' ? '' : ' bad');
  el.textContent =
    st.state === 'pending' ? 'Verifying the run with the server…'
    : st.state === 'verified' ? (st.score == null ? 'Run verified, but it does not score (wrong final count).'
      : `✓ Run verified by the server: ${fmtScore(mode, st.score)}`)
    : st.state === 'rejected' ? `✗ Run rejected by the server: ${st.reason}.`
    : `Run not recorded: ${st.reason}.`;
}

/** The text shared by the results screen's "share" link. */
function resultText(R) {
  const name = MODES[S.mode].name, sub = $('#resSub').textContent;
  const head = sub.startsWith(name) ? sub : `${name} (${sub})`;   // the config line usually starts with the mode
  if (S.mode === 'speed') {
    return R.score != null ? `${head}: counted in ${fmtScore(S.mode, R.score)} on Velua. Can you count faster?`
      : `${head} on Velua, the free card counting trainer.`;
  }
  const acc = R.total ? `${Math.round(R.acc)}% accuracy` : '';
  const score = R.score != null ? `score ${fmtScore(S.mode, R.score)}` : '';
  return `${head}: ${[acc, score].filter(Boolean).join(', ')} on Velua. Can you beat it?`;
}
let lastResult = null;
export function initResultsShare() {
  $('#shareBtn').addEventListener('click', e => { if (lastResult) share(resultText(lastResult), e.currentTarget); });
}

export function renderResults(R) {
  lastResult = R;
  const q = QUESTION_MODES.includes(S.mode);
  const st = S.settings;
  renderRankedStatus(null);
  $('#resTitle').textContent = MODES[S.mode].name;
  $('#resTime').textContent = new Date().toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  $('#resSub').textContent = $('#configLine').textContent || (S.mode === 'deviations' ? 'Hi-Lo indices' : `${SYSTEMS[S.sys].name} · ${plural(st.decks, 'deck')}`);
  $('#resAcc').textContent = R.total ? `${Math.round(R.acc)}%` : '—';
  $('#resAccSub').textContent = R.total ? `${R.correct} of ${R.total} ${q ? 'answers' : 'checks'} correct` : 'No checks answered';
  $('#resLogCount').textContent = plural(S.checks.length, 'entry').replace('entrys', 'entries');
  $('#resBadge').hidden = !R.isNewBest;

  const scoreLabel = S.mode === 'speed' ? 'Time (if count correct)' : q ? 'Score (correct answers)' : 'Score (cards/min × accuracy)';
  const tiles = [
    [q ? 'Correct / wrong' : 'Checks correct / wrong', `${R.correct} / ${R.total - R.correct}`],
    [q ? 'Avg time / question' : 'Avg time / card', R.units ? `${(R.avgMs / 1000).toFixed(2)}s` : '—'],
    [q ? 'Questions / min' : 'Cards / min', R.units ? String(Math.round(R.perMin)) : '—'],
    ...(q ? [] : [['Cards counted', String(S.cardsSeen)]]),
    ['Total time', fmtDuration(R.totalMs)],
    ['Longest streak', String(R.streak)],
    [scoreLabel, fmtScore(S.mode, R.score)],
    ['Personal best', fmtScore(S.mode, R.best)],
  ];
  $('#resTiles').innerHTML = tiles.map(([k, v]) => `<div class="tile"><span>${k}</span><b>${v}</b></div>`).join('');

  // Chart
  const box = $('#resChartBox');
  if (S.mode === 'deviations') box.hidden = true;
  else {
    box.hidden = false;
    const dots = S.checks.map(c => ({ x: c.x, y: c.answer, cls: c.ok ? 'good' : 'bad' }));
    if (S.mode === 'truecount') {
      $('#resChartTitle').textContent = 'True count vs. your answers';
      $('#resChart').innerHTML = lineChart({ line: S.checks.map(c => ({ x: c.x, y: c.correct })), dots, lineDots: true });
      $('#resLegend').innerHTML = '<span><i class="l"></i>Correct true count</span><span><i style="background:var(--good)"></i>Your answer (right)</span><span><i style="background:var(--bad)"></i>Your answer (wrong)</span>';
    } else {
      $('#resChartTitle').textContent = 'Running count vs. your answers';
      $('#resChart').innerHTML = lineChart({ line: S.rcTrace.map((y, x) => ({ x, y })), step: true, dots });
      $('#resLegend').innerHTML = '<span><i class="l"></i>Actual running count (by card #)</span><span><i style="background:var(--good)"></i>Correct check</span><span><i style="background:var(--bad)"></i>Wrong check</span>';
    }
  }

  // History table
  const t = $('#resTable');
  if (!S.checks.length) { t.innerHTML = '<tr><td class="muted empty">No checks recorded.</td></tr>'; return; }
  const hasSit = q;
  const head = `<tr><th>${q ? '#' : 'Card'}</th>${hasSit ? '<th class="l">Situation</th>' : ''}<th>Answer</th><th>Correct</th><th>${S.mode === 'deviations' ? 'Result' : 'Diff'}</th><th>Time</th></tr>`;
  const rows = S.checks.map(c => {
    const isNum = typeof c.answer === 'number';
    const diff = S.mode === 'deviations' ? (c.ok ? '✓' : '✗') : c.ok ? '✓' : fmtNum(c.answer - c.correct);
    return `<tr><td><span class="sq ${c.ok ? 'good' : 'bad'}"></span>${c.label.replace(/^Q/, '')}</td>${hasSit ? `<td class="l">${c.situation}</td>` : ''}<td>${isNum ? fmtNum(c.answer) : c.answer}</td><td>${isNum ? fmtNum(c.correct) : c.correct}</td><td class="${c.ok ? 'good' : 'bad'}">${diff}</td><td>${(c.ms / 1000).toFixed(1)}s</td></tr>`;
  }).join('');
  t.innerHTML = `<thead>${head}</thead><tbody>${rows}</tbody>`;
}
