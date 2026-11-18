-- 0027 Player groups (Phase 8b). A group is a private, saved list of the owner's own players
-- ("Thursday"), added to a match with one click. It is only a shortcut: a match never
-- stores its group, so editing a match never touches the group.
--  * Group names are unique per owner after normalization (like players).
--  * A member must be a player of the same owner: the policy checks it in the database.
--  * Deleting a player or a group removes only the membership rows (cascade).
--  * At most 50 groups per owner. A group cannot exceed 200 members: that is the
--    roster cap (players are unique inside a group).
--  * merge_players moves the removed player's memberships to the kept one.

create table public.player_groups (
  id         uuid primary key default gen_random_uuid(),
  owner_id   text not null default public.current_user_id()
               references public.profiles (id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 60),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (public.normalize_player_name(name) <> '')
);

create unique index player_groups_owner_name_key
  on public.player_groups (owner_id, public.normalize_player_name(name));

create trigger player_groups_set_updated_at
  before update on public.player_groups
  for each row execute function public.set_updated_at();

create table public.player_group_members (
  group_id  uuid not null references public.player_groups (id) on delete cascade,
  player_id uuid not null references public.players (id) on delete cascade,
  primary key (group_id, player_id)
);

create index player_group_members_player_idx on public.player_group_members (player_id);

create function public.enforce_player_group_cap()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform 1 from public.profiles where id = new.owner_id for update;
  if (select count(*) from public.player_groups where owner_id = new.owner_id) >= 50 then
    raise exception 'too many groups' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger player_groups_cap before insert on public.player_groups
  for each row execute function public.enforce_player_group_cap();

-- ---------------------------------------------------------------------------
-- Row Level Security: groups belong to their owner.
-- ---------------------------------------------------------------------------

alter table public.player_groups enable row level security;
alter table public.player_group_members enable row level security;

create policy player_groups_select_own on public.player_groups
  for select to authenticated
  using (owner_id = (select public.current_user_id()));

create policy player_groups_insert_own on public.player_groups
  for insert to authenticated
  with check (owner_id = (select public.current_user_id()));

create policy player_groups_update_own on public.player_groups
  for update to authenticated
  using (owner_id = (select public.current_user_id()))
  with check (owner_id = (select public.current_user_id()));

create policy player_groups_delete_own on public.player_groups
  for delete to authenticated
  using (owner_id = (select public.current_user_id()));

-- The subqueries run under RLS too: the group and the player must both be yours.
create policy player_group_members_select_own on public.player_group_members
  for select to authenticated
  using (exists (select 1 from public.player_groups g where g.id = group_id));

create policy player_group_members_insert_own on public.player_group_members
  for insert to authenticated
  with check (
    exists (select 1 from public.player_groups g where g.id = group_id)
    and exists (select 1 from public.players pl where pl.id = player_id)
  );

create policy player_group_members_delete_own on public.player_group_members
  for delete to authenticated
  using (exists (select 1 from public.player_groups g where g.id = group_id));

revoke all on public.player_groups, public.player_group_members from anon;
revoke insert, update on public.player_groups from authenticated;
grant insert (id, owner_id, name) on public.player_groups to authenticated;
grant update (name) on public.player_groups to authenticated;
revoke insert, update on public.player_group_members from authenticated;
grant insert (group_id, player_id) on public.player_group_members to authenticated;

-- ---------------------------------------------------------------------------
-- merge_players: as in 20261117161000, plus the memberships of the removed player move
-- to the kept one (no duplicate when both were in the same group).
-- ---------------------------------------------------------------------------

create or replace function public.merge_players(p_keep uuid, p_remove uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_link text;
  v_name text;
begin
  if p_keep = p_remove then
    raise exception 'cannot merge a player into itself' using errcode = '22023';
  end if;
  if not exists (select 1 from public.players where id = p_keep)
     or not exists (select 1 from public.players where id = p_remove) then
    raise exception 'player not found' using errcode = 'P0002';
  end if;
  if exists (
    select 1
      from public.play_participants a
      join public.play_participants b on b.play_id = a.play_id
     where a.player_id = p_keep and b.player_id = p_remove
  ) then
    raise exception 'these players played together in a match' using errcode = 'PL001';
  end if;

  select linked_user_id into v_link from public.players where id = p_remove;
  select name into v_name from public.players where id = p_keep;
  update public.play_participants
     set player_id = p_keep, display_name = v_name
   where player_id = p_remove;
  insert into public.player_group_members (group_id, player_id)
  select group_id, p_keep from public.player_group_members where player_id = p_remove
  on conflict do nothing;
  delete from public.players where id = p_remove; -- its memberships cascade
  if v_link is not null then
    update public.players set linked_user_id = v_link
     where id = p_keep and linked_user_id is null;
  end if;
end;
$$;
