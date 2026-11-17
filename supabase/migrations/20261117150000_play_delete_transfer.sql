-- 0025 Phase 8a: deleting a match, or an account, must not destroy what other people played.
-- The match passes to the oldest accepted member; only when nobody else is left it is deleted.
-- A participant points at a player of the OWNER's roster, so on transfer the participants are
-- re-pointed to players of the NEW owner (created by name when missing).

create function public.transfer_play_ownership(p_play uuid, p_from text)
returns boolean
language plpgsql security definer
set search_path = ''
as $$
declare
  v_next text;
begin
  select user_id into v_next
    from public.play_members
   where play_id = p_play and status = 'accepted' and user_id <> p_from
   order by responded_at nulls last, invited_at
   limit 1;
  if v_next is null then
    return false;
  end if;

  -- the new owner's roster: reuse by normalized name, "me" for their own seat
  insert into public.players (owner_id, name)
  select distinct on (public.normalize_player_name(pp.display_name)) v_next, pp.display_name
    from public.play_participants pp
   where pp.play_id = p_play
     and not exists (
       select 1 from public.players pl
        where pl.owner_id = v_next
          and (public.normalize_player_name(pl.name) = public.normalize_player_name(pp.display_name)
               or (pp.user_id = v_next and pl.linked_user_id = v_next)))
  on conflict do nothing;

  update public.play_participants pp
     set player_id = coalesce(
       (select pl.id from public.players pl
         where pl.owner_id = v_next and pp.user_id = v_next and pl.linked_user_id = v_next),
       (select pl.id from public.players pl
         where pl.owner_id = v_next
           and public.normalize_player_name(pl.name) = public.normalize_player_name(pp.display_name)))
   where pp.play_id = p_play;

  update public.play_participants set user_id = null where play_id = p_play and user_id = p_from;
  delete from public.play_members where play_id = p_play and user_id = p_from;
  update public.plays set owner_id = v_next where id = p_play;
  return true;
end;
$$;

create function public.delete_play(p_play uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  me text := public.current_user_id();
begin
  if not exists (select 1 from public.plays where id = p_play and owner_id = me) then
    raise exception 'not the owner of this match' using errcode = '42501';
  end if;
  if not public.transfer_play_ownership(p_play, me) then
    delete from public.plays where id = p_play;
  end if;
end;
$$;

-- For the account deletion webhook (service role only): runs before the profile is deleted.
create function public.transfer_or_delete_plays(p_user text)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  r record;
begin
  for r in select id from public.plays where owner_id = p_user loop
    if not public.transfer_play_ownership(r.id, p_user) then
      delete from public.plays where id = r.id;
    end if;
  end loop;
end;
$$;

revoke all on function public.transfer_play_ownership(uuid, text), public.delete_play(uuid),
  public.transfer_or_delete_plays(text) from public, anon, authenticated;
grant execute on function public.delete_play(uuid) to authenticated;
grant execute on function public.transfer_or_delete_plays(text) to service_role;
