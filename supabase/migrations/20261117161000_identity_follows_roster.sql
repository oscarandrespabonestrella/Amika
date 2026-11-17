-- 0026b The snapshot columns of a participant follow the roster edits that existed before 8a:
--  * merging players renames the moved participants to the kept player's name;
--  * marking / unmarking "me" on a player sets / clears the account of its participants.
-- (A friend link manages them itself, inside respond_player_link / unlink_player, which set
-- amika.link_ok: the trigger leaves those alone.)

create or replace function public.merge_players(p_keep uuid, p_remove uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_link text;
  v_name text;
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
  select name into v_name from public.players where id = p_keep;
  update public.play_participants
     set player_id = p_keep, display_name = v_name
   where player_id = p_remove;
  delete from public.players where id = p_remove;
  if v_link is not null then
    update public.players set linked_user_id = v_link
     where id = p_keep and linked_user_id is null;
  end if;
end;
$$;

create function public.sync_me_mark()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.linked_user_id is distinct from old.linked_user_id
     and coalesce(current_setting('amika.link_ok', true), '') <> '1' then
    update public.play_participants set user_id = new.linked_user_id where player_id = new.id;
  end if;
  return new;
end;
$$;
create trigger players_sync_me_mark after update of linked_user_id on public.players
  for each row execute function public.sync_me_mark();
