-- 0002 Catalog: on-demand global cache of games + user-owned custom games.
-- Global rows (owner_id is null) are written only by the server (service_role).
-- Custom rows (source = 'manual') belong to, and are visible only to, their owner.
-- See docs/DATABASE.md §4.

create extension if not exists pg_trgm  with schema extensions;
create extension if not exists unaccent with schema extensions;

-- Accent- and case-insensitive helper (IMMUTABLE so it can back an index).
create function public.f_unaccent(text)
returns text
language sql
immutable
parallel safe
strict
set search_path = ''
as $$
  select extensions.unaccent('extensions.unaccent'::regdictionary, $1)
$$;

-- ---------------------------------------------------------------------------
-- games
-- ---------------------------------------------------------------------------

create table public.games (
  id                uuid primary key default gen_random_uuid(),
  kind              text not null default 'base' check (kind in ('base', 'expansion')),
  name              text not null check (char_length(name) between 1 and 200),
  original_name     text check (original_name is null or char_length(original_name) <= 200),
  year_published    smallint check (year_published is null or year_published between 1000 and 2100),
  min_players       smallint check (min_players is null or min_players > 0),
  max_players       smallint check (max_players is null or max_players > 0),
  min_playtime      smallint check (min_playtime is null or min_playtime > 0),
  max_playtime      smallint check (max_playtime is null or max_playtime > 0),
  min_age           smallint check (min_age is null or min_age between 0 and 99),
  original_language text not null default 'en' check (original_language ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  cover_url         text check (cover_url is null or cover_url ~ '^https://'),
  source            text not null check (source in ('bgg', 'manual')),
  owner_id          text references public.profiles (id) on delete cascade,
  fetched_at        timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint games_players_order  check (min_players is null or max_players is null or min_players <= max_players),
  constraint games_playtime_order check (min_playtime is null or max_playtime is null or min_playtime <= max_playtime),
  -- manual games have an owner; global (imported) games never do
  constraint games_owner_matches_source check ((source = 'manual') = (owner_id is not null))
);

create index games_name_trgm_idx on public.games
  using gin (public.f_unaccent(name) extensions.gin_trgm_ops);
create index games_owner_idx on public.games (owner_id) where owner_id is not null;

create trigger games_set_updated_at
  before update on public.games
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- translations, external ids, relations
-- ---------------------------------------------------------------------------

create table public.game_translations (
  game_id     uuid not null references public.games (id) on delete cascade,
  locale      text not null check (locale ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  name        text check (name is null or char_length(name) between 1 and 200),
  description text check (description is null or char_length(description) <= 20000),
  primary key (game_id, locale)
);

create table public.game_external_ids (
  game_id     uuid not null references public.games (id) on delete cascade,
  source      text not null check (source in ('bgg')),
  external_id text not null check (char_length(external_id) between 1 and 40),
  primary key (game_id, source),
  unique (source, external_id)
);

-- Expansions etc. The related game may not be imported yet, so keep an external reference.
create table public.game_relations (
  id                  uuid primary key default gen_random_uuid(),
  game_id             uuid not null references public.games (id) on delete cascade,
  type                text not null check (type in ('expansion_of', 'has_expansion', 'reimplements', 'includes')),
  related_game_id     uuid references public.games (id) on delete set null,
  related_source      text check (related_source in ('bgg')),
  related_external_id text,
  related_name        text check (related_name is null or char_length(related_name) <= 200),
  check (related_game_id is not null or (related_source is not null and related_external_id is not null))
);
create index game_relations_game_idx on public.game_relations (game_id);

-- ---------------------------------------------------------------------------
-- terms: categories, mechanics, designers, publishers (one structure, 3 tables)
-- ---------------------------------------------------------------------------

create table public.terms (
  id          uuid primary key default gen_random_uuid(),
  type        text not null check (type in ('category', 'mechanic', 'designer', 'publisher')),
  source      text not null check (source in ('bgg')),
  external_id text not null,
  name        text not null check (char_length(name) between 1 and 200),
  unique (type, source, external_id)
);

create table public.term_translations (
  term_id uuid not null references public.terms (id) on delete cascade,
  locale  text not null check (locale ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  name    text not null check (char_length(name) between 1 and 200),
  primary key (term_id, locale)
);

create table public.game_terms (
  game_id uuid not null references public.games (id) on delete cascade,
  term_id uuid not null references public.terms (id) on delete cascade,
  primary key (game_id, term_id)
);
create index game_terms_term_idx on public.game_terms (term_id);

-- ---------------------------------------------------------------------------
-- catalog_imports: audit log used to rate-limit on-demand imports per user
-- ---------------------------------------------------------------------------

create table public.catalog_imports (
  id          bigint generated always as identity primary key,
  user_id     text not null,
  source      text not null,
  external_id text not null,
  created_at  timestamptz not null default now()
);
create index catalog_imports_user_time_idx on public.catalog_imports (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.games             enable row level security;
alter table public.game_translations enable row level security;
alter table public.game_external_ids enable row level security;
alter table public.game_relations    enable row level security;
alter table public.terms             enable row level security;
alter table public.term_translations enable row level security;
alter table public.game_terms        enable row level security;
alter table public.catalog_imports   enable row level security;

-- games: global rows are public to signed-in users; custom rows only to their owner.
create policy games_select on public.games
  for select to authenticated
  using (owner_id is null or owner_id = (select public.current_user_id()));

-- Users can only create/edit/delete their OWN manual games (never global ones).
create policy games_insert_own_manual on public.games
  for insert to authenticated
  with check (source = 'manual' and owner_id = (select public.current_user_id()));

create policy games_update_own_manual on public.games
  for update to authenticated
  using (source = 'manual' and owner_id = (select public.current_user_id()))
  with check (source = 'manual' and owner_id = (select public.current_user_id()));

create policy games_delete_own_manual on public.games
  for delete to authenticated
  using (source = 'manual' and owner_id = (select public.current_user_id()));

-- Child tables: visible whenever the parent game is visible (RLS on games applies
-- inside the subquery because it runs as the invoker).
create policy game_translations_select on public.game_translations
  for select to authenticated
  using (exists (select 1 from public.games g where g.id = game_id));

create policy game_external_ids_select on public.game_external_ids
  for select to authenticated
  using (exists (select 1 from public.games g where g.id = game_id));

create policy game_relations_select on public.game_relations
  for select to authenticated
  using (exists (select 1 from public.games g where g.id = game_id));

create policy game_terms_select on public.game_terms
  for select to authenticated
  using (exists (select 1 from public.games g where g.id = game_id));

-- Owners may write the translations (e.g. description) of their own manual games.
create policy game_translations_insert_own on public.game_translations
  for insert to authenticated
  with check (exists (
    select 1 from public.games g
    where g.id = game_id and g.source = 'manual' and g.owner_id = (select public.current_user_id())
  ));
create policy game_translations_update_own on public.game_translations
  for update to authenticated
  using (exists (
    select 1 from public.games g
    where g.id = game_id and g.source = 'manual' and g.owner_id = (select public.current_user_id())
  ))
  with check (exists (
    select 1 from public.games g
    where g.id = game_id and g.source = 'manual' and g.owner_id = (select public.current_user_id())
  ));
create policy game_translations_delete_own on public.game_translations
  for delete to authenticated
  using (exists (
    select 1 from public.games g
    where g.id = game_id and g.source = 'manual' and g.owner_id = (select public.current_user_id())
  ));

-- terms are shared vocabulary: read-only for users, written by the server.
create policy terms_select on public.terms
  for select to authenticated using (true);
create policy term_translations_select on public.term_translations
  for select to authenticated using (true);

-- catalog_imports: no policies at all => only service_role can touch it.

revoke all on public.catalog_imports from anon, authenticated;
revoke all on
  public.games, public.game_translations, public.game_external_ids, public.game_relations,
  public.terms, public.term_translations, public.game_terms
  from anon;
-- Authenticated users can never write global-only tables, even by mistake.
revoke insert, update, delete on
  public.game_external_ids, public.game_relations, public.terms,
  public.term_translations, public.game_terms
  from authenticated;

-- ---------------------------------------------------------------------------
-- search_games(): accent-insensitive search with simple filters. SECURITY INVOKER,
-- so RLS decides which rows each user can see.
-- ---------------------------------------------------------------------------

create function public.search_games(
  q             text default null,
  p_kind        text default null,
  p_players     int  default null,
  p_max_minutes int  default null,
  p_limit       int  default 20
)
returns setof public.games
language sql
stable
security invoker
set search_path = ''
as $$
  select g.*
  from public.games g
  where
    (
      coalesce(btrim(q), '') = ''
      or public.f_unaccent(g.name) ilike
         '%' || replace(replace(replace(public.f_unaccent(btrim(q)), '\', '\\'), '%', '\%'), '_', '\_') || '%'
    )
    and (p_kind is null or g.kind = p_kind)
    and (p_players is null or (g.min_players <= p_players and coalesce(g.max_players, g.min_players) >= p_players))
    and (p_max_minutes is null or coalesce(g.min_playtime, g.max_playtime) <= p_max_minutes)
  order by
    case when coalesce(btrim(q), '') = '' then 0
         else extensions.similarity(public.f_unaccent(g.name), public.f_unaccent(btrim(q))) end desc,
    g.name
  limit least(greatest(p_limit, 1), 50)
$$;

revoke all on function public.search_games(text, text, int, int, int) from public, anon;
grant execute on function public.search_games(text, text, int, int, int) to authenticated;
