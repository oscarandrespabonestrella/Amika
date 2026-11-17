-- 0024c Seat uniqueness stays an immediate check for direct writes (a duplicate seat fails at
-- once); only save_play defers it, so seats can be swapped inside one call. It also refuses
-- the same player twice in a payload (23505), as before the in-place update.
alter table public.play_participants
  drop constraint play_participants_play_id_seat_key,
  add constraint play_participants_play_id_seat_key
    unique (play_id, seat) deferrable initially immediate;

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
  -- seats may be swapped inside this call; the check runs at commit
  set constraints public.play_participants_play_id_seat_key deferred;
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
    if v_part = any (v_keep) then
      raise exception 'the same player twice in one match' using errcode = '23505';
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
