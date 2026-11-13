// POST { ruleset } → { runId, seed }
// Issues the seed of a ranked run. The client cannot pick its own seed, so it
// cannot replay a shoe it already knows. A newer run abandons any open one.
import { RULESETS } from '../_shared/core/ranked.js';
import { randomSeed } from '../_shared/core/rng.js';
import { admin, handler, HttpError, json, requireUser } from '../_shared/http.ts';

Deno.serve(handler(async (req) => {
  const user = await requireUser(req);
  const { ruleset } = await req.json().catch(() => ({}));
  if (!RULESETS[ruleset]) throw new HttpError(400, 'unknown ruleset');

  const { data: profile } = await admin.from('profiles').select('id').eq('id', user.id).maybeSingle();
  if (!profile) throw new HttpError(400, 'choose a username first');

  await admin.from('runs').update({ status: 'abandoned' }).eq('user_id', user.id).eq('status', 'issued');
  const { data, error } = await admin.from('runs')
    .insert({ user_id: user.id, ruleset, seed: randomSeed() })
    .select('id, seed').single();
  if (error) throw error;
  return json({ runId: data.id, seed: Number(data.seed) });
}));
