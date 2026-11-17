-- 0023 Phase 8a: inviting friends to a match, answering, leaving. Nobody writes play_members
-- directly (0020/0021): these SECURITY DEFINER functions check the caller themselves.
-- Errors: PI001 not your friend, PI002 custom game (not shareable), PI003 already invited or
-- seated, PI004 daily limit (trigger), PI005 match closed, PI006 the owner cannot leave,
-- 42501 not the owner, P0002 not found.

create function public.invite_to_play(p_play uuid, p_friend text, p_seat smallint)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  me text := public.current_user_id();
  v_play public.plays;
  v_part uuid;
  v_member public.play_members;
begin
  select * into v_play from public.plays where id = p_play;
  if me is null or not found or v_play.owner_id <> me then
    raise exception 'not the owner of this match' using errcode = '42501';
  end if;
  if exists (select 1 from public.games g where g.id = v_play.game_id and g.owner_id is not null) then
    raise exception 'custom games cannot be shared' using errcode = 'PI002';
  end if;
  if v_play.status <> 'open' then
    raise exception 'the match is closed' using errcode = 'PI005';
  end if;
  if not public.are_friends(me, p_friend) then
    raise exception 'not your friend' using errcode = 'PI001';
  end if;
  select id into v_part from public.play_participants
   where play_id = p_play and seat = p_seat;
  if v_part is null then
    raise exception 'no participant in that seat' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.play_participants
              where play_id = p_play and user_id = p_friend and id <> v_part) then
    raise exception 'already seated in this match' using errcode = 'PI003';
  end if;

  select * into v_member from public.play_members where play_id = p_play and user_id = p_friend;
  if found then
    if v_member.status in ('invited', 'accepted') then
      raise exception 'already invited' using errcode = 'PI003';
    end if;
    update public.play_members
       set status = 'invited', invited_by = me, invited_at = now(), responded_at = null,
           participant_id = v_part
     where id = v_member.id;
    update public.play_participants set user_id = p_friend where id = v_part;
    return v_member.id;
  end if;

  update public.play_participants set user_id = p_friend where id = v_part;
  insert into public.play_members (play_id, user_id, status, invited_by, participant_id)
  values (p_play, p_friend, 'invited', me, v_part)
  returning id into v_member.id;
  return v_member.id;
end;
$$;

create function public.respond_play_invite(p_member uuid, p_accept boolean)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  me text := public.current_user_id();
  v_member public.play_members;
begin
  select * into v_member from public.play_members
   where id = p_member and user_id = me and status = 'invited' for update;
  if not found then
    raise exception 'invitation not found' using errcode = 'P0002';
  end if;
  if p_accept then
    update public.play_members set status = 'accepted', responded_at = now() where id = p_member;
  else
    update public.play_members set status = 'declined', responded_at = now() where id = p_member;
    update public.play_participants set user_id = null where id = v_member.participant_id;
  end if;
end;
$$;

create function public.leave_play(p_play uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  me text := public.current_user_id();
  v_member public.play_members;
begin
  if exists (select 1 from public.plays where id = p_play and owner_id = me) then
    raise exception 'the owner cannot leave' using errcode = 'PI006';
  end if;
  select * into v_member from public.play_members
   where play_id = p_play and user_id = me and status = 'accepted' for update;
  if not found then
    raise exception 'not a member' using errcode = 'P0002';
  end if;
  update public.play_members set status = 'left', responded_at = now() where id = v_member.id;
  update public.play_participants set user_id = null where id = v_member.participant_id;
end;
$$;

-- What an invitee may see BEFORE accepting: the game, who invited, when. Never the rest.
create function public.list_my_invites()
returns table (member_id uuid, play_id uuid, game_name text, invited_by_name text, invited_at timestamptz)
language sql stable security definer
set search_path = ''
as $$
  select m.id, m.play_id, g.name, coalesce(pr.display_name, ''), m.invited_at
    from public.play_members m
    join public.plays p on p.id = m.play_id
    join public.games g on g.id = p.game_id
    left join public.profiles pr on pr.id = m.invited_by
   where m.user_id = public.current_user_id() and m.status = 'invited'
   order by m.invited_at desc
$$;

revoke all on function public.invite_to_play(uuid, text, smallint),
  public.respond_play_invite(uuid, boolean), public.leave_play(uuid),
  public.list_my_invites() from public, anon;
grant execute on function public.invite_to_play(uuid, text, smallint),
  public.respond_play_invite(uuid, boolean), public.leave_play(uuid),
  public.list_my_invites() to authenticated;
