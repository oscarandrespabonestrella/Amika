-- Manual search: a user finds a rulebook PDF on the web and PROPOSES it for a game; an
-- administrator publishes it into the Game Center (`game_resources`, kind 'rules').
-- Nothing is hosted: only the verified link and its metadata are stored (ADR-012, ADR-046).

-- ---------------------------------------------------------------------------
-- game_resources: who published the document and when its link was last verified
-- ---------------------------------------------------------------------------

alter table public.game_resources
  add column publisher   text check (publisher is null or char_length(publisher) <= 100),
  add column verified_at timestamptz;

-- One rules link per URL and game. Fail loudly (instead of deleting rows) if dev already has
-- duplicates, so someone looks at them first.
do $$
begin
  if exists (
    select 1 from public.game_resources
    where kind = 'rules' and url is not null
    group by game_id, url having count(*) > 1
  ) then
    raise exception 'game_resources has duplicate rules links; clean them before this migration';
  end if;
end;
$$;

create unique index game_resources_rules_url_uniq
  on public.game_resources (game_id, url)
  where kind = 'rules';

-- ---------------------------------------------------------------------------
-- manual_suggestions: proposals waiting for an administrator
-- ---------------------------------------------------------------------------

create table public.manual_suggestions (
  id          uuid primary key default gen_random_uuid(),
  game_id     uuid not null references public.games (id) on delete cascade,
  url         text not null check (url ~ '^https://' and char_length(url) <= 500),
  title       text not null check (char_length(title) between 1 and 200),
  locale      text check (locale is null or locale ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  publisher   text check (publisher is null or char_length(publisher) <= 100),
  source_host text not null check (char_length(source_host) between 1 and 255),
  is_official boolean not null default false,
  size_bytes  bigint check (size_bytes is null or size_bytes >= 0),
  verified_at timestamptz not null default now(),
  status      text not null default 'pending' check (status in ('pending', 'rejected')),
  created_by  text references public.profiles (id) on delete set null default public.current_user_id(),
  created_at  timestamptz not null default now()
);
-- A rejected URL stays here on purpose: it blocks proposing the same link again.
-- Published ones are deleted (they live in game_resources).
create unique index manual_suggestions_game_url_uniq on public.manual_suggestions (game_id, url);
create index manual_suggestions_author_idx on public.manual_suggestions (created_by) where created_by is not null;
create index manual_suggestions_pending_idx on public.manual_suggestions (game_id) where status = 'pending';

-- At most 5 open proposals per user and game (admins are not limited).
create function public.enforce_manual_suggestion_cap()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'pending'
     and not (select public.is_admin())
     and (select count(*) from public.manual_suggestions
          where game_id = new.game_id and created_by = new.created_by and status = 'pending') >= 5 then
    raise exception 'too many pending manual suggestions for this game' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger manual_suggestions_cap
  before insert on public.manual_suggestions
  for each row execute function public.enforce_manual_suggestion_cap();

alter table public.manual_suggestions enable row level security;

create policy manual_suggestions_select on public.manual_suggestions
  for select to authenticated
  using ((select public.is_admin()) or created_by = (select public.current_user_id()));

-- Anyone proposes: always pending, always as themselves, only on GLOBAL games.
create policy manual_suggestions_insert on public.manual_suggestions
  for insert to authenticated
  with check (
    status = 'pending'
    and created_by = (select public.current_user_id())
    and exists (select 1 from public.games g where g.id = game_id and g.owner_id is null)
  );

-- Only administrators review (reject); the author can only withdraw a pending proposal.
create policy manual_suggestions_admin_update on public.manual_suggestions
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy manual_suggestions_delete on public.manual_suggestions
  for delete to authenticated
  using (
    (select public.is_admin())
    or (created_by = (select public.current_user_id()) and status = 'pending')
  );

revoke all on public.manual_suggestions from anon;

-- ---------------------------------------------------------------------------
-- publish_manual_suggestion: move a proposal into the Game Center atomically
-- ---------------------------------------------------------------------------

-- SECURITY INVOKER: the caller's own RLS still applies, so only an administrator gets past the
-- game_resources policies; the explicit check just gives a clean error.
create function public.publish_manual_suggestion(p_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  s public.manual_suggestions;
  new_id uuid;
begin
  if not (select public.is_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select * into s from public.manual_suggestions where id = p_id and status = 'pending' for update;
  if not found then
    return null;
  end if;

  insert into public.game_resources
    (game_id, kind, locale, title, url, is_official, publisher, verified_at)
  values
    (s.game_id, 'rules', s.locale, s.title, s.url, s.is_official, s.publisher, s.verified_at)
  on conflict (game_id, url) where kind = 'rules' do nothing
  returning id into new_id;

  delete from public.manual_suggestions where id = p_id;
  return new_id; -- null when the link was already published
end;
$$;

revoke all on function public.publish_manual_suggestion(uuid) from public, anon;
grant execute on function public.publish_manual_suggestion(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- manual_requests: usage log that rate-limits searches and downloads per user.
-- No policies at all => only the service role reads or writes it (like catalog_imports).
-- ---------------------------------------------------------------------------

create table public.manual_requests (
  id         bigint generated always as identity primary key,
  user_id    text not null,
  kind       text not null check (kind in ('search', 'download')),
  created_at timestamptz not null default now()
);
create index manual_requests_user_time_idx on public.manual_requests (user_id, kind, created_at desc);

alter table public.manual_requests enable row level security;
revoke all on public.manual_requests from anon, authenticated;
