-- ---------------------------------------------------------------------------
-- search_library(): more filters (players, max duration, category, mechanic).
-- Same semantics as search_games() for players and duration. SECURITY INVOKER: RLS applies.
-- ---------------------------------------------------------------------------

drop function public.search_library(text, text, boolean, int);

create function public.search_library(
  q             text    default null,
  p_status      text    default null,
  p_favorites   boolean default null,
  p_limit       int     default 100,
  p_players     int     default null,
  p_max_minutes int     default null,
  p_category    uuid    default null,
  p_mechanic    uuid    default null
)
returns table (
  item_id        uuid,
  status         text,
  is_favorite    boolean,
  rating         smallint,
  game_id        uuid,
  name           text,
  kind           text,
  year_published smallint,
  min_players    smallint,
  max_players    smallint,
  min_playtime   smallint,
  max_playtime   smallint,
  cover_url      text,
  source         text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select li.id, li.status, li.is_favorite, li.rating,
         g.id, g.name, g.kind, g.year_published, g.min_players, g.max_players,
         g.min_playtime, g.max_playtime, g.cover_url, g.source
  from public.library_items li
  join public.games g on g.id = li.game_id
  where li.user_id = (select public.current_user_id())
    and (p_status is null or li.status = p_status)
    and (p_favorites is not true or li.is_favorite)
    and (
      coalesce(btrim(q), '') = ''
      or public.f_unaccent(g.name) ilike
         '%' || replace(replace(replace(public.f_unaccent(btrim(q)), '\', '\\'), '%', '\%'), '_', '\_') || '%'
    )
    and (p_players is null or (g.min_players <= p_players and coalesce(g.max_players, g.min_players) >= p_players))
    and (p_max_minutes is null or coalesce(g.min_playtime, g.max_playtime) <= p_max_minutes)
    and (p_category is null or exists (
      select 1 from public.game_terms gt where gt.game_id = g.id and gt.term_id = p_category))
    and (p_mechanic is null or exists (
      select 1 from public.game_terms gt where gt.game_id = g.id and gt.term_id = p_mechanic))
  order by public.f_unaccent(g.name), g.id
  limit least(greatest(p_limit, 1), 200)
$$;

revoke all on function public.search_library(text, text, boolean, int, int, int, uuid, uuid) from public, anon;
grant execute on function public.search_library(text, text, boolean, int, int, int, uuid, uuid) to authenticated;
