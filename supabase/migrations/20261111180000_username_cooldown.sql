-- =========================================================
-- Player names can be changed at most once every 30 days.
-- Choosing the first name is free; each later change is stamped in
-- username_changed_at and a trigger refuses another one within 30 days
-- (enforced in the database, so the client cannot bypass it).
-- =========================================================
alter table public.profiles add column username_changed_at timestamptz;

create function public.profiles_rename_cooldown()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.username is distinct from old.username then
    if old.username_changed_at is not null and old.username_changed_at > now() - interval '30 days' then
      raise exception 'You can change your player name again on %.',
        to_char(old.username_changed_at + interval '30 days', 'YYYY-MM-DD')
        using errcode = 'P0001', hint = 'rename_cooldown';
    end if;
    new.username_changed_at := now();
  else
    new.username_changed_at := old.username_changed_at;   -- clients cannot reset the stamp
  end if;
  return new;
end $$;

create trigger profiles_rename_cooldown before update on public.profiles
  for each row execute function public.profiles_rename_cooldown();

-- A new profile cannot arrive with a forged stamp either.
create function public.profiles_new_stamp()
returns trigger language plpgsql set search_path = public as $$
begin
  new.username_changed_at := null;
  return new;
end $$;
create trigger profiles_new_stamp before insert on public.profiles
  for each row execute function public.profiles_new_stamp();
