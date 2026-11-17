-- 0021b owner_id follows created_by when a writer that is not a signed-in user (fixtures,
-- admin scripts) inserts a match without it. Signed-in users still get current_user_id().
create function public.default_play_owner()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.owner_id := coalesce(new.owner_id, new.created_by);
  return new;
end;
$$;

alter table public.plays alter column owner_id drop not null;
create trigger plays_default_owner before insert on public.plays
  for each row execute function public.default_play_owner();
alter table public.plays
  add constraint plays_owner_not_null check (owner_id is not null) not valid;
alter table public.plays validate constraint plays_owner_not_null;
