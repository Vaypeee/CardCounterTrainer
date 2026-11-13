// POST { runId, log } → { status: 'verified' | 'rejected', score, reason?, rank? }
// Replays the run log against the seed issued by start-run (same core code as the
// trainer), recomputes the score and stores it. The client's own score is ignored.
import { sortKey, verifyRun } from '../_shared/core/ranked.js';
import { admin, handler, HttpError, json, requireUser } from '../_shared/http.ts';

const MAX_AGE_MS = 30 * 60 * 1000;   // a run must be submitted within 30 minutes
const CLOCK_SLACK_MS = 3000;          // client clock vs server clock

Deno.serve(handler(async (req) => {
  const user = await requireUser(req);
  const { runId, log } = await req.json().catch(() => ({}));
  if (typeof runId !== 'string') throw new HttpError(400, 'missing runId');

  const { data: run } = await admin.from('runs').select('*').eq('id', runId).eq('user_id', user.id).maybeSingle();
  if (!run) throw new HttpError(404, 'run not found');
  if (run.status !== 'issued') throw new HttpError(409, `run already ${run.status}`);

  const elapsed = Date.now() - Date.parse(run.issued_at);
  if (elapsed > MAX_AGE_MS) {
    await admin.from('runs').update({ status: 'abandoned' }).eq('id', run.id);
    throw new HttpError(410, 'run expired');
  }

  let result = verifyRun(run.ruleset, Number(run.seed), log);
  // The session clock can only run slower than real time (it stops for checks and pauses).
  if (result.ok && elapsed + CLOCK_SLACK_MS < log[log.length - 1].t) result = { ok: false, reason: 'faster than real time' };

  const verified = result.ok;
  const score = verified ? result.score : null;
  const { error } = await admin.from('runs').update({
    status: verified ? 'verified' : 'rejected',
    submitted_at: new Date().toISOString(),
    score,
    sort_key: score == null ? null : sortKey(run.ruleset, score),
    accuracy: verified ? Math.round(result.results.acc * 10) / 10 : null,
    reject_reason: verified ? null : result.reason,
    log: Array.isArray(log) ? log.slice(0, 5000) : null,
  }).eq('id', run.id);
  if (error) throw error;

  let rank = null, best = null;
  if (verified) {
    const { data: row } = await admin.from('ladder').select('rank, score')
      .eq('ruleset', run.ruleset).eq('user_id', user.id).maybeSingle();
    if (row) { rank = Number(row.rank); best = Number(row.score); }
  }
  return json({ status: verified ? 'verified' : 'rejected', score, reason: verified ? undefined : result.reason, rank, best });
}));
