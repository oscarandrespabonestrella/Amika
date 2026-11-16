-- 0007 Score sheets: a sheet (identity, owner, game) plus immutable versions that hold
-- the definition JSON. In this step every sheet is PRIVATE to its author: publishing
-- (visibility = 'public'), votes and the verified badge arrive in Phase 5c, so the RLS
-- below refuses any other visibility on write.
-- Users hold a Supabase JWT and can write rows directly through the API, so the
-- definition is untrusted: size/type are checked here and the application re-validates
-- it with the engine's Zod schema whenever it reads one back.

create table public.scoring_sheets (
  id          uuid primary key default gen_random_uuid(),
  game_id     uuid not null references public.games (id) on delete cascade,
  owner_id    text not null default public.current_user_id()
                references public.profiles (id) on delete cascade,
  title       text not null check (char_length(title) between 1 and 80),
  locale      text not null check (locale ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  visibility  text not null default 'private' check (visibility in ('private', 'public')),
  copied_from uuid references public.scoring_sheets (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index scoring_sheets_game_owner_idx on public.scoring_sheets (game_id, owner_id);
create index scoring_sheets_owner_idx on public.scoring_sheets (owner_id);
create index scoring_sheets_copied_from_idx on public.scoring_sheets (copied_from)
  where copied_from is not null;

create trigger scoring_sheets_set_updated_at
  before update on public.scoring_sheets
  for each row execute function public.set_updated_at();

create table public.scoring_sheet_versions (
  id         uuid primary key default gen_random_uuid(),
  sheet_id   uuid not null references public.scoring_sheets (id) on delete cascade,
  version    integer not null check (version >= 1),
  definition jsonb not null
               check (jsonb_typeof(definition) = 'object' and octet_length(definition::text) <= 50000),
  created_at timestamptz not null default now(),
  unique (sheet_id, version)
);

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

-- At most 20 private sheets per user and game.
create function public.enforce_scoring_sheet_cap()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.visibility = 'private'
     and (select count(*) from public.scoring_sheets
          where owner_id = new.owner_id and game_id = new.game_id and visibility = 'private') >= 20 then
    raise exception 'too many private score sheets for this game' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger scoring_sheets_cap
  before insert on public.scoring_sheets
  for each row execute function public.enforce_scoring_sheet_cap();

-- A sheet never moves to another game or owner.
create function public.forbid_scoring_sheet_reassign()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.game_id is distinct from old.game_id or new.owner_id is distinct from old.owner_id then
    raise exception 'a score sheet cannot change game or owner' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger scoring_sheets_no_reassign
  before update on public.scoring_sheets
  for each row execute function public.forbid_scoring_sheet_reassign();

-- Versions are numbered by the database (max + 1); two racing saves collide on the
-- unique index and the loser gets 23505. Max 50 versions per sheet.
create function public.number_scoring_sheet_version()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  current_max integer;
  current_count integer;
begin
  select coalesce(max(version), 0), count(*)
    into current_max, current_count
    from public.scoring_sheet_versions
   where sheet_id = new.sheet_id;
  if current_count >= 50 then
    raise exception 'too many versions of this score sheet' using errcode = 'P0001';
  end if;
  new.version := current_max + 1;
  return new;
end;
$$;

create trigger scoring_sheet_versions_number
  before insert on public.scoring_sheet_versions
  for each row execute function public.number_scoring_sheet_version();

-- Versions are immutable once created (editing = a new version).
create function public.forbid_scoring_version_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'score sheet versions are immutable' using errcode = 'P0001';
end;
$$;

create trigger scoring_sheet_versions_immutable
  before update on public.scoring_sheet_versions
  for each row execute function public.forbid_scoring_version_update();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.scoring_sheets enable row level security;
alter table public.scoring_sheet_versions enable row level security;

-- Own sheets; public ones too (no public rows can exist yet: see the write policies).
create policy scoring_sheets_select on public.scoring_sheets
  for select to authenticated
  using (owner_id = (select public.current_user_id()) or visibility = 'public');

-- Only for yourself, only private, and only for a game you can see.
create policy scoring_sheets_insert_own on public.scoring_sheets
  for insert to authenticated
  with check (
    owner_id = (select public.current_user_id())
    and visibility = 'private'
    and exists (select 1 from public.games g where g.id = game_id)
  );

create policy scoring_sheets_update_own on public.scoring_sheets
  for update to authenticated
  using (owner_id = (select public.current_user_id()))
  with check (
    owner_id = (select public.current_user_id())
    and visibility = 'private'
  );

create policy scoring_sheets_delete_own on public.scoring_sheets
  for delete to authenticated
  using (owner_id = (select public.current_user_id()));

-- A version is visible whenever its sheet is (RLS on scoring_sheets applies in the subquery).
create policy scoring_sheet_versions_select on public.scoring_sheet_versions
  for select to authenticated
  using (exists (select 1 from public.scoring_sheets s where s.id = sheet_id));

create policy scoring_sheet_versions_insert_own on public.scoring_sheet_versions
  for insert to authenticated
  with check (exists (
    select 1 from public.scoring_sheets s
    where s.id = sheet_id and s.owner_id = (select public.current_user_id())));

-- No update policy: versions are immutable.
create policy scoring_sheet_versions_delete_own on public.scoring_sheet_versions
  for delete to authenticated
  using (exists (
    select 1 from public.scoring_sheets s
    where s.id = sheet_id and s.owner_id = (select public.current_user_id())));

revoke all on public.scoring_sheets, public.scoring_sheet_versions from anon;
