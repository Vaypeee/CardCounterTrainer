/* Copies the pure game core (src/core) into supabase/functions/_shared/core so the
   Edge Functions replay runs with exactly the code the trainer runs.
   Run: bun run sync-core (done automatically by `bun run functions`). */
import { cpSync, rmSync } from 'node:fs';

const src = new URL('../src/core/', import.meta.url);
const dst = new URL('../supabase/functions/_shared/core/', import.meta.url);
rmSync(dst, { recursive: true, force: true });
cpSync(src, dst, { recursive: true });
console.log('src/core → supabase/functions/_shared/core');
