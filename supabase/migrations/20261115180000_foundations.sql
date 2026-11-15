-- 0001 Foundations: identity helpers, profiles, user_roles, RLS.
-- Identity comes from Clerk (third-party auth): the user id is the JWT `sub` claim (text).
-- See docs/DATABASE.md and docs/SECURITY.md.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Current user id (Clerk `sub`). NULL when anonymous.
create or replace function public.current_user_id()
returns text
language sql
stable
set search_path = ''
as $$
  select nullif(auth.jwt() ->> 'sub', '')
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- profiles (1 row per Clerk user)
-- ---------------------------------------------------------------------------

create table public.profiles (
  id           text primary key default public.current_user_id(),
  display_name text not null default '' check (char_length(display_name) <= 60),
  avatar_path  text,
  locale       text not null default 'en' check (locale ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  theme        text not null default 'system' check (theme in ('light', 'dark', 'system')),
  is_public    boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint profiles_id_not_empty check (char_length(id) > 0)
);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- user_roles (admin / moderator). Writable only with service_role.
-- ---------------------------------------------------------------------------

create table public.user_roles (
  user_id    text not null references public.profiles (id) on delete cascade,
  role       text not null check (role in ('admin', 'moderator')),
  created_at timestamptz not null default now(),
  primary key (user_id, role)
);

create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_roles
    where user_id = public.current_user_id()
      and role = 'admin'
  )
$$;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.profiles   enable row level security;
alter table public.user_roles enable row level security;

-- profiles: each user can only see and manage their own row.
create policy profiles_select_own on public.profiles
  for select to authenticated
  using (id = (select public.current_user_id()));

create policy profiles_insert_own on public.profiles
  for insert to authenticated
  with check (id = (select public.current_user_id()));

create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = (select public.current_user_id()))
  with check (id = (select public.current_user_id()));

create policy profiles_delete_own on public.profiles
  for delete to authenticated
  using (id = (select public.current_user_id()));

-- user_roles: read own roles; no write policies at all (service_role bypasses RLS).
create policy user_roles_select_own on public.user_roles
  for select to authenticated
  using (user_id = (select public.current_user_id()));

-- Defense in depth: anonymous role gets nothing; authenticated cannot write roles.
revoke all on public.profiles   from anon;
revoke all on public.user_roles from anon;
revoke insert, update, delete on public.user_roles from authenticated;
