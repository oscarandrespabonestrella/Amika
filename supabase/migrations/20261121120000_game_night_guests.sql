-- 0032 Game night (Phase 9, part 3): public link and guest functions.
-- A host shares a link (/n/<token>). The token is 32 random bytes; the database only ever
-- sees its sha256 (hex), so a leaked backup cannot rebuild links. Guests have no account:
-- the first vote creates a guest row, identified by a random key kept in a cookie (again
-- only its sha256 is stored).
--  * Security model: the guest_* functions and log_night_request are called ONLY by a Next
--    route handler with the service-role client, never by browsers. They are SECURITY
--    DEFINER, with no execute for public / anon / authenticated.
--  * create_night_link / revoke_night_link: host only, called as the host (authenticated).
--  * One non-revoked link per night. It expires at 00:00 UTC two days after starts_on (the
--    same instant the night closes). Unknown, expired or revoked link: GN005. Writes on a
--    closed night: GN002. 30 guests per link: GN004.
--  * guest_night_state returns only what the public page shows: no user ids, no other
--    nights, no library data.
--  * night_votes (0031) is recreated so guest votes carry the guest's display name.

-- ---------------------------------------------------------------------------
-- Tables: no policies => only the service role / definer functions touch them.
-- ---------------------------------------------------------------------------

create table public.game_night_links (
  id         uuid primary key default gen_random_uuid(),
  night_id   uuid not null references public.game_nights (id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);

create unique index game_night_links_active_key
  on public.game_night_links (night_id) where revoked_at is null;

create table public.game_night_guests (
  id           uuid primary key default gen_random_uuid(),
  link_id      uuid not null references public.game_night_links (id) on delete cascade,
  key_hash     text not null check (key_hash ~ '^[0-9a-f]{64}$'),
  display_name text not null check (char_length(display_name) between 1 and 40),
  created_at   timestamptz not null default now(),
  unique (link_id, key_hash)
);

-- Votes of a guest disappear with the guest (and with the link, and with the night).
alter table public.game_night_votes
  add constraint game_night_votes_guest_fk
  foreign key (guest_id) references public.game_night_guests (id) on delete cascade;
create index game_night_votes_guest_idx on public.game_night_votes (guest_id) where guest_id is not null;

-- Frequency log of the route handler (soft limit), like manual_requests.
create table public.game_night_requests (
  id         bigint generated always as identity primary key,
  link_id    uuid not null references public.game_night_links (id) on delete cascade,
  guest_id   uuid references public.game_night_guests (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index game_night_requests_link_time_idx
  on public.game_night_requests (link_id, created_at desc);

alter table public.game_night_links enable row level security;
alter table public.game_night_guests enable row level security;
alter table public.game_night_requests enable row level security;
revoke all on public.game_night_links, public.game_night_guests,
  public.game_night_requests from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Host: create and revoke the link
-- ---------------------------------------------------------------------------

create function public.create_night_link(p_night uuid, p_token_hash text)
returns timestamptz
language plpgsql security definer
set search_path = ''
as $$
declare
  me text := public.current_user_id();
  v_night public.game_nights;
  v_expires timestamptz;
begin
  select * into v_night from public.game_nights where id = p_night for update;
  if me is null or not found or v_night.owner_id <> me then
    raise exception 'not the host of this night' using errcode = '42501';
  end if;
  if not public.night_is_open(v_night) then
    raise exception 'the night is closed' using errcode = 'GN002';
  end if;

  v_expires := (v_night.starts_on + 2)::timestamp at time zone 'UTC';
  update public.game_night_links
     set revoked_at = now()
   where night_id = p_night and revoked_at is null;
  insert into public.game_night_links (night_id, token_hash, expires_at)
  values (p_night, p_token_hash, v_expires);
  return v_expires;
end;
$$;

create function public.revoke_night_link(p_night uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  me text := public.current_user_id();
begin
  if me is null or not exists (
    select 1 from public.game_nights where id = p_night and owner_id = me
  ) then
    raise exception 'not the host of this night' using errcode = '42501';
  end if;
  update public.game_night_links
     set revoked_at = now()
   where night_id = p_night and revoked_at is null;
end;
$$;

revoke all on function public.create_night_link(uuid, text),
  public.revoke_night_link(uuid) from public, anon;
grant execute on function public.create_night_link(uuid, text),
  public.revoke_night_link(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Internal: resolve a token hash to a live link (GN005 otherwise). Not callable by clients.
-- ---------------------------------------------------------------------------

create function public.resolve_night_link(p_token_hash text)
returns public.game_night_links
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_link public.game_night_links;
begin
  select * into v_link from public.game_night_links where token_hash = p_token_hash;
  if not found or v_link.revoked_at is not null or v_link.expires_at <= now() then
    raise exception 'invalid link' using errcode = 'GN005';
  end if;
  return v_link;
end;
$$;

revoke all on function public.resolve_night_link(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Guest functions (service role only)
-- ---------------------------------------------------------------------------

create function public.guest_night_state(p_token_hash text, p_guest_key_hash text default null)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_link public.game_night_links := public.resolve_night_link(p_token_hash);
  v_guest public.game_night_guests;
  v_night public.game_nights;
  v_result jsonb;
begin
  select * into v_night from public.game_nights where id = v_link.night_id;
  if p_guest_key_hash is not null then
    select * into v_guest from public.game_night_guests
     where link_id = v_link.id and key_hash = p_guest_key_hash;
  end if;

  select jsonb_build_object(
    'night', jsonb_build_object(
      'title', v_night.title,
      'startsOn', v_night.starts_on,
      'hostName', coalesce((select pr.display_name from public.profiles pr where pr.id = v_night.owner_id), ''),
      'status', case when public.night_is_open(v_night) then 'open' else 'closed' end
    ),
    'games', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', g.id,
        'name', g.name_snapshot,
        'cover', g.cover_snapshot,
        'minPlayers', cg.min_players,
        'maxPlayers', cg.max_players,
        'minPlaytime', cg.min_playtime,
        'maxPlaytime', cg.max_playtime,
        'votes', (select count(*) from public.game_night_votes v where v.night_game_id = g.id),
        'voters', coalesce((
          select jsonb_agg(coalesce(pr.display_name, gu.display_name, '') order by v.created_at, v.id)
            from public.game_night_votes v
            left join public.profiles pr on pr.id = v.user_id
            left join public.game_night_guests gu on gu.id = v.guest_id
           where v.night_game_id = g.id
        ), '[]'::jsonb),
        'mine', v_guest.id is not null and exists (
          select 1 from public.game_night_votes v
           where v.night_game_id = g.id and v.guest_id = v_guest.id)
      ) order by g.created_at, g.id)
        from public.game_night_games g
        join public.games cg on cg.id = g.game_id
       where g.night_id = v_night.id
    ), '[]'::jsonb),
    'guest', case when v_guest.id is not null
                  then jsonb_build_object('name', v_guest.display_name) end
  ) into v_result;
  return v_result;
end;
$$;

create function public.guest_join_night(p_token_hash text, p_name text, p_guest_key_hash text)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_link public.game_night_links := public.resolve_night_link(p_token_hash);
  v_night public.game_nights;
  v_id uuid;
begin
  -- Serialise joins on this link so the cap of 30 is exact.
  perform 1 from public.game_night_links where id = v_link.id for update;
  select * into v_night from public.game_nights where id = v_link.night_id;
  if not public.night_is_open(v_night) then
    raise exception 'the night is closed' using errcode = 'GN002';
  end if;

  select id into v_id from public.game_night_guests
   where link_id = v_link.id and key_hash = p_guest_key_hash;
  if found then
    update public.game_night_guests set display_name = btrim(p_name) where id = v_id;
    return v_id;
  end if;

  if (select count(*) from public.game_night_guests where link_id = v_link.id) >= 30 then
    raise exception 'too many guests' using errcode = 'GN004';
  end if;
  insert into public.game_night_guests (link_id, key_hash, display_name)
  values (v_link.id, p_guest_key_hash, btrim(p_name))
  returning id into v_id;
  return v_id;
end;
$$;

create function public.guest_toggle_vote(p_token_hash text, p_guest_key_hash text, p_night_game uuid)
returns boolean
language plpgsql security definer
set search_path = ''
as $$
declare
  v_link public.game_night_links := public.resolve_night_link(p_token_hash);
  v_night public.game_nights;
  v_guest uuid;
begin
  select * into v_night from public.game_nights where id = v_link.night_id for share;
  if not public.night_is_open(v_night) then
    raise exception 'the night is closed' using errcode = 'GN002';
  end if;
  select id into v_guest from public.game_night_guests
   where link_id = v_link.id and key_hash = p_guest_key_hash;
  if not found then
    raise exception 'guest not found' using errcode = 'P0002';
  end if;
  if not exists (
    select 1 from public.game_night_games where id = p_night_game and night_id = v_link.night_id
  ) then
    raise exception 'game not found in this night' using errcode = 'P0002';
  end if;

  delete from public.game_night_votes where night_game_id = p_night_game and guest_id = v_guest;
  if found then
    return false;
  end if;
  insert into public.game_night_votes (night_game_id, guest_id) values (p_night_game, v_guest)
  on conflict do nothing;
  return true;
end;
$$;

create function public.guest_rename(p_token_hash text, p_guest_key_hash text, p_name text)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_link public.game_night_links := public.resolve_night_link(p_token_hash);
  v_night public.game_nights;
begin
  select * into v_night from public.game_nights where id = v_link.night_id;
  if not public.night_is_open(v_night) then
    raise exception 'the night is closed' using errcode = 'GN002';
  end if;
  update public.game_night_guests
     set display_name = btrim(p_name)
   where link_id = v_link.id and key_hash = p_guest_key_hash;
  if not found then
    raise exception 'guest not found' using errcode = 'P0002';
  end if;
end;
$$;

-- Logs one request and returns the counts the route handler limits on: writes of this
-- guest in the last minute, writes on the whole link in the last hour (both include this
-- one). Rows older than an hour are dropped, so the table stays small.
create function public.log_night_request(p_token_hash text, p_guest_key_hash text)
returns table (last_minute int, last_hour int)
language plpgsql security definer
set search_path = ''
as $$
declare
  v_link public.game_night_links := public.resolve_night_link(p_token_hash);
  v_guest uuid;
begin
  select id into v_guest from public.game_night_guests
   where link_id = v_link.id and key_hash = p_guest_key_hash;
  delete from public.game_night_requests
   where link_id = v_link.id and created_at < now() - interval '1 hour';
  insert into public.game_night_requests (link_id, guest_id) values (v_link.id, v_guest);
  return query
    select (count(*) filter (where r.guest_id is not distinct from v_guest
                               and r.created_at > now() - interval '1 minute'))::int,
           count(*)::int
      from public.game_night_requests r
     where r.link_id = v_link.id and r.created_at > now() - interval '1 hour';
end;
$$;

revoke all on function
  public.guest_night_state(text, text),
  public.guest_join_night(text, text, text),
  public.guest_toggle_vote(text, text, uuid),
  public.guest_rename(text, text, text),
  public.log_night_request(text, text)
  from public, anon, authenticated;
grant execute on function
  public.guest_night_state(text, text),
  public.guest_join_night(text, text, text),
  public.guest_toggle_vote(text, text, uuid),
  public.guest_rename(text, text, text),
  public.log_night_request(text, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- night_votes: guests now have a name.
-- ---------------------------------------------------------------------------

create or replace function public.night_votes(p_night uuid)
returns table (night_game_id uuid, voter_name text, is_guest boolean)
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not public.is_night_member(p_night) then
    raise exception 'not a member of this night' using errcode = '42501';
  end if;
  return query
    select v.night_game_id, coalesce(pr.display_name, gu.display_name, ''), v.guest_id is not null
      from public.game_night_votes v
      join public.game_night_games g on g.id = v.night_game_id
      left join public.profiles pr on pr.id = v.user_id
      left join public.game_night_guests gu on gu.id = v.guest_id
     where g.night_id = p_night
     order by v.created_at, v.id;
end;
$$;
