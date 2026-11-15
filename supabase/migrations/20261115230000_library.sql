-- 0005 Personal library: which games a user owns or used to own, plus their own
-- favorite flag, rating and notes. Strictly private to the owner.
-- (No wishlist yet: product decision 2026-11-15.)

create table public.library_items (
  id          uuid primary key default gen_random_uuid(),
  user_id     text not null default public.current_user_id()
                references public.profiles (id) on delete cascade,
  game_id     uuid not null references public.games (id) on delete cascade,
  status      text not null check (status in ('owned', 'previously_owned')),
  is_favorite boolean not null default false,
  rating      smallint check (rating is null or rating between 1 and 10),
  notes       text check (notes is null or char_length(notes) <= 2000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, game_id)
);

create index library_items_user_status_idx on public.library_items (user_id, status);
create index library_items_game_idx on public.library_items (game_id);

create trigger library_items_set_updated_at
  before update on public.library_items
  for each row execute function public.set_updated_at();

alter table public.library_items enable row level security;

create policy library_items_select_own on public.library_items
  for select to authenticated
  using (user_id = (select public.current_user_id()));

-- Only for yourself, and only for a game you can see (RLS on games applies in the subquery).
create policy library_items_insert_own on public.library_items
  for insert to authenticated
  with check (
    user_id = (select public.current_user_id())
    and exists (select 1 from public.games g where g.id = game_id)
  );

create policy library_items_update_own on public.library_items
  for update to authenticated
  using (user_id = (select public.current_user_id()))
  with check (user_id = (select public.current_user_id()));

create policy library_items_delete_own on public.library_items
  for delete to authenticated
  using (user_id = (select public.current_user_id()));

revoke all on public.library_items from anon;

-- ---------------------------------------------------------------------------
-- search_library(): the user's own library joined with game data, with the same
-- accent-insensitive matching as search_games(). SECURITY INVOKER: RLS applies.
-- ---------------------------------------------------------------------------

create function public.search_library(
  q           text    default null,
  p_status    text    default null,
  p_favorites boolean default null,
  p_limit     int     default 100
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
  order by public.f_unaccent(g.name), g.id
  limit least(greatest(p_limit, 1), 200)
$$;

revoke all on function public.search_library(text, text, boolean, int) from public, anon;
grant execute on function public.search_library(text, text, boolean, int) to authenticated;
