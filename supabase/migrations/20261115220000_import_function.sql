-- 0004 Atomic, idempotent import of an external game + photo cap.
-- upsert_external_game() is callable ONLY by service_role (the server after it
-- validated the payload). One transaction => never a half-imported game.

create function public.upsert_external_game(p jsonb)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_source  text := p ->> 'source';
  v_ext     text := p ->> 'externalId';
  v_lang    text := coalesce(p ->> 'language', 'en');
  v_game    uuid;
  v_term    uuid;
  v_item    jsonb;
begin
  if v_source is null or v_ext is null or coalesce(p ->> 'name', '') = '' then
    raise exception 'invalid external game payload' using errcode = '22023';
  end if;

  select e.game_id into v_game
  from public.game_external_ids e
  where e.source = v_source and e.external_id = v_ext;

  if v_game is null then
    insert into public.games (
      kind, name, original_name, year_published, min_players, max_players,
      min_playtime, max_playtime, min_age, original_language, cover_url, source, fetched_at
    ) values (
      coalesce(p ->> 'kind', 'base'), p ->> 'name', p ->> 'originalName',
      (p ->> 'yearPublished')::smallint, (p ->> 'minPlayers')::smallint, (p ->> 'maxPlayers')::smallint,
      (p ->> 'minPlaytime')::smallint, (p ->> 'maxPlaytime')::smallint, (p ->> 'minAge')::smallint,
      v_lang, p ->> 'coverUrl', v_source, now()
    ) returning id into v_game;

    insert into public.game_external_ids (game_id, source, external_id)
    values (v_game, v_source, v_ext);
  else
    update public.games set
      kind = coalesce(p ->> 'kind', kind),
      name = p ->> 'name',
      original_name = p ->> 'originalName',
      year_published = (p ->> 'yearPublished')::smallint,
      min_players = (p ->> 'minPlayers')::smallint,
      max_players = (p ->> 'maxPlayers')::smallint,
      min_playtime = (p ->> 'minPlaytime')::smallint,
      max_playtime = (p ->> 'maxPlaytime')::smallint,
      min_age = (p ->> 'minAge')::smallint,
      cover_url = p ->> 'coverUrl',
      fetched_at = now()
    where id = v_game;
  end if;

  insert into public.game_translations (game_id, locale, name, description)
  values (v_game, v_lang, p ->> 'name', p ->> 'description')
  on conflict (game_id, locale)
  do update set name = excluded.name, description = excluded.description;

  delete from public.game_terms where game_id = v_game;
  for v_item in select * from jsonb_array_elements(coalesce(p -> 'terms', '[]'::jsonb)) loop
    insert into public.terms (type, source, external_id, name)
    values (v_item ->> 'type', v_source, v_item ->> 'externalId', v_item ->> 'name')
    on conflict (type, source, external_id) do update set name = excluded.name
    returning id into v_term;

    insert into public.game_terms (game_id, term_id) values (v_game, v_term)
    on conflict do nothing;
  end loop;

  delete from public.game_relations where game_id = v_game;
  insert into public.game_relations (
    game_id, type, related_game_id, related_source, related_external_id, related_name
  )
  select v_game, r ->> 'type',
         (select e.game_id from public.game_external_ids e
           where e.source = v_source and e.external_id = r ->> 'externalId'),
         v_source, r ->> 'externalId', r ->> 'name'
  from jsonb_array_elements(coalesce(p -> 'relations', '[]'::jsonb)) r;

  return v_game;
end;
$$;

revoke all on function public.upsert_external_game(jsonb) from public, anon, authenticated;
grant execute on function public.upsert_external_game(jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- At most 10 photos per user and game (storage is limited on the free plan).
-- ---------------------------------------------------------------------------

create function public.enforce_game_photo_cap()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select count(*) from public.game_photos
      where user_id = new.user_id and game_id = new.game_id) >= 10 then
    raise exception 'photo limit reached for this game' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger game_photos_cap
  before insert on public.game_photos
  for each row execute function public.enforce_game_photo_cap();
