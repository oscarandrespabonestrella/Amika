-- 0006 Game Center: rules (links + own summary), videos, FAQ, image gallery.
-- Content for GLOBAL games is written by administrators only. Regular users may
-- SUGGEST FAQ entries, which stay private (pending) until an admin publishes them.
-- Nothing copyrighted is hosted: rules are links to official sources + a text summary.

-- ---------------------------------------------------------------------------
-- Resources: rules links, video (YouTube id only) and other links
-- ---------------------------------------------------------------------------

create table public.game_resources (
  id          uuid primary key default gen_random_uuid(),
  game_id     uuid not null references public.games (id) on delete cascade,
  kind        text not null check (kind in ('rules', 'video', 'link')),
  locale      text check (locale is null or locale ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  title       text not null check (char_length(title) between 1 and 200),
  url         text check (url is null or (url ~ '^https://' and char_length(url) <= 500)),
  youtube_id  text check (youtube_id is null or youtube_id ~ '^[A-Za-z0-9_-]{11}$'),
  is_official boolean not null default false,
  sort        smallint not null default 0,
  created_by  text references public.profiles (id) on delete set null default public.current_user_id(),
  created_at  timestamptz not null default now(),
  -- a video is only a YouTube id; everything else is only an https URL
  constraint game_resources_shape check (
    (kind = 'video' and youtube_id is not null and url is null)
    or (kind <> 'video' and url is not null and youtube_id is null)
  )
);
create index game_resources_game_idx on public.game_resources (game_id, kind, sort);

-- ---------------------------------------------------------------------------
-- Rules summary written in our own words, one row per language
-- ---------------------------------------------------------------------------

create table public.rules_content (
  game_id    uuid not null references public.games (id) on delete cascade,
  locale     text not null check (locale ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  body       text not null check (char_length(body) between 1 and 20000),
  updated_by text references public.profiles (id) on delete set null default public.current_user_id(),
  updated_at timestamptz not null default now(),
  primary key (game_id, locale)
);

create trigger rules_content_set_updated_at
  before update on public.rules_content
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Gallery: linked images with mandatory attribution (never copied)
-- ---------------------------------------------------------------------------

create table public.game_images (
  id          uuid primary key default gen_random_uuid(),
  game_id     uuid not null references public.games (id) on delete cascade,
  url         text not null check (url ~ '^https://' and char_length(url) <= 500),
  caption     text check (caption is null or char_length(caption) <= 200),
  license     text check (license is null or char_length(license) <= 100),
  attribution text not null check (char_length(attribution) between 1 and 200),
  sort        smallint not null default 0,
  created_at  timestamptz not null default now()
);
create index game_images_game_idx on public.game_images (game_id, sort);

-- ---------------------------------------------------------------------------
-- FAQ: published (visible to all), or pending suggestions (visible to author + admin)
-- ---------------------------------------------------------------------------

create table public.faq_entries (
  id          uuid primary key default gen_random_uuid(),
  game_id     uuid not null references public.games (id) on delete cascade,
  status      text not null default 'pending' check (status in ('pending', 'published', 'rejected')),
  created_by  text references public.profiles (id) on delete set null default public.current_user_id(),
  sort        smallint not null default 0,
  created_at  timestamptz not null default now(),
  reviewed_by text references public.profiles (id) on delete set null,
  reviewed_at timestamptz
);
create index faq_entries_game_idx on public.faq_entries (game_id, status, sort);
create index faq_entries_author_idx on public.faq_entries (created_by) where created_by is not null;

create table public.faq_translations (
  faq_id   uuid not null references public.faq_entries (id) on delete cascade,
  locale   text not null check (locale ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  question text not null check (char_length(question) between 1 and 300),
  answer   text not null check (char_length(answer) between 1 and 3000),
  primary key (faq_id, locale)
);

-- At most 5 open suggestions per user and game (admins are not limited).
create function public.enforce_faq_suggestion_cap()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'pending'
     and not (select public.is_admin())
     and (select count(*) from public.faq_entries
          where game_id = new.game_id and created_by = new.created_by and status = 'pending') >= 5 then
    raise exception 'too many pending suggestions for this game' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger faq_entries_suggestion_cap
  before insert on public.faq_entries
  for each row execute function public.enforce_faq_suggestion_cap();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.game_resources   enable row level security;
alter table public.rules_content    enable row level security;
alter table public.game_images      enable row level security;
alter table public.faq_entries      enable row level security;
alter table public.faq_translations enable row level security;

-- Visible to anyone who can see the game; writable by admins, and only for GLOBAL games
-- (a user's private custom game has no Game Center content).
create policy game_resources_select on public.game_resources
  for select to authenticated
  using (exists (select 1 from public.games g where g.id = game_id));
create policy game_resources_admin_write on public.game_resources
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin())
              and exists (select 1 from public.games g where g.id = game_id and g.owner_id is null));

create policy rules_content_select on public.rules_content
  for select to authenticated
  using (exists (select 1 from public.games g where g.id = game_id));
create policy rules_content_admin_write on public.rules_content
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin())
              and exists (select 1 from public.games g where g.id = game_id and g.owner_id is null));

create policy game_images_select on public.game_images
  for select to authenticated
  using (exists (select 1 from public.games g where g.id = game_id));
create policy game_images_admin_write on public.game_images
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin())
              and exists (select 1 from public.games g where g.id = game_id and g.owner_id is null));

-- FAQ entries
create policy faq_entries_select on public.faq_entries
  for select to authenticated
  using (
    (select public.is_admin())
    or created_by = (select public.current_user_id())
    or (status = 'published' and exists (select 1 from public.games g where g.id = game_id))
  );

-- Anyone can suggest (always pending, always as themselves, only on global games).
create policy faq_entries_suggest on public.faq_entries
  for insert to authenticated
  with check (
    status = 'pending'
    and created_by = (select public.current_user_id())
    and exists (select 1 from public.games g where g.id = game_id and g.owner_id is null)
  );
-- Admins can create published entries directly and review any entry.
create policy faq_entries_admin_all on public.faq_entries
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
-- Authors can fix or withdraw their own suggestion while it is still pending.
create policy faq_entries_author_update on public.faq_entries
  for update to authenticated
  using (created_by = (select public.current_user_id()) and status = 'pending')
  with check (created_by = (select public.current_user_id()) and status = 'pending');
create policy faq_entries_author_delete on public.faq_entries
  for delete to authenticated
  using (created_by = (select public.current_user_id()) and status = 'pending');

-- Translations follow their entry (RLS on faq_entries applies inside the subquery).
create policy faq_translations_select on public.faq_translations
  for select to authenticated
  using (exists (select 1 from public.faq_entries e where e.id = faq_id));
create policy faq_translations_admin_write on public.faq_translations
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
create policy faq_translations_author_write on public.faq_translations
  for all to authenticated
  using (exists (
    select 1 from public.faq_entries e
    where e.id = faq_id and e.created_by = (select public.current_user_id()) and e.status = 'pending'))
  with check (exists (
    select 1 from public.faq_entries e
    where e.id = faq_id and e.created_by = (select public.current_user_id()) and e.status = 'pending'));

revoke all on
  public.game_resources, public.rules_content, public.game_images,
  public.faq_entries, public.faq_translations
  from anon;
