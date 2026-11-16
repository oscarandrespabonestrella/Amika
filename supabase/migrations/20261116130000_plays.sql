-- 0010 Matches (plays): who played, what each player scored, and which expansions.
-- A match is private to its creator. Players are free-text names (no user linking yet:
-- Phase 8). Totals, ranks and winners are computed by the server before saving; the
-- client never decides them (see src/features/plays/compute.ts).
-- A match optionally points at the sheet VERSION it was scored with (immutable, see 0007).
-- Everything is written atomically by public.save_play(jsonb).

create table public.plays (
  id                 uuid primary key default gen_random_uuid(),
  created_by         text not null default public.current_user_id()
                       references public.profiles (id) on delete cascade,
  game_id            uuid not null references public.games (id) on delete cascade,
  played_on          date not null default current_date,
  duration_minutes   smallint check (duration_minutes is null or duration_minutes between 1 and 1440),
  scoring_version_id uuid references public.scoring_sheet_versions (id),
  notes              text check (notes is null or char_length(notes) <= 2000),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index plays_creator_game_idx on public.plays (created_by, game_id, played_on desc);
create index plays_game_idx on public.plays (game_id);
create index plays_version_idx on public.plays (scoring_version_id)
  where scoring_version_id is not null;

create trigger plays_set_updated_at
  before update on public.plays
  for each row execute function public.set_updated_at();

create table public.play_participants (
  id           uuid primary key default gen_random_uuid(),
  play_id      uuid not null references public.plays (id) on delete cascade,
  seat         smallint not null check (seat between 0 and 11),
  display_name text not null check (char_length(display_name) between 1 and 60),
  total_score  integer check (total_score is null or total_score between -1000000000 and 1000000000),
  rank         smallint check (rank is null or rank >= 1),
  is_winner    boolean not null default false,
  unique (play_id, seat)
);

create table public.play_scores (
  participant_id uuid not null references public.play_participants (id) on delete cascade,
  category_key   text not null check (category_key ~ '^[a-z][a-z0-9_]{0,29}$'),
  value          jsonb not null check (octet_length(value::text) <= 500),
  primary key (participant_id, category_key)
);

create table public.play_expansions (
  play_id uuid not null references public.plays (id) on delete cascade,
  game_id uuid not null references public.games (id) on delete cascade,
  primary key (play_id, game_id)
);

create index play_expansions_game_idx on public.play_expansions (game_id);

-- ---------------------------------------------------------------------------
-- Caps (P0001): 5 000 matches per user, 12 players and 20 expansions per match.
-- ---------------------------------------------------------------------------

create function public.enforce_play_caps()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_table_name = 'plays' then
    if (select count(*) from public.plays where created_by = new.created_by) >= 5000 then
      raise exception 'too many matches' using errcode = 'P0001';
    end if;
  elsif tg_table_name = 'play_participants' then
    if (select count(*) from public.play_participants where play_id = new.play_id) >= 12 then
      raise exception 'too many players in this match' using errcode = 'P0001';
    end if;
  elsif tg_table_name = 'play_expansions' then
    if (select count(*) from public.play_expansions where play_id = new.play_id) >= 20 then
      raise exception 'too many expansions in this match' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

create trigger plays_cap before insert on public.plays
  for each row execute function public.enforce_play_caps();
create trigger play_participants_cap before insert on public.play_participants
  for each row execute function public.enforce_play_caps();
create trigger play_expansions_cap before insert on public.play_expansions
  for each row execute function public.enforce_play_caps();

-- ---------------------------------------------------------------------------
-- Row Level Security: only the creator, on every table.
-- ---------------------------------------------------------------------------

alter table public.plays             enable row level security;
alter table public.play_participants enable row level security;
alter table public.play_scores       enable row level security;
alter table public.play_expansions   enable row level security;

create policy plays_select_own on public.plays
  for select to authenticated
  using (created_by = (select public.current_user_id()));

-- Only as yourself, for a game you can see, with a sheet version you can see (RLS on
-- scoring_sheet_versions applies in the subquery: that means your own sheets).
create policy plays_insert_own on public.plays
  for insert to authenticated
  with check (
    created_by = (select public.current_user_id())
    and exists (select 1 from public.games g where g.id = game_id)
    and (scoring_version_id is null
         or exists (select 1 from public.scoring_sheet_versions v where v.id = scoring_version_id))
  );

create policy plays_update_own on public.plays
  for update to authenticated
  using (created_by = (select public.current_user_id()))
  with check (
    created_by = (select public.current_user_id())
    and (scoring_version_id is null
         or exists (select 1 from public.scoring_sheet_versions v where v.id = scoring_version_id))
  );

create policy plays_delete_own on public.plays
  for delete to authenticated
  using (created_by = (select public.current_user_id()));

-- Children follow their play (RLS on plays applies inside the subquery).
create policy play_participants_all_own on public.play_participants
  for all to authenticated
  using (exists (select 1 from public.plays p where p.id = play_id))
  with check (exists (select 1 from public.plays p where p.id = play_id));

create policy play_scores_all_own on public.play_scores
  for all to authenticated
  using (exists (select 1 from public.play_participants pp where pp.id = participant_id))
  with check (exists (select 1 from public.play_participants pp where pp.id = participant_id));

create policy play_expansions_select_own on public.play_expansions
  for select to authenticated
  using (exists (select 1 from public.plays p where p.id = play_id));

create policy play_expansions_insert_own on public.play_expansions
  for insert to authenticated
  with check (
    exists (select 1 from public.plays p where p.id = play_id)
    and exists (select 1 from public.games g where g.id = game_id and g.kind = 'expansion')
  );

create policy play_expansions_delete_own on public.play_expansions
  for delete to authenticated
  using (exists (select 1 from public.plays p where p.id = play_id));

revoke all on public.plays, public.play_participants, public.play_scores,
  public.play_expansions from anon;

-- ---------------------------------------------------------------------------
-- save_play(p jsonb): creates or replaces a match and all its children in ONE
-- transaction. SECURITY INVOKER: every statement is checked by the policies above.
--   p = { playId?, gameId, playedOn, durationMinutes, scoringVersionId, notes,
--         expansionIds: [uuid], participants: [{ seat, name, total, rank, isWinner,
--         scores: { <categoryKey>: <json> } }] }
-- With playId the game and the sheet version are NOT changed (a match keeps its sheet);
-- P0002 when that match is not visible to the caller.
-- ---------------------------------------------------------------------------

create function public.save_play(p jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid := nullif(p ->> 'playId', '')::uuid;
  person jsonb;
  person_id uuid;
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
    insert into public.play_participants (play_id, seat, display_name, total_score, rank, is_winner)
    values (
      v_id,
      (person ->> 'seat')::smallint,
      person ->> 'name',
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

revoke all on function public.save_play(jsonb) from public, anon;
grant execute on function public.save_play(jsonb) to authenticated;
