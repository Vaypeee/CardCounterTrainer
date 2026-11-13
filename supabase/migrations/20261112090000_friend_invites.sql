-- =========================================================
-- Friend challenges: a player creates an invite link, a friend opens it and accepts,
-- and both play a Count Duel with the usual rules. Friendly matches are UNRATED
-- (no Elo change, not counted in the ladder), so friends cannot farm rating off each other.
-- Like the rest of the duel, clients cannot read or write invites: duel-invite does it all.
-- =========================================================

alter table public.matches add column rated boolean not null default true;

create table public.invites (
  code        text primary key,
  host        uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  seen_at     timestamptz not null default now(),    -- host heartbeat: the host waits in the lobby
  match_id    uuid references public.matches (id) on delete set null
);
create index invites_host on public.invites (host);
alter table public.invites enable row level security;   -- no policies: invisible to clients

-- Accept an invite (atomic). Locks the invite, checks it is still open, that the host is still waiting
-- (heartbeat within 10 s) and that neither player is in a live match, then creates an unrated match
-- (host = p1) + its secret. Errors are raised as P0001 with a message for the player.
create function public.duel_accept(p_code text, p_guest uuid, p_seed bigint, p_state jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  inv public.invites;
  mid uuid;
begin
  select * into inv from public.invites where code = p_code for update;
  if not found then
    raise exception 'This invite link is not valid (it may have been cancelled).' using errcode = 'P0001';
  end if;
  if inv.match_id is not null then
    raise exception 'This invite was already used.' using errcode = 'P0001';
  end if;
  if inv.host = p_guest then
    raise exception 'This is your own invite: send the link to a friend.' using errcode = 'P0001';
  end if;
  if inv.seen_at < now() - interval '10 seconds' then
    raise exception 'Your friend is no longer waiting. Ask them for a new link.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.matches
              where status = 'live' and (p1 in (inv.host, p_guest) or p2 in (inv.host, p_guest))) then
    raise exception 'One of you is already in a match.' using errcode = 'P0001';
  end if;

  insert into public.matches (p1, p2, p1_name, p2_name, p1_elo, p2_elo, state, rated)
  select a.id, b.id, a.username, b.username, coalesce(ra.elo, 1000), coalesce(rb.elo, 1000), p_state, false
    from public.profiles a
    join public.profiles b on b.id = p_guest
    left join public.ratings ra on ra.user_id = a.id
    left join public.ratings rb on rb.user_id = b.id
   where a.id = inv.host
  returning id into mid;
  if mid is null then
    raise exception 'Choose a player name first.' using errcode = 'P0001';
  end if;

  insert into public.match_secrets (match_id, seed) values (mid, p_seed);
  update public.invites set match_id = mid where code = p_code;
  delete from public.queue where user_id in (inv.host, p_guest) and match_id is null;
  return mid;
end $$;
revoke execute on function public.duel_accept(text, uuid, bigint, jsonb) from public, anon, authenticated;
grant execute on function public.duel_accept(text, uuid, bigint, jsonb) to service_role;

-- duel_commit: same as before, but an unrated match never touches the ratings.
create or replace function public.duel_commit(p_id uuid, p_version integer, p_state jsonb,
                                              p_result text default null, p_reason text default null,
                                              p_d1 integer default null, p_d2 integer default null)
returns boolean language plpgsql security definer set search_path = public as $$
declare m public.matches;
begin
  update public.matches set
         state = p_state, version = version + 1,
         status = case when p_result is null then 'live' else 'finished' end,
         result = p_result, reason = p_reason,
         p1_delta = case when rated then p_d1 end, p2_delta = case when rated then p_d2 end,
         finished_at = case when p_result is null then null else now() end
   where id = p_id and version = p_version and status = 'live'
   returning * into m;
  if not found then return false; end if;
  if p_result is not null then
    if p_result <> 'void' and m.rated then
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
revoke execute on function public.duel_commit(uuid, integer, jsonb, text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.duel_commit(uuid, integer, jsonb, text, text, integer, integer) to service_role;
