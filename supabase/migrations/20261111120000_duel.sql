-- =========================================================
-- Ranked 1v1 "Count Duel": Elo ratings, matchmaking queue, matches.
-- Clients can only READ their own match and the public ratings;
-- every write goes through the Edge Functions (service role).
-- =========================================================

-- ---------- Ratings ----------
create table public.ratings (
  user_id     uuid primary key references public.profiles (id) on delete cascade,
  elo         integer not null default 1000,
  games       integer not null default 0,
  wins        integer not null default 0,
  losses      integer not null default 0,
  draws       integer not null default 0,
  updated_at  timestamptz not null default now()
);
create index ratings_elo on public.ratings (elo desc);
alter table public.ratings enable row level security;
create policy "ratings are public" on public.ratings for select to anon, authenticated using (true);

-- ---------- Matchmaking queue (functions only) ----------
create table public.queue (
  user_id    uuid primary key references public.profiles (id) on delete cascade,
  elo        integer not null,
  joined_at  timestamptz not null default now(),
  seen_at    timestamptz not null default now(),
  match_id   uuid
);
alter table public.queue enable row level security;   -- no policies: invisible to clients

-- ---------- Matches ----------
-- state (public jsonb, see src/core/duel.js): rounds [{ n, pace, dealAt, a:[bool,bool], rc?, res? }]
-- result: p1 | p2 | draw | void. The seed lives in match_secrets, never readable by clients.
create table public.matches (
  id           uuid primary key default gen_random_uuid(),
  ruleset      text not null default 'duel-v1',
  p1           uuid not null references public.profiles (id) on delete cascade,
  p2           uuid not null references public.profiles (id) on delete cascade,
  p1_name      text not null,
  p2_name      text not null,
  p1_elo       integer not null,
  p2_elo       integer not null,
  status       text not null default 'live' check (status in ('live', 'finished')),
  state        jsonb not null,
  version      integer not null default 0,
  result       text check (result in ('p1', 'p2', 'draw', 'void')),
  reason       text,
  p1_delta     integer,
  p2_delta     integer,
  p1_seen      timestamptz not null default now(),
  p2_seen      timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  finished_at  timestamptz,
  check (p1 <> p2)
);
create index matches_p1 on public.matches (p1, status);
create index matches_p2 on public.matches (p2, status);
alter table public.matches enable row level security;
create policy "players read their matches" on public.matches for select to authenticated
  using ((select auth.uid()) in (p1, p2));
-- Live progress over Realtime (postgres_changes honours the policy above).
alter publication supabase_realtime add table public.matches;

create table public.match_secrets (
  match_id  uuid primary key references public.matches (id) on delete cascade,
  seed      bigint not null check (seed between 0 and 4294967295)
);
alter table public.match_secrets enable row level security;   -- no policies

create table public.match_answers (
  match_id     uuid not null references public.matches (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  round        integer not null check (round between 0 and 11),
  value        numeric not null,
  received_at  timestamptz not null default clock_timestamp(),
  primary key (match_id, user_id, round)          -- one answer per player per round
);
alter table public.match_answers enable row level security;   -- no policies

-- runs: one verified row per player per finished duel (its log = that player's answers).
alter table public.runs drop constraint runs_ruleset_check;
alter table public.runs add constraint runs_ruleset_check
  check (ruleset in ('flash-60', 'speed-1d', 'truecount-60', 'deviations-60', 'duel-v1'));
alter table public.runs add column match_id uuid references public.matches (id) on delete set null;

-- ---------- Pairing (atomic) ----------
-- Called by duel-queue for a player already in the queue. Locks the caller's row and the closest
-- waiting opponent within ±p_window (SKIP LOCKED: two players pairing at once never deadlock),
-- creates the match + secret and marks both queue rows. Returns the match id or null.
create function public.duel_pair(p_user uuid, p_window integer, p_seed bigint, p_state jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  me  public.queue;
  opp public.queue;
  mid uuid;
  st  jsonb;
begin
  select * into me from public.queue where user_id = p_user for update;
  if not found then return null; end if;
  if me.match_id is not null then return me.match_id; end if;

  select * into opp from public.queue q
   where q.user_id <> p_user and q.match_id is null
     and q.seen_at > now() - interval '10 seconds'
     and abs(q.elo - me.elo) <= p_window
   order by abs(q.elo - me.elo), q.joined_at
   for update skip locked limit 1;
  if not found then return null; end if;

  -- The player who waited longer is p1.
  if opp.joined_at < me.joined_at then
    insert into public.matches (p1, p2, p1_name, p2_name, p1_elo, p2_elo, state)
    select opp.user_id, me.user_id, a.username, b.username, opp.elo, me.elo, p_state
      from public.profiles a, public.profiles b where a.id = opp.user_id and b.id = me.user_id
    returning id into mid;
  else
    insert into public.matches (p1, p2, p1_name, p2_name, p1_elo, p2_elo, state)
    select me.user_id, opp.user_id, a.username, b.username, me.elo, opp.elo, p_state
      from public.profiles a, public.profiles b where a.id = me.user_id and b.id = opp.user_id
    returning id into mid;
  end if;
  insert into public.match_secrets (match_id, seed) values (mid, p_seed);
  update public.queue set match_id = mid where user_id in (me.user_id, opp.user_id);
  return mid;
end $$;

-- ---------- State transition (optimistic, atomic) ----------
-- Saves a new public state if nobody else changed the match since p_version was read.
-- When p_result is given the match finishes in the same transaction: ratings updated by the
-- deltas computed in the function (src/core/elo.js), queue rows cleared. Returns false on a lost race.
create function public.duel_commit(p_id uuid, p_version integer, p_state jsonb,
                                   p_result text default null, p_reason text default null,
                                   p_d1 integer default null, p_d2 integer default null)
returns boolean language plpgsql security definer set search_path = public as $$
declare m public.matches;
begin
  update public.matches set
         state = p_state, version = version + 1,
         status = case when p_result is null then 'live' else 'finished' end,
         result = p_result, reason = p_reason, p1_delta = p_d1, p2_delta = p_d2,
         finished_at = case when p_result is null then null else now() end
   where id = p_id and version = p_version and status = 'live'
   returning * into m;
  if not found then return false; end if;
  if p_result is not null then
    if p_result <> 'void' then
      update public.ratings set elo = elo + coalesce(p_d1, 0), games = games + 1,
             wins = wins + (p_result = 'p1')::int, losses = losses + (p_result = 'p2')::int,
             draws = draws + (p_result = 'draw')::int, updated_at = now()
       where user_id = m.p1;
      update public.ratings set elo = elo + coalesce(p_d2, 0), games = games + 1,
             wins = wins + (p_result = 'p2')::int, losses = losses + (p_result = 'p1')::int,
             draws = draws + (p_result = 'draw')::int, updated_at = now()
       where user_id = m.p2;
    end if;
    delete from public.queue where match_id = p_id;
  end if;
  return true;
end $$;
revoke execute on function public.duel_pair(uuid, integer, bigint, jsonb) from public, anon, authenticated;
revoke execute on function public.duel_commit(uuid, integer, jsonb, text, text, integer, integer) from public, anon, authenticated;

-- ---------- Elo ladder ----------
create view public.elo_ladder with (security_invoker = on) as
select r.user_id, p.username, r.elo, r.games, r.wins, r.losses, r.draws,
       rank() over (order by r.elo desc) as rank
  from public.ratings r join public.profiles p on p.id = r.user_id
 where r.games > 0;
grant select on public.elo_ladder to anon, authenticated;
grant execute on function public.duel_pair(uuid, integer, bigint, jsonb) to service_role;
grant execute on function public.duel_commit(uuid, integer, jsonb, text, text, integer, integer) to service_role;
