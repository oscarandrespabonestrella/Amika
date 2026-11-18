-- Manual search: stay inside the search API's monthly quota.
--  * manual_search_cache: the verified result of a search per game, shared by every user, so the
--    same game is not searched (and paid for) twice.
--  * manual_requests gets a third kind, 'api_call', one row per call made to the search API; the
--    monthly total is the global cap.
-- Both are service-role only (no policies), like catalog_imports and manual_requests.

alter table public.manual_requests drop constraint manual_requests_kind_check;
alter table public.manual_requests
  add constraint manual_requests_kind_check check (kind in ('search', 'download', 'api_call'));

-- the monthly total counts one kind across all users
create index manual_requests_kind_time_idx on public.manual_requests (kind, created_at desc);

create table public.manual_search_cache (
  game_id    uuid primary key references public.games (id) on delete cascade,
  outcome    text not null check (outcome in ('results', 'not_found')),
  -- verified results WITHOUT anything per user (no download token, no "already added" flags)
  results    jsonb not null default '[]'::jsonb check (jsonb_typeof(results) = 'array'),
  created_at timestamptz not null default now()
);

alter table public.manual_search_cache enable row level security;
revoke all on public.manual_search_cache from anon, authenticated;
