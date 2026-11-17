-- 0020 Phase 8a: shared matches. One record per match, several users with access.
--  * plays.owner_id: the CURRENT owner (starts as the creator; changes hands when the owner
--    deletes the match and others remain). plays.created_by stays as history and may become null.
--  * plays.status: 'open' (members write their own column) | 'closed'. Existing matches are closed.
--  * play_participants.user_id: the account behind a participant (null = a loose name).
--  * play_participants.display_name: snapshot of the name, because a guest cannot read the
--    owner's player roster.
--  * play_members: who has access and in which state. Nobody writes it directly: the SQL
--    functions of 0022 do (invitations, answers, leaving).

alter table public.plays
  add column owner_id text references public.profiles (id) on delete cascade,
  add column status text not null default 'closed' check (status in ('open', 'closed'));
update public.plays set owner_id = created_by;
alter table public.plays alter column owner_id set not null;
alter table public.plays alter column owner_id set default public.current_user_id();

alter table public.plays alter column created_by drop not null;
alter table public.plays drop constraint plays_created_by_fkey;
alter table public.plays
  add constraint plays_created_by_fkey
  foreign key (created_by) references public.profiles (id) on delete set null;
create index plays_owner_idx on public.plays (owner_id, game_id, played_on desc);

alter table public.play_participants
  add column user_id text references public.profiles (id) on delete set null,
  add column display_name text;
update public.play_participants pp
   set display_name = pl.name, user_id = pl.linked_user_id
  from public.players pl
 where pl.id = pp.player_id;
alter table public.play_participants alter column display_name set not null;
alter table public.play_participants
  add constraint play_participants_display_name_check
  check (char_length(display_name) between 1 and 60);
create index play_participants_user_idx on public.play_participants (user_id)
  where user_id is not null;

-- Keep the snapshot filled for every writer (the old save_play does not know the column).
create function public.fill_participant_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.display_name is null or new.user_id is null then
    select coalesce(new.display_name, pl.name),
           coalesce(new.user_id, pl.linked_user_id)
      into new.display_name, new.user_id
      from public.players pl where pl.id = new.player_id;
  end if;
  return new;
end;
$$;
create trigger play_participants_identity before insert on public.play_participants
  for each row execute function public.fill_participant_identity();

-- Renaming a roster player renames the snapshot in that owner's matches.
create function public.sync_participant_names()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.name is distinct from old.name then
    update public.play_participants set display_name = new.name where player_id = new.id;
  end if;
  return new;
end;
$$;
create trigger players_sync_names after update of name on public.players
  for each row execute function public.sync_participant_names();

create table public.play_members (
  id             uuid primary key default gen_random_uuid(),
  play_id        uuid not null references public.plays (id) on delete cascade,
  user_id        text not null references public.profiles (id) on delete cascade,
  status         text not null check (status in ('invited', 'accepted', 'declined', 'left')),
  invited_by     text references public.profiles (id) on delete set null,
  invited_at     timestamptz not null default now(),
  responded_at   timestamptz,
  participant_id uuid references public.play_participants (id) on delete set null,
  unique (play_id, user_id)
);
create index play_members_user_idx on public.play_members (user_id, status);

-- Every match has its owner as an accepted member.
insert into public.play_members (play_id, user_id, status, invited_by, responded_at)
select id, owner_id, 'accepted', owner_id, created_at from public.plays;

create function public.add_owner_as_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.play_members (play_id, user_id, status, invited_by, responded_at)
  values (new.id, new.owner_id, 'accepted', new.owner_id, now())
  on conflict (play_id, user_id) do update set status = 'accepted';
  return new;
end;
$$;
create trigger plays_owner_member after insert on public.plays
  for each row execute function public.add_owner_as_member();

-- Caps (P0001): 12 members per match. PI004: 30 invitations per user per day.
create function public.enforce_member_caps()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select count(*) from public.play_members where play_id = new.play_id) >= 12 then
    raise exception 'too many members in this match' using errcode = 'P0001';
  end if;
  if new.invited_by is not null and new.invited_by <> new.user_id and
     (select count(*) from public.play_members
       where invited_by = new.invited_by and user_id <> new.invited_by
         and invited_at > now() - interval '1 day') >= 30 then
    raise exception 'daily invitation limit reached' using errcode = 'PI004';
  end if;
  return new;
end;
$$;
create trigger play_members_caps before insert on public.play_members
  for each row execute function public.enforce_member_caps();

alter table public.play_members enable row level security;
alter table public.play_members replica identity full;
alter publication supabase_realtime add table public.play_members;
