-- 0031 Game night (Phase 9, part 2): what friends can do. Nobody writes game_night_members
-- or game_night_votes directly (0030): these SECURITY DEFINER functions check the caller.
--  * invite_to_night / respond_night_invite / leave_night: membership.
--  * suggest_night_game: a member suggests a base game from their own library. The name and
--    cover snapshot come from public.games, never from the caller.
--  * toggle_night_vote: the host or an accepted member votes / un-votes a game.
--  * night_invites / night_votes: reads that RLS cannot give (an invitee cannot see their own
--    member row yet; names of voters live in profiles).
--  Errors: GN001 not your friend, GN002 night closed, GN003 already invited / already in,
--  GN004 cap (3 suggestions per friend, 12 games, 30 invited friends), GN006 game not in your
--  library, 42501 not allowed, P0002 not found.
--  Leaving is allowed even after the night closed (it is harmless and frees the invitee).
--  Guests have no table yet: night_votes returns an empty name for them until the public link.

-- ---------------------------------------------------------------------------
-- Fix: the open-night cap (GN004) also fires when starts_on changes, and only counts
-- when the row itself is open, so editing a past night is never blocked.
-- ---------------------------------------------------------------------------

create or replace function public.enforce_game_night_cap()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not public.night_is_open(new) then
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

drop trigger game_nights_cap on public.game_nights;
create trigger game_nights_cap
  before insert or update of status, starts_on on public.game_nights
  for each row execute function public.enforce_game_night_cap();

-- ---------------------------------------------------------------------------
-- Membership
-- ---------------------------------------------------------------------------

create function public.invite_to_night(p_night uuid, p_friend text)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  me text := public.current_user_id();
  v_night public.game_nights;
  v_member public.game_night_members;
begin
  select * into v_night from public.game_nights where id = p_night for update;
  if me is null or not found or v_night.owner_id <> me then
    raise exception 'not the host of this night' using errcode = '42501';
  end if;
  if not public.night_is_open(v_night) then
    raise exception 'the night is closed' using errcode = 'GN002';
  end if;
  if p_friend is null or not public.are_friends(me, p_friend) then
    raise exception 'not your friend' using errcode = 'GN001';
  end if;

  select * into v_member from public.game_night_members
   where night_id = p_night and user_id = p_friend;
  if found and v_member.status in ('invited', 'accepted') then
    raise exception 'already invited' using errcode = 'GN003';
  end if;
  if (select count(*) from public.game_night_members
       where night_id = p_night and status <> 'declined') >= 30 then
    raise exception 'too many invited friends' using errcode = 'GN004';
  end if;

  if found then
    update public.game_night_members
       set status = 'invited', invited_at = now(), responded_at = null
     where night_id = p_night and user_id = p_friend;
  else
    insert into public.game_night_members (night_id, user_id, status)
    values (p_night, p_friend, 'invited');
  end if;
end;
$$;

create function public.respond_night_invite(p_night uuid, p_accept boolean)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  me text := public.current_user_id();
  v_night public.game_nights;
begin
  perform 1 from public.game_night_members
   where night_id = p_night and user_id = me and status = 'invited' for update;
  if me is null or not found then
    raise exception 'invitation not found' using errcode = 'P0002';
  end if;
  select * into v_night from public.game_nights where id = p_night;
  if not public.night_is_open(v_night) then
    raise exception 'the night is closed' using errcode = 'GN002';
  end if;
  update public.game_night_members
     set status = case when p_accept then 'accepted' else 'declined' end,
         responded_at = now()
   where night_id = p_night and user_id = me;
end;
$$;

create function public.leave_night(p_night uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  me text := public.current_user_id();
begin
  delete from public.game_night_members where night_id = p_night and user_id = me;
  if me is null or not found then
    raise exception 'not a member' using errcode = 'P0002';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Suggestions and votes
-- ---------------------------------------------------------------------------

create function public.suggest_night_game(p_night uuid, p_game uuid)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  me text := public.current_user_id();
  v_night public.game_nights;
  v_game public.games;
  v_id uuid;
begin
  select * into v_night from public.game_nights where id = p_night for update;
  if me is null or not found or not public.is_night_member(p_night) then
    raise exception 'not a member of this night' using errcode = '42501';
  end if;
  if not public.night_is_open(v_night) then
    raise exception 'the night is closed' using errcode = 'GN002';
  end if;

  select g.* into v_game
    from public.games g
    join public.library_items li on li.game_id = g.id
   where g.id = p_game and g.owner_id is null
     and li.user_id = me and li.status = 'owned';
  if not found then
    raise exception 'the game is not in your library' using errcode = 'GN006';
  end if;
  if exists (select 1 from public.game_night_games where night_id = p_night and game_id = p_game) then
    raise exception 'the game is already in the night' using errcode = 'GN003';
  end if;
  if (select count(*) from public.game_night_games
       where night_id = p_night and source = 'suggested' and added_by = me) >= 3 then
    raise exception 'too many suggestions' using errcode = 'GN004';
  end if;
  if (select count(*) from public.game_night_games where night_id = p_night) >= 12 then
    raise exception 'too many games in the night' using errcode = 'GN004';
  end if;

  insert into public.game_night_games (night_id, game_id, added_by, source, name_snapshot, cover_snapshot)
  values (p_night, p_game, me, 'suggested', v_game.name,
          case when v_game.cover_url ~ '^https://' then v_game.cover_url end)
  returning id into v_id;
  return v_id;
end;
$$;

create function public.toggle_night_vote(p_night_game uuid)
returns boolean
language plpgsql security definer
set search_path = ''
as $$
declare
  me text := public.current_user_id();
  v_night_id uuid;
  v_night public.game_nights;
begin
  select night_id into v_night_id from public.game_night_games where id = p_night_game;
  if me is null or v_night_id is null or not public.is_night_member(v_night_id) then
    raise exception 'not a member of this night' using errcode = '42501';
  end if;
  select * into v_night from public.game_nights where id = v_night_id for share;
  if not public.night_is_open(v_night) then
    raise exception 'the night is closed' using errcode = 'GN002';
  end if;

  delete from public.game_night_votes where night_game_id = p_night_game and user_id = me;
  if found then
    return false;
  end if;
  insert into public.game_night_votes (night_game_id, user_id) values (p_night_game, me)
  on conflict do nothing;
  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reads
-- ---------------------------------------------------------------------------

-- Pending invitations of the caller, in nights still open and from a current friend.
create function public.night_invites()
returns table (night_id uuid, title text, starts_on date, host_name text)
language sql stable security definer
set search_path = ''
as $$
  select n.id, n.title, n.starts_on, coalesce(pr.display_name, '')
    from public.game_night_members m
    join public.game_nights n on n.id = m.night_id
    left join public.profiles pr on pr.id = n.owner_id
   where m.user_id = public.current_user_id()
     and m.status = 'invited'
     and public.night_is_open(n)
     and public.are_friends(n.owner_id, m.user_id)
   order by n.starts_on, n.created_at
$$;

create function public.night_votes(p_night uuid)
returns table (night_game_id uuid, voter_name text, is_guest boolean)
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not public.is_night_member(p_night) then
    raise exception 'not a member of this night' using errcode = '42501';
  end if;
  return query
    select v.night_game_id, coalesce(pr.display_name, ''), v.guest_id is not null
      from public.game_night_votes v
      join public.game_night_games g on g.id = v.night_game_id
      left join public.profiles pr on pr.id = v.user_id
     where g.night_id = p_night
     order by v.created_at, v.id;
end;
$$;

revoke all on function
  public.invite_to_night(uuid, text),
  public.respond_night_invite(uuid, boolean),
  public.leave_night(uuid),
  public.suggest_night_game(uuid, uuid),
  public.toggle_night_vote(uuid),
  public.night_invites(),
  public.night_votes(uuid)
  from public, anon;
grant execute on function
  public.invite_to_night(uuid, text),
  public.respond_night_invite(uuid, boolean),
  public.leave_night(uuid),
  public.suggest_night_game(uuid, uuid),
  public.toggle_night_vote(uuid),
  public.night_invites(),
  public.night_votes(uuid)
  to authenticated;
