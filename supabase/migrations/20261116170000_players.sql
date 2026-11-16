-- 0014 Player roster (Phase 6a). A match's players stop being loose text: each participant
-- references a player of the creator's own roster, so a player can be renamed, merged,
-- marked as "me" and, later, linked to an account (Phase 8) without touching matches.
--  * Names are unique per owner after normalization (lower-case, no accents, collapsed
--    spaces): "Ana", "ana " and "Aná" are the same player. The database decides.
--  * Existing participants become players (one per creator and normalized name); a
--    second equal name inside one match becomes "Name (2)".
--  * save_play creates or reuses players; merge_players moves matches between players.

create function public.normalize_player_name(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select lower(public.f_unaccent(btrim(regexp_replace(p, '\s+', ' ', 'g'))))
$$;

create table public.players (
  id             uuid primary key default gen_random_uuid(),
  owner_id       text not null default public.current_user_id()
                   references public.profiles (id) on delete cascade,
  name           text not null check (char_length(name) between 1 and 60),
  -- Phase 6: only the owner themself ("me"). Other accounts arrive with Phase 8.
  linked_user_id text references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (public.normalize_player_name(name) <> ''),
  check (linked_user_id is null or linked_user_id = owner_id)
);

create unique index players_owner_name_key
  on public.players (owner_id, public.normalize_player_name(name));
-- At most one "me" per owner.
create unique index players_owner_me_key
  on public.players (owner_id, linked_user_id) where linked_user_id is not null;

create trigger players_set_updated_at
  before update on public.players
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Data move: participants -> players. (The cap trigger is created AFTER this step,
-- so a creator with many names cannot make the migration fail on it.)
-- ---------------------------------------------------------------------------

alter table public.play_participants add column player_id uuid;

with ranked as (
  select pp.id, p.created_by,
         btrim(regexp_replace(pp.display_name, '\s+', ' ', 'g')) as display_name,
         p.created_at as play_created, pp.seat,
         row_number() over (
           partition by pp.play_id, public.normalize_player_name(pp.display_name)
           order by pp.seat
         ) as k
    from public.play_participants pp
    join public.plays p on p.id = pp.play_id
), named as (
  select id, created_by, play_created, seat,
         case when k = 1 then display_name
              else left(display_name, 60 - length(' (' || k || ')')) || ' (' || k || ')'
         end as final_name
    from ranked
), first_spelling as (
  select distinct on (created_by, public.normalize_player_name(final_name))
         created_by, final_name
    from named
   order by created_by, public.normalize_player_name(final_name), play_created, seat
), inserted as (
  insert into public.players (owner_id, name)
  select created_by, final_name from first_spelling
  returning id, owner_id, name
)
update public.play_participants pp
   set player_id = pl.id
  from named n
  join inserted pl
    on pl.owner_id = n.created_by
   and public.normalize_player_name(pl.name) = public.normalize_player_name(n.final_name)
 where pp.id = n.id;

-- Abort (nothing is applied) rather than corrupt data if the move left a gap.
do $$
begin
  if exists (select 1 from public.play_participants where player_id is null) then
    raise exception 'players migration: a participant was left without a player';
  end if;
  if exists (
    select 1 from public.play_participants group by play_id, player_id having count(*) > 1
  ) then
    raise exception 'players migration: the same player twice in one match';
  end if;
end;
$$;

alter table public.play_participants alter column player_id set not null;
alter table public.play_participants
  add constraint play_participants_player_fkey
  foreign key (player_id) references public.players (id);
alter table public.play_participants
  add constraint play_participants_play_player_key unique (play_id, player_id);
create index play_participants_player_idx on public.play_participants (player_id);
alter table public.play_participants drop column display_name;

-- ---------------------------------------------------------------------------
-- Cap: 200 players per user (P0001), serialised on the owner's profile row.
-- ---------------------------------------------------------------------------

create function public.enforce_player_cap()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform 1 from public.profiles where id = new.owner_id for update;
  if (select count(*) from public.players where owner_id = new.owner_id) >= 200 then
    raise exception 'too many players' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger players_cap before insert on public.players
  for each row execute function public.enforce_player_cap();

-- ---------------------------------------------------------------------------
-- Row Level Security: the roster belongs to its owner.
-- ---------------------------------------------------------------------------

alter table public.players enable row level security;

create policy players_select_own on public.players
  for select to authenticated
  using (owner_id = (select public.current_user_id()));

create policy players_insert_own on public.players
  for insert to authenticated
  with check (owner_id = (select public.current_user_id()));

create policy players_update_own on public.players
  for update to authenticated
  using (owner_id = (select public.current_user_id()))
  with check (owner_id = (select public.current_user_id()));

create policy players_delete_own on public.players
  for delete to authenticated
  using (owner_id = (select public.current_user_id()));

revoke all on public.players from anon;
revoke insert, update on public.players from authenticated;
grant insert (id, owner_id, name, linked_user_id) on public.players to authenticated;
grant update (name, linked_user_id) on public.players to authenticated;

-- A participant must be one of YOUR players (RLS on players applies in the subquery).
drop policy play_participants_all_own on public.play_participants;
create policy play_participants_all_own on public.play_participants
  for all to authenticated
  using (exists (select 1 from public.plays p where p.id = play_id))
  with check (
    exists (select 1 from public.plays p where p.id = play_id)
    and exists (select 1 from public.players pl where pl.id = player_id)
  );

-- ---------------------------------------------------------------------------
-- save_play: participants are { seat, playerId?, name, total, rank, isWinner, scores }.
-- With playerId that player is used (RLS: it must be yours); without it the player is
-- created or REUSED by normalized name. Everything else as in 0010.
-- ---------------------------------------------------------------------------

create or replace function public.save_play(p jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid := nullif(p ->> 'playId', '')::uuid;
  person jsonb;
  person_id uuid;
  v_player uuid;
begin
  if v_id is null then
    insert into public.plays (game_id, played_on, duration_minutes, scoring_version_id, notes)
    values (
      (p ->> 'gameId')::uuid,
      (p ->> 'playedOn')::date,
      nullif(p ->> 'durationMinutes', '')::smallint,
      nullif(p ->> 'scoringVersionId', '')::uuid,
      nullif(p ->> 'notes', '')
    )
    returning id into v_id;
  else
    update public.plays
       set played_on = (p ->> 'playedOn')::date,
           duration_minutes = nullif(p ->> 'durationMinutes', '')::smallint,
           notes = nullif(p ->> 'notes', '')
     where id = v_id;
    if not found then
      raise exception 'match not found' using errcode = 'P0002';
    end if;
    delete from public.play_participants where play_id = v_id; -- scores cascade
    delete from public.play_expansions where play_id = v_id;
  end if;

  for person in select * from jsonb_array_elements(coalesce(p -> 'participants', '[]'::jsonb)) loop
    v_player := nullif(person ->> 'playerId', '')::uuid;
    if v_player is null then
      insert into public.players (name) values (person ->> 'name')
      on conflict (owner_id, (public.normalize_player_name(name)))
        do update set name = players.name
      returning id into v_player;
    end if;

    insert into public.play_participants (play_id, seat, player_id, total_score, rank, is_winner)
    values (
      v_id,
      (person ->> 'seat')::smallint,
      v_player,
      nullif(person ->> 'total', '')::integer,
      nullif(person ->> 'rank', '')::smallint,
      coalesce((person ->> 'isWinner')::boolean, false)
    )
    returning id into person_id;

    insert into public.play_scores (participant_id, category_key, value)
    select person_id, e.key, e.value
      from jsonb_each(coalesce(person -> 'scores', '{}'::jsonb)) e;
  end loop;

  insert into public.play_expansions (play_id, game_id)
  select v_id, x::uuid
    from jsonb_array_elements_text(coalesce(p -> 'expansionIds', '[]'::jsonb)) x;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- merge_players(keep, remove): the removed player's matches move to the kept one, then
-- the removed player is deleted (the "me" mark moves too). One transaction.
-- P0002: a player is not yours / does not exist. PL001: they played together in some
-- match (merging would put one player twice in it). 22023: the same player twice.
-- ---------------------------------------------------------------------------

create function public.merge_players(p_keep uuid, p_remove uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_link text;
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
  update public.play_participants set player_id = p_keep where player_id = p_remove;
  delete from public.players where id = p_remove;
  if v_link is not null then
    update public.players set linked_user_id = v_link
     where id = p_keep and linked_user_id is null;
  end if;
end;
$$;

revoke all on function public.merge_players(uuid, uuid) from public, anon;
grant execute on function public.merge_players(uuid, uuid) to authenticated;
