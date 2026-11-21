-- 0030 Game night (Phase 9, part 1). A host plans a night: a short list of games that
-- friends vote on. This migration holds the tables, the read access rules and the picker.
--  * game_nights / game_night_games: the host manages them directly (RLS).
--  * game_night_members / game_night_votes: nobody writes them directly. The SECURITY
--    DEFINER functions of the next migrations do (invite, answer, vote, suggest, leave).
--    A vote belongs to exactly one voter: an account (user_id) or a guest (guest_id).
--    guest_id has no foreign key yet: the guests table arrives with the public link.
--  * Reading: the host, or an accepted member who is still a friend of the host
--    (is_night_member). Removing the friendship removes the access at once.
--  * A night closes by itself: night_is_open() is false once the day after starts_on
--    has ended (UTC). Every shared write function must use it (error GN002).
--  * Caps: 20 open nights per host and 12 games per night (error GN004).
--  * Error codes of the whole feature: GN001 not a friend, GN002 night closed,
--    GN003 already invited, GN004 cap reached, GN005 invalid link, GN006 game not in
--    your library.
--  * Deleting a game from the host's library keeps it in the night: the list keeps a
--    name and cover snapshot.
--  * picker_candidates(): the host's owned base games filtered like search_library,
--    with play count and last played date. SECURITY INVOKER: RLS applies.

create table public.game_nights (
  id          uuid primary key default gen_random_uuid(),
  owner_id    text not null default public.current_user_id()
                references public.profiles (id) on delete cascade,
  title       text not null check (char_length(title) between 1 and 80),
  starts_on   date not null,
  players     smallint check (players is null or players between 1 and 100),
  max_minutes smallint check (max_minutes is null or max_minutes between 5 and 1440),
  group_id    uuid references public.player_groups (id) on delete set null,
  status      text not null default 'open' check (status in ('open', 'closed')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index game_nights_owner_idx on public.game_nights (owner_id, starts_on desc);
create index game_nights_group_idx on public.game_nights (group_id) where group_id is not null;

create trigger game_nights_set_updated_at
  before update on public.game_nights
  for each row execute function public.set_updated_at();

create table public.game_night_games (
  id             uuid primary key default gen_random_uuid(),
  night_id       uuid not null references public.game_nights (id) on delete cascade,
  game_id        uuid not null references public.games (id) on delete cascade,
  added_by       text references public.profiles (id) on delete set null,
  source         text not null check (source in ('host', 'suggested')),
  pinned         boolean not null default false,
  played         boolean not null default false,
  name_snapshot  text not null check (char_length(name_snapshot) between 1 and 200),
  cover_snapshot text check (cover_snapshot is null or cover_snapshot ~ '^https://'),
  created_at     timestamptz not null default now(),
  unique (night_id, game_id)
);

create index game_night_games_game_idx on public.game_night_games (game_id);

create table public.game_night_members (
  night_id     uuid not null references public.game_nights (id) on delete cascade,
  user_id      text not null references public.profiles (id) on delete cascade,
  status       text not null default 'invited' check (status in ('invited', 'accepted', 'declined')),
  invited_at   timestamptz not null default now(),
  responded_at timestamptz,
  primary key (night_id, user_id)
);

create index game_night_members_user_idx on public.game_night_members (user_id);

create table public.game_night_votes (
  id            uuid primary key default gen_random_uuid(),
  night_game_id uuid not null references public.game_night_games (id) on delete cascade,
  user_id       text references public.profiles (id) on delete cascade,
  guest_id      uuid,
  created_at    timestamptz not null default now(),
  check (num_nonnulls(user_id, guest_id) = 1)
);

create unique index game_night_votes_user_key
  on public.game_night_votes (night_game_id, user_id) where user_id is not null;
create unique index game_night_votes_guest_key
  on public.game_night_votes (night_game_id, guest_id) where guest_id is not null;
create index game_night_votes_user_idx on public.game_night_votes (user_id) where user_id is not null;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Open and not past the end of the day after starts_on (UTC).
create function public.night_is_open(n public.game_nights)
returns boolean
language sql
stable
set search_path = ''
as $$
  select n.status = 'open'
     and now() < ((n.starts_on + 2)::timestamp at time zone 'UTC')
$$;

-- The host, or an accepted member who is still a friend of the host.
create function public.is_night_member(p_night uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.game_nights n
     where n.id = p_night
       and (
         n.owner_id = public.current_user_id()
         or (
           public.are_friends(n.owner_id, public.current_user_id())
           and exists (
             select 1 from public.game_night_members m
              where m.night_id = n.id
                and m.user_id = public.current_user_id()
                and m.status = 'accepted'
           )
         )
       )
  )
$$;

revoke all on function public.night_is_open(public.game_nights),
  public.is_night_member(uuid) from public, anon;
grant execute on function public.night_is_open(public.game_nights),
  public.is_night_member(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Caps (GN004). The profile / night row is locked so concurrent inserts are counted.
-- ---------------------------------------------------------------------------

create function public.enforce_game_night_cap()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status <> 'open' then
    return new;
  end if;
  perform 1 from public.profiles where id = new.owner_id for update;
  if (
    select count(*)
      from public.game_nights n
     where n.owner_id = new.owner_id
       and n.id <> new.id
       and public.night_is_open(n)
  ) >= 20 then
    raise exception 'too many open game nights' using errcode = 'GN004';
  end if;
  return new;
end;
$$;

create trigger game_nights_cap
  before insert or update of status on public.game_nights
  for each row execute function public.enforce_game_night_cap();

create function public.enforce_game_night_games_cap()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform 1 from public.game_nights where id = new.night_id for update;
  if (select count(*) from public.game_night_games where night_id = new.night_id) >= 12 then
    raise exception 'too many games in the night' using errcode = 'GN004';
  end if;
  return new;
end;
$$;

create trigger game_night_games_cap
  before insert on public.game_night_games
  for each row execute function public.enforce_game_night_games_cap();

-- Fill the snapshot from the catalog when the writer leaves it out.
create function public.fill_game_night_snapshot()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.name_snapshot is null or new.cover_snapshot is null then
    select coalesce(new.name_snapshot, g.name), coalesce(new.cover_snapshot, g.cover_url)
      into new.name_snapshot, new.cover_snapshot
      from public.games g
     where g.id = new.game_id;
  end if;
  return new;
end;
$$;

create trigger game_night_games_snapshot
  before insert on public.game_night_games
  for each row execute function public.fill_game_night_snapshot();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.game_nights enable row level security;
alter table public.game_night_games enable row level security;
alter table public.game_night_members enable row level security;
alter table public.game_night_votes enable row level security;

create policy game_nights_select_own on public.game_nights
  for select to authenticated
  using (owner_id = (select public.current_user_id()));

create policy game_nights_select_member on public.game_nights
  for select to authenticated
  using ((select public.is_night_member(id)));

-- The optional group shortcut must be one of your own groups (the subquery runs under RLS).
create policy game_nights_insert_own on public.game_nights
  for insert to authenticated
  with check (
    owner_id = (select public.current_user_id())
    and (group_id is null or exists (select 1 from public.player_groups g where g.id = group_id))
  );

create policy game_nights_update_own on public.game_nights
  for update to authenticated
  using (owner_id = (select public.current_user_id()))
  with check (
    owner_id = (select public.current_user_id())
    and (group_id is null or exists (select 1 from public.player_groups g where g.id = group_id))
  );

create policy game_nights_delete_own on public.game_nights
  for delete to authenticated
  using (owner_id = (select public.current_user_id()));

create policy game_night_games_select_own on public.game_night_games
  for select to authenticated
  using (exists (
    select 1 from public.game_nights n
     where n.id = night_id and n.owner_id = (select public.current_user_id())));

create policy game_night_games_select_member on public.game_night_games
  for select to authenticated
  using ((select public.is_night_member(night_id)));

create policy game_night_games_insert_own on public.game_night_games
  for insert to authenticated
  with check (
    source = 'host'
    and added_by = (select public.current_user_id())
    and exists (
      select 1 from public.game_nights n
       where n.id = night_id and n.owner_id = (select public.current_user_id()))
    and exists (select 1 from public.games g where g.id = game_id)
  );

create policy game_night_games_update_own on public.game_night_games
  for update to authenticated
  using (exists (
    select 1 from public.game_nights n
     where n.id = night_id and n.owner_id = (select public.current_user_id())))
  with check (exists (
    select 1 from public.game_nights n
     where n.id = night_id and n.owner_id = (select public.current_user_id())));

create policy game_night_games_delete_own on public.game_night_games
  for delete to authenticated
  using (exists (
    select 1 from public.game_nights n
     where n.id = night_id and n.owner_id = (select public.current_user_id())));

create policy game_night_members_select on public.game_night_members
  for select to authenticated
  using ((select public.is_night_member(night_id)));

-- The night game is readable under RLS only for members, so the vote follows it.
create policy game_night_votes_select on public.game_night_votes
  for select to authenticated
  using (exists (
    select 1 from public.game_night_games g where g.id = night_game_id));

revoke all on public.game_nights, public.game_night_games,
  public.game_night_members, public.game_night_votes from anon, authenticated;
grant select, delete on public.game_nights to authenticated;
grant insert (id, owner_id, title, starts_on, players, max_minutes, group_id, status)
  on public.game_nights to authenticated;
grant update (title, starts_on, players, max_minutes, group_id, status)
  on public.game_nights to authenticated;
grant select, delete on public.game_night_games to authenticated;
grant insert (id, night_id, game_id, added_by, source, pinned, name_snapshot, cover_snapshot)
  on public.game_night_games to authenticated;
grant update (pinned, played) on public.game_night_games to authenticated;
-- Members and votes: read only. Writes go through SECURITY DEFINER functions.
grant select on public.game_night_members, public.game_night_votes to authenticated;

-- ---------------------------------------------------------------------------
-- picker_candidates(): the host's owned base games for the picker.
-- Filters follow search_library (players, max duration). Plays are the ones the caller
-- took part in (my_participants), joined to plays for count and last date.
-- ---------------------------------------------------------------------------

create function public.picker_candidates(
  p_players     int default null,
  p_max_minutes int default null
)
returns table (
  game_id        uuid,
  name           text,
  cover_url      text,
  is_custom      boolean,
  min_players    smallint,
  max_players    smallint,
  min_playtime   smallint,
  max_playtime   smallint,
  is_favorite    boolean,
  rating         smallint,
  play_count     int,
  last_played_on date
)
language sql
stable
security invoker
set search_path = ''
as $$
  select g.id, g.name, g.cover_url, g.owner_id is not null,
         g.min_players, g.max_players, g.min_playtime, g.max_playtime,
         li.is_favorite, li.rating,
         coalesce(st.play_count, 0)::int, st.last_played_on
    from public.library_items li
    join public.games g on g.id = li.game_id
    left join lateral (
      select count(distinct p.id) as play_count, max(p.played_on) as last_played_on
        from public.my_participants() me
        join public.play_participants pp on pp.id = me.participant_id
        join public.plays p on p.id = pp.play_id
       where p.game_id = g.id
    ) st on true
   where li.user_id = (select public.current_user_id())
     and li.status = 'owned'
     and g.kind = 'base'
     and (p_players is null or (g.min_players <= p_players and coalesce(g.max_players, g.min_players) >= p_players))
     and (p_max_minutes is null or coalesce(g.min_playtime, g.max_playtime) <= p_max_minutes)
   order by public.f_unaccent(g.name), g.id
$$;

revoke all on function public.picker_candidates(int, int) from public, anon;
grant execute on function public.picker_candidates(int, int) to authenticated;
