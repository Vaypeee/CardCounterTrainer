-- =========================================================
-- Ranked play: player profiles, ranked runs, ladder view.
-- Scores are only ever written by the Edge Functions (service
-- role) after replaying the run log; clients can only read.
-- =========================================================

-- ---------- Profiles ----------
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  username    text not null unique check (username ~ '^[A-Za-z0-9_]{3,20}$'),
  created_at  timestamptz not null default now()
);
-- Case-insensitive uniqueness ("Alice" and "alice" are the same name).
create unique index profiles_username_lower on public.profiles (lower(username));

alter table public.profiles enable row level security;
create policy "profiles are public"       on public.profiles for select to anon, authenticated using (true);
create policy "create own profile"        on public.profiles for insert to authenticated with check ((select auth.uid()) = id);
create policy "rename own profile"        on public.profiles for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

-- ---------- Ranked runs ----------
-- issued    : seed handed out by start-run, run being played
-- verified  : replayed successfully, score recorded (score null = valid run that does not score)
-- rejected  : replay failed (reason in reject_reason)
-- abandoned : superseded by a newer run or never submitted
create table public.runs (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles (id) on delete cascade,
  ruleset        text not null check (ruleset in ('flash-60', 'speed-1d', 'truecount-60', 'deviations-60')),
  seed           bigint not null check (seed between 0 and 4294967295),
  status         text not null default 'issued' check (status in ('issued', 'verified', 'rejected', 'abandoned')),
  issued_at      timestamptz not null default now(),
  submitted_at   timestamptz,
  score          numeric,
  sort_key       numeric,          -- higher is better for every ruleset (Speed Count stores −time)
  accuracy       numeric,
  reject_reason  text,
  log            jsonb
);
create index runs_user_status on public.runs (user_id, status);
create index runs_ladder on public.runs (ruleset, sort_key desc) where status = 'verified' and score is not null;

alter table public.runs enable row level security;
-- Verified runs are public (ladder); players also see their own runs. No insert/update policies:
-- only the Edge Functions (service role, which bypasses RLS) write here.
create policy "verified runs are public" on public.runs for select to anon, authenticated
  using (status = 'verified' or (select auth.uid()) = user_id);

-- ---------- Ladder: each player's best verified score per ruleset ----------
create view public.ladder with (security_invoker = on) as
select ruleset, user_id, username, score, accuracy, submitted_at,
       rank() over (partition by ruleset order by sort_key desc, submitted_at asc) as rank
from (
  select distinct on (r.ruleset, r.user_id)
         r.ruleset, r.user_id, p.username, r.score, r.accuracy, r.sort_key, r.submitted_at
  from public.runs r
  join public.profiles p on p.id = r.user_id
  where r.status = 'verified' and r.score is not null
  order by r.ruleset, r.user_id, r.sort_key desc, r.submitted_at asc
) best;

grant select on public.ladder to anon, authenticated;
