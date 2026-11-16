-- 0011 Sharing score sheets (Phase 5c): publish, vote, rank and moderate.
--  * A sheet can be public (catalog games only, 5 publications per user per day).
--  * Users who have a match on a sheet keep reading it (and its versions) even after it
--    is unpublished or disabled: their match must keep working.
--  * Votes: one per user and version, only from a user with their own match on exactly
--    that version, never on one's own sheet. A sheet's score uses its latest version only
--    (Wilson lower bound). Verified/disabled are set only through admin functions.
--  * Account deletion keeps public sheets that other people used, with no author.
--  * Also: column-level grants (sheets, and the 5b-deferred restriction on plays) and
--    race-free caps (the triggers lock the parent row).

-- ---------------------------------------------------------------------------
-- Columns on scoring_sheets; the author may become anonymous (owner_id null)
-- ---------------------------------------------------------------------------

alter table public.scoring_sheets
  add column published_at timestamptz,
  add column verified_at  timestamptz,
  add column verified_by  text references public.profiles (id) on delete set null,
  add column disabled_at  timestamptz,
  add column disabled_by  text references public.profiles (id) on delete set null;

alter table public.scoring_sheets alter column owner_id drop not null;
alter table public.scoring_sheets drop constraint scoring_sheets_owner_id_fkey;
alter table public.scoring_sheets
  add constraint scoring_sheets_owner_id_fkey
  foreign key (owner_id) references public.profiles (id) on delete set null;

create index scoring_sheets_public_idx on public.scoring_sheets (game_id)
  where visibility = 'public';

-- Users may write only these columns; published_at, verified_* and disabled_* belong to
-- triggers and admin functions. (Matches: only the descriptive fields, 5b review.)
revoke insert, update on public.scoring_sheets from authenticated;
grant insert (id, game_id, owner_id, title, locale, visibility, copied_from)
  on public.scoring_sheets to authenticated;
grant update (title, locale, visibility) on public.scoring_sheets to authenticated;

revoke update on public.plays from authenticated;
grant update (played_on, duration_minutes, notes) on public.plays to authenticated;

-- ---------------------------------------------------------------------------
-- Triggers on scoring_sheets
-- ---------------------------------------------------------------------------

-- A sheet may only lose its owner (anonymisation), never move or change hands.
create or replace function public.forbid_scoring_sheet_reassign()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.game_id is distinct from old.game_id
     or (new.owner_id is distinct from old.owner_id and new.owner_id is not null) then
    raise exception 'a score sheet cannot change game or owner' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

-- Publishing rules. PB001: only catalog games. PB002: 5 publications per user per day.
-- Unpublishing clears the verified badge.
create function public.enforce_scoring_sheet_publication()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.visibility = 'public' and (tg_op = 'INSERT' or old.visibility is distinct from 'public') then
    if not exists (select 1 from public.games g where g.id = new.game_id and g.owner_id is null) then
      raise exception 'only catalog games can have public score sheets' using errcode = 'PB001';
    end if;
    perform 1 from public.profiles where id = new.owner_id for update; -- one user at a time
    if (select count(*) from public.scoring_sheets s
         where s.owner_id = new.owner_id
           and s.published_at > now() - interval '1 day'
           and s.id is distinct from new.id) >= 5 then
      raise exception 'daily publication limit reached' using errcode = 'PB002';
    end if;
    new.published_at := now();
  elsif tg_op = 'UPDATE' and new.visibility = 'private' and old.visibility = 'public' then
    new.verified_at := null;
    new.verified_by := null;
  end if;
  return new;
end;
$$;

create trigger scoring_sheets_publication
  before insert or update on public.scoring_sheets
  for each row execute function public.enforce_scoring_sheet_publication();

-- Race-free caps: serialise on the parent row. At most 20 sheets per user and game
-- (any visibility, otherwise public inserts would sidestep the cap).
create or replace function public.enforce_scoring_sheet_cap()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform 1 from public.profiles where id = new.owner_id for update;
  if (select count(*) from public.scoring_sheets
       where owner_id = new.owner_id and game_id = new.game_id) >= 20 then
    raise exception 'too many score sheets for this game' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create or replace function public.number_scoring_sheet_version()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  current_max integer;
  current_count integer;
begin
  perform 1 from public.scoring_sheets where id = new.sheet_id for update;
  select coalesce(max(version), 0), count(*)
    into current_max, current_count
    from public.scoring_sheet_versions
   where sheet_id = new.sheet_id;

  if current_count >= 50 then
    raise exception 'too many versions of this score sheet' using errcode = 'P0001';
  end if;

  if new.version is null then
    new.version := current_max + 1;
  elsif new.version <> current_max + 1 then
    raise exception 'this score sheet changed elsewhere' using errcode = '23505';
  end if;
  return new;
end;
$$;

create or replace function public.enforce_play_caps()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_table_name = 'plays' then
    perform 1 from public.profiles where id = new.created_by for update;
    if (select count(*) from public.plays where created_by = new.created_by) >= 5000 then
      raise exception 'too many matches' using errcode = 'P0001';
    end if;
  elsif tg_table_name = 'play_participants' then
    perform 1 from public.plays where id = new.play_id for update;
    if (select count(*) from public.play_participants where play_id = new.play_id) >= 12 then
      raise exception 'too many players in this match' using errcode = 'P0001';
    end if;
  elsif tg_table_name = 'play_expansions' then
    perform 1 from public.plays where id = new.play_id for update;
    if (select count(*) from public.play_expansions where play_id = new.play_id) >= 20 then
      raise exception 'too many expansions in this match' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Visibility helpers (SECURITY DEFINER avoids policy recursion sheets <-> versions)
-- ---------------------------------------------------------------------------

-- The caller has a match on one of this sheet's versions: they keep reading it.
create function public.i_use_sheet(p_sheet uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.plays p
      join public.scoring_sheet_versions v on v.id = p.scoring_version_id
     where v.sheet_id = p_sheet
       and p.created_by = public.current_user_id()
  )
$$;

-- A NEW match may use this version: the sheet is enabled and either the caller's own
-- or public. (Reading is wider: see i_use_sheet.)
create function public.version_is_usable(p_version uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.scoring_sheet_versions v
      join public.scoring_sheets s on s.id = v.sheet_id
     where v.id = p_version
       and s.disabled_at is null
       and (s.owner_id = public.current_user_id() or s.visibility = 'public')
  )
$$;

revoke all on function public.i_use_sheet(uuid), public.version_is_usable(uuid) from public, anon;
grant execute on function public.i_use_sheet(uuid), public.version_is_usable(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------

drop policy scoring_sheets_select on public.scoring_sheets;
create policy scoring_sheets_select on public.scoring_sheets
  for select to authenticated
  using (
    owner_id = (select public.current_user_id())
    or (visibility = 'public' and disabled_at is null)
    or public.i_use_sheet(id)
    or (select public.is_admin())
  );

drop policy scoring_sheets_insert_own on public.scoring_sheets;
create policy scoring_sheets_insert_own on public.scoring_sheets
  for insert to authenticated
  with check (
    owner_id = (select public.current_user_id())
    and exists (select 1 from public.games g where g.id = game_id)
  );

drop policy scoring_sheets_update_own on public.scoring_sheets;
create policy scoring_sheets_update_own on public.scoring_sheets
  for update to authenticated
  using (owner_id = (select public.current_user_id()))
  with check (owner_id = (select public.current_user_id()));

-- A new match needs a usable version (own or public, enabled).
drop policy plays_insert_own on public.plays;
create policy plays_insert_own on public.plays
  for insert to authenticated
  with check (
    created_by = (select public.current_user_id())
    and exists (select 1 from public.games g where g.id = game_id)
    and (scoring_version_id is null or public.version_is_usable(scoring_version_id))
  );

-- ---------------------------------------------------------------------------
-- Votes
-- ---------------------------------------------------------------------------

create table public.scoring_votes (
  id         uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.scoring_sheet_versions (id) on delete cascade,
  user_id    text not null default public.current_user_id()
               references public.profiles (id) on delete cascade,
  play_id    uuid references public.plays (id) on delete set null,
  kind       text not null check (kind in ('up', 'flag')),
  reason     text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, version_id),
  check (
    (kind = 'up' and reason is null)
    or (kind = 'flag' and char_length(reason) between 1 and 300)
  )
);

create index scoring_votes_version_idx on public.scoring_votes (version_id);

create trigger scoring_votes_set_updated_at
  before update on public.scoring_votes
  for each row execute function public.set_updated_at();

alter table public.scoring_votes enable row level security;

create policy scoring_votes_select on public.scoring_votes
  for select to authenticated
  using (user_id = (select public.current_user_id()) or (select public.is_admin()));

-- The voter, with their own match on exactly this version, on a sheet that is not theirs.
create policy scoring_votes_insert_own on public.scoring_votes
  for insert to authenticated
  with check (
    user_id = (select public.current_user_id())
    and exists (select 1 from public.plays p
                 where p.id = play_id and p.scoring_version_id = version_id)
    and exists (select 1
                  from public.scoring_sheet_versions v
                  join public.scoring_sheets s on s.id = v.sheet_id
                 where v.id = version_id
                   and s.owner_id is distinct from (select public.current_user_id()))
  );

create policy scoring_votes_update_own on public.scoring_votes
  for update to authenticated
  using (user_id = (select public.current_user_id()))
  with check (
    user_id = (select public.current_user_id())
    and exists (select 1 from public.plays p
                 where p.id = play_id and p.scoring_version_id = version_id)
  );

create policy scoring_votes_delete_own on public.scoring_votes
  for delete to authenticated
  using (user_id = (select public.current_user_id()));

revoke all on public.scoring_votes from anon;

-- ---------------------------------------------------------------------------
-- Rankings: Wilson lower bound (z = 1.96) over the votes of each sheet's LATEST version.
-- SECURITY DEFINER because votes are private; it filters visibility itself and never
-- returns the author.
-- ---------------------------------------------------------------------------

create function public.sheet_rankings(p_game_id uuid)
returns table (
  sheet_id   uuid,
  title      text,
  locale     text,
  version    integer,
  version_id uuid,
  is_mine    boolean,
  visibility text,
  verified   boolean,
  disabled   boolean,
  up_votes   integer,
  flag_votes integer,
  uses       integer,
  score      double precision
)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (select public.current_user_id() as id, public.is_admin() as admin),
  visible as (
    select s.*
      from public.scoring_sheets s, me
     where s.game_id = p_game_id
       and (
         s.owner_id = me.id
         or (s.visibility = 'public' and (s.disabled_at is null or me.admin))
       )
  ),
  latest as (
    select distinct on (v.sheet_id) v.sheet_id, v.id as version_id, v.version
      from public.scoring_sheet_versions v
      join visible on visible.id = v.sheet_id
     order by v.sheet_id, v.version desc
  ),
  stats as (
    select l.sheet_id,
           count(*) filter (where sv.kind = 'up')::int as up_votes,
           count(*) filter (where sv.kind = 'flag')::int as flag_votes
      from latest l
      left join public.scoring_votes sv on sv.version_id = l.version_id
     group by l.sheet_id
  ),
  usage as (
    select l.sheet_id, count(distinct p.created_by)::int as uses
      from latest l
      left join public.plays p on p.scoring_version_id = l.version_id
     group by l.sheet_id
  ),
  scored as (
    select visible.id as sheet_id, visible.title, visible.locale,
           latest.version, latest.version_id,
           (visible.owner_id is not distinct from me.id) as is_mine,
           visible.visibility,
           (visible.verified_at is not null) as verified,
           (visible.disabled_at is not null) as disabled,
           stats.up_votes, stats.flag_votes, usage.uses,
           (stats.up_votes + stats.flag_votes) as n,
           visible.created_at
      from visible
      join latest on latest.sheet_id = visible.id
      join stats on stats.sheet_id = visible.id
      join usage on usage.sheet_id = visible.id
      cross join me
  )
  select sc.sheet_id, sc.title, sc.locale, sc.version, sc.version_id, sc.is_mine,
         sc.visibility, sc.verified, sc.disabled, sc.up_votes, sc.flag_votes, sc.uses,
         (case when sc.n = 0 then 0
               else (
                 (sc.up_votes::float8 / sc.n) + 3.8416 / (2 * sc.n)
                 - 1.96 * sqrt(
                     ((sc.up_votes::float8 / sc.n) * (1 - sc.up_votes::float8 / sc.n)
                      + 3.8416 / (4 * sc.n)) / sc.n)
               ) / (1 + 3.8416 / sc.n)
          end)::double precision as score
    from scored sc
   order by sc.verified desc, score desc, sc.uses desc, sc.created_at asc, sc.sheet_id
$$;

revoke all on function public.sheet_rankings(uuid) from public, anon;
grant execute on function public.sheet_rankings(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Administrator functions (the check is inside; no general update policy for admins)
-- ---------------------------------------------------------------------------

create function public.admin_set_sheet_verified(p_sheet uuid, p_verified boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_verified then
    update public.scoring_sheets
       set verified_at = now(), verified_by = public.current_user_id()
     where id = p_sheet and visibility = 'public' and disabled_at is null;
  else
    update public.scoring_sheets
       set verified_at = null, verified_by = null
     where id = p_sheet;
  end if;
  if not found then
    raise exception 'sheet not found or not eligible' using errcode = 'P0002';
  end if;
end;
$$;

create function public.admin_set_sheet_disabled(p_sheet uuid, p_disabled boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_disabled then
    update public.scoring_sheets
       set disabled_at = now(), disabled_by = public.current_user_id(),
           verified_at = null, verified_by = null
     where id = p_sheet and visibility = 'public';
  else
    update public.scoring_sheets
       set disabled_at = null, disabled_by = null
     where id = p_sheet;
  end if;
  if not found then
    raise exception 'sheet not found or not eligible' using errcode = 'P0002';
  end if;
end;
$$;

-- The reasons behind the flags of any version of a sheet (admins only).
create function public.admin_sheet_flags(p_sheet uuid)
returns table (version integer, reason text, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select v.version, sv.reason, sv.created_at
      from public.scoring_votes sv
      join public.scoring_sheet_versions v on v.id = sv.version_id
     where v.sheet_id = p_sheet and sv.kind = 'flag'
     order by sv.created_at desc;
end;
$$;

revoke all on function
  public.admin_set_sheet_verified(uuid, boolean),
  public.admin_set_sheet_disabled(uuid, boolean),
  public.admin_sheet_flags(uuid)
  from public, anon;
grant execute on function
  public.admin_set_sheet_verified(uuid, boolean),
  public.admin_set_sheet_disabled(uuid, boolean),
  public.admin_sheet_flags(uuid)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Account deletion: remove the user's matches, then every sheet nobody else used.
-- Sheets other people have matches on stay, anonymous (owner_id -> null via the FK).
-- ---------------------------------------------------------------------------

create function public.cleanup_user_content()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.plays where created_by = old.id;
  delete from public.scoring_sheets s
   where s.owner_id = old.id
     and not exists (
       select 1
         from public.plays p
         join public.scoring_sheet_versions v on v.id = p.scoring_version_id
        where v.sheet_id = s.id and p.created_by <> old.id
     );
  return old;
end;
$$;

create trigger profiles_cleanup_content
  before delete on public.profiles
  for each row execute function public.cleanup_user_content();
