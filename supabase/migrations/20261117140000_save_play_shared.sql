-- 0024 Phase 8a: saving a shared match without destroying what the guests wrote, closing it,
-- writing your own column, and linking a roster name to a friend (with their confirmation).

-- Seats can be swapped inside one transaction: the unique check waits until commit.
alter table public.play_participants
  drop constraint play_participants_play_id_seat_key,
  add constraint play_participants_play_id_seat_key
    unique (play_id, seat) deferrable initially deferred;

-- ---------------------------------------------------------------------------
-- Linking a roster player to a friend. players.linked_user_id may now be "me" or a friend,
-- but a friend only through respond_player_link (a flag set inside the function), never by a
-- direct client update.
-- ---------------------------------------------------------------------------

do $$
declare r record;
begin
  for r in
    select conname from pg_constraint
     where conrelid = 'public.players'::regclass and contype = 'c'
       and pg_get_constraintdef(oid) like '%linked_user_id%'
  loop
    execute format('alter table public.players drop constraint %I', r.conname);
  end loop;
end $$;

create function public.guard_player_link()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.linked_user_id is not null and new.linked_user_id <> new.owner_id
     and coalesce(current_setting('amika.link_ok', true), '') <> '1' then
    raise exception 'a player is linked to a friend only through a confirmed request'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger players_link_guard before insert or update of linked_user_id on public.players
  for each row execute function public.guard_player_link();

create table public.player_link_requests (
  id           uuid primary key default gen_random_uuid(),
  owner_id     text not null references public.profiles (id) on delete cascade,
  player_id    uuid not null references public.players (id) on delete cascade,
  friend_id    text not null references public.profiles (id) on delete cascade,
  status       text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at   timestamptz not null default now(),
  responded_at timestamptz
);
create unique index player_link_requests_pending_key
  on public.player_link_requests (player_id) where status = 'pending';
create index player_link_requests_friend_idx on public.player_link_requests (friend_id, status);
alter table public.player_link_requests enable row level security;
revoke all on public.player_link_requests from anon, authenticated;

-- The daily invitation cap does not apply to the bulk membership a confirmed link creates.
create or replace function public.enforce_member_caps()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if (select count(*) from public.play_members where play_id = new.play_id) >= 12 then
    raise exception 'too many members in this match' using errcode = 'P0001';
  end if;
  if coalesce(current_setting('amika.link_ok', true), '') <> '1'
     and new.invited_by is not null and new.invited_by <> new.user_id
     and (select count(*) from public.play_members
           where invited_by = new.invited_by and user_id <> new.invited_by
             and invited_at > now() - interval '1 day') >= 30 then
    raise exception 'daily invitation limit reached' using errcode = 'PI004';
  end if;
  return new;
end;
$$;

create function public.link_player_to_friend(p_player uuid, p_friend text)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  me text := public.current_user_id();
  v_id uuid;
begin
  if not exists (select 1 from public.players where id = p_player and owner_id = me) then
    raise exception 'not your player' using errcode = '42501';
  end if;
  if not public.are_friends(me, p_friend) then
    raise exception 'not your friend' using errcode = 'PI001';
  end if;
  select id into v_id from public.player_link_requests
   where player_id = p_player and status = 'pending';
  if found then
    update public.player_link_requests set friend_id = p_friend where id = v_id;
    return v_id;
  end if;
  insert into public.player_link_requests (owner_id, player_id, friend_id)
  values (me, p_player, p_friend) returning id into v_id;
  return v_id;
end;
$$;

-- "X assigned you N matches": the friend sees only who, which name and how many.
create function public.list_my_link_requests()
returns table (request_id uuid, owner_name text, player_name text, plays int)
language sql stable security definer
set search_path = ''
as $$
  select r.id, coalesce(o.display_name, ''), pl.name,
         (select count(distinct pp.play_id)::int
            from public.play_participants pp
            join public.plays p on p.id = pp.play_id
            join public.games g on g.id = p.game_id and g.owner_id is null
           where pp.player_id = r.player_id)
    from public.player_link_requests r
    join public.players pl on pl.id = r.player_id
    left join public.profiles o on o.id = r.owner_id
   where r.friend_id = public.current_user_id() and r.status = 'pending'
   order by r.created_at desc
$$;

create function public.respond_player_link(p_request uuid, p_accept boolean)
returns int
language plpgsql security definer
set search_path = ''
as $$
declare
  me text := public.current_user_id();
  r public.player_link_requests;
  n int;
begin
  select * into r from public.player_link_requests
   where id = p_request and friend_id = me and status = 'pending' for update;
  if not found then
    raise exception 'request not found' using errcode = 'P0002';
  end if;
  if not p_accept then
    update public.player_link_requests set status = 'declined', responded_at = now() where id = p_request;
    return 0;
  end if;

  perform set_config('amika.link_ok', '1', true);
  update public.players set linked_user_id = me where id = r.player_id;
  update public.play_participants pp set user_id = me
    from public.plays p, public.games g
   where pp.player_id = r.player_id and p.id = pp.play_id
     and g.id = p.game_id and g.owner_id is null;
  insert into public.play_members (play_id, user_id, status, invited_by, responded_at, participant_id)
  select pp.play_id, me, 'accepted', r.owner_id, now(), pp.id
    from public.play_participants pp
    join public.plays p on p.id = pp.play_id
    join public.games g on g.id = p.game_id and g.owner_id is null
   where pp.player_id = r.player_id
  on conflict (play_id, user_id) do update
    set status = 'accepted', responded_at = now(), participant_id = excluded.participant_id;
  get diagnostics n = row_count;
  update public.player_link_requests set status = 'accepted', responded_at = now() where id = p_request;
  perform set_config('amika.link_ok', '', true);
  return n;
end;
$$;

create function public.unlink_player(p_player uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  me text := public.current_user_id();
  v_friend text;
begin
  select linked_user_id into v_friend from public.players where id = p_player and owner_id = me;
  if not found then
    raise exception 'not your player' using errcode = '42501';
  end if;
  if v_friend is null or v_friend = me then
    return;
  end if;
  update public.play_members m set status = 'left', responded_at = now()
   where m.user_id = v_friend
     and m.participant_id in (select id from public.play_participants where player_id = p_player);
  update public.play_participants set user_id = null where player_id = p_player;
  perform set_config('amika.link_ok', '1', true);
  update public.players set linked_user_id = null where id = p_player;
  perform set_config('amika.link_ok', '', true);
end;
$$;

revoke all on function public.link_player_to_friend(uuid, text), public.list_my_link_requests(),
  public.respond_player_link(uuid, boolean), public.unlink_player(uuid) from public, anon;
grant execute on function public.link_player_to_friend(uuid, text), public.list_my_link_requests(),
  public.respond_player_link(uuid, boolean), public.unlink_player(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- save_play: participants are updated IN PLACE (by player), so the ids that members and their
-- scores hang from survive. For a participant with an account on an open match the payload's
-- scores are merged (what it mentions wins, the rest stays); otherwise they are replaced.
-- p.status ('open' | 'closed') is optional: a new match defaults to closed.
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
  v_player uuid;
  v_part uuid;
  v_user text;
  v_keep uuid[] := '{}';
  v_open boolean;
begin
  if v_id is null then
    insert into public.plays (game_id, played_on, duration_minutes, scoring_version_id, notes, status)
    values (
      (p ->> 'gameId')::uuid,
      (p ->> 'playedOn')::date,
      nullif(p ->> 'durationMinutes', '')::smallint,
      nullif(p ->> 'scoringVersionId', '')::uuid,
      nullif(p ->> 'notes', ''),
      coalesce(nullif(p ->> 'status', ''), 'closed')
    )
    returning id into v_id;
  else
    update public.plays
       set played_on = (p ->> 'playedOn')::date,
           duration_minutes = nullif(p ->> 'durationMinutes', '')::smallint,
           notes = nullif(p ->> 'notes', ''),
           status = coalesce(nullif(p ->> 'status', ''), status)
     where id = v_id;
    if not found then
      raise exception 'match not found' using errcode = 'P0002';
    end if;
    delete from public.play_expansions where play_id = v_id;
  end if;
  select status = 'open' into v_open from public.plays where id = v_id;

  for person in select * from jsonb_array_elements(coalesce(p -> 'participants', '[]'::jsonb)) loop
    v_player := nullif(person ->> 'playerId', '')::uuid;
    if v_player is null then
      insert into public.players (name) values (person ->> 'name')
      on conflict (owner_id, (public.normalize_player_name(name)))
        do update set name = players.name
      returning id into v_player;
    end if;

    select id, user_id into v_part, v_user
      from public.play_participants where play_id = v_id and player_id = v_player;
    if v_part is null then
      insert into public.play_participants (play_id, seat, player_id, total_score, rank, is_winner)
      values (
        v_id, (person ->> 'seat')::smallint, v_player,
        nullif(person ->> 'total', '')::integer,
        nullif(person ->> 'rank', '')::smallint,
        coalesce((person ->> 'isWinner')::boolean, false)
      )
      returning id into v_part;
    else
      update public.play_participants
         set seat = (person ->> 'seat')::smallint,
             total_score = nullif(person ->> 'total', '')::integer,
             rank = nullif(person ->> 'rank', '')::smallint,
             is_winner = coalesce((person ->> 'isWinner')::boolean, false)
       where id = v_part;
    end if;
    v_keep := v_keep || v_part;

    if v_user is not null and v_open then
      insert into public.play_scores (participant_id, category_key, value)
      select v_part, e.key, e.value
        from jsonb_each(coalesce(person -> 'scores', '{}'::jsonb)) e
      on conflict (participant_id, category_key) do update set value = excluded.value;
    else
      delete from public.play_scores where participant_id = v_part;
      insert into public.play_scores (participant_id, category_key, value)
      select v_part, e.key, e.value
        from jsonb_each(coalesce(person -> 'scores', '{}'::jsonb)) e;
    end if;
  end loop;

  delete from public.play_participants where play_id = v_id and not (id = any (v_keep));

  insert into public.play_expansions (play_id, game_id)
  select v_id, x::uuid
    from jsonb_array_elements_text(coalesce(p -> 'expansionIds', '[]'::jsonb)) x;

  return v_id;
end;
$$;

-- The owner closes the match with totals, ranks and winners ALREADY computed by the server
-- (src/features/plays/compute.ts); nobody but the owner can (RLS).
create function public.close_play(p_play uuid, p jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  person jsonb;
begin
  update public.plays set status = 'closed' where id = p_play;
  if not found then
    raise exception 'match not found' using errcode = 'P0002';
  end if;
  for person in select * from jsonb_array_elements(coalesce(p -> 'participants', '[]'::jsonb)) loop
    update public.play_participants
       set total_score = nullif(person ->> 'total', '')::integer,
           rank = nullif(person ->> 'rank', '')::smallint,
           is_winner = coalesce((person ->> 'isWinner')::boolean, false)
     where play_id = p_play and seat = (person ->> 'seat')::smallint;
  end loop;
end;
$$;

-- A member writes THEIR OWN column while the match is open (RLS also enforces it).
create function public.save_my_scores(p_play uuid, p_scores jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_part uuid;
  v_status text;
begin
  select pp.id, p.status into v_part, v_status
    from public.play_participants pp
    join public.plays p on p.id = pp.play_id
   where pp.play_id = p_play and pp.user_id = (select public.current_user_id());
  if v_part is null then
    raise exception 'you are not a participant of this match' using errcode = 'P0002';
  end if;
  if v_status <> 'open' then
    raise exception 'the match is closed' using errcode = 'PI005';
  end if;
  delete from public.play_scores where participant_id = v_part;
  insert into public.play_scores (participant_id, category_key, value)
  select v_part, e.key, e.value from jsonb_each(coalesce(p_scores, '{}'::jsonb)) e;
end;
$$;

revoke all on function public.close_play(uuid, jsonb), public.save_my_scores(uuid, jsonb)
  from public, anon;
grant execute on function public.close_play(uuid, jsonb), public.save_my_scores(uuid, jsonb)
  to authenticated;
