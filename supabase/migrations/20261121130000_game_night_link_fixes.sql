-- 0033 Game night link fixes (review of 0032).
--  * A link is valid while its NIGHT is: validity is derived from game_nights.starts_on,
--    not from the expires_at stored at creation, so editing starts_on cannot strand guests
--    (or keep a link alive after the night moved earlier). expires_at stays as the value
--    shown to the host when the link is created.
--  * Guest names are trimmed of tabs and line breaks too, so a whitespace-only name fails
--    the length check (23514).
--  * resolve_night_link is internal: no client role, not even service_role, may call it.

create or replace function public.resolve_night_link(p_token_hash text)
returns public.game_night_links
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_link public.game_night_links;
begin
  select l.* into v_link
    from public.game_night_links l
    join public.game_nights n on n.id = l.night_id
   where l.token_hash = p_token_hash
     and l.revoked_at is null
     and now() < ((n.starts_on + 2)::timestamp at time zone 'UTC');
  if not found then
    raise exception 'invalid link' using errcode = 'GN005';
  end if;
  return v_link;
end;
$$;

revoke all on function public.resolve_night_link(text) from public, anon, authenticated, service_role;

create or replace function public.guest_join_night(p_token_hash text, p_name text, p_guest_key_hash text)
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
    update public.game_night_guests
       set display_name = btrim(p_name, E' \t\r\n') where id = v_id;
    return v_id;
  end if;

  if (select count(*) from public.game_night_guests where link_id = v_link.id) >= 30 then
    raise exception 'too many guests' using errcode = 'GN004';
  end if;
  insert into public.game_night_guests (link_id, key_hash, display_name)
  values (v_link.id, p_guest_key_hash, btrim(p_name, E' \t\r\n'))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.guest_rename(p_token_hash text, p_guest_key_hash text, p_name text)
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
     set display_name = btrim(p_name, E' \t\r\n')
   where link_id = v_link.id and key_hash = p_guest_key_hash;
  if not found then
    raise exception 'guest not found' using errcode = 'P0002';
  end if;
end;
$$;
