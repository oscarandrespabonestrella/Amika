-- 0003 Game photos: pictures a user takes of their own games (camera upload).
-- Stored in a PRIVATE bucket under <clerk_user_id>/..., visible only to their owner.
-- BGG images are never copied here (only linked) until their terms are verified.

create table public.game_photos (
  id           uuid primary key default gen_random_uuid(),
  user_id      text not null default public.current_user_id()
                 references public.profiles (id) on delete cascade,
  game_id      uuid not null references public.games (id) on delete cascade,
  storage_path text not null unique,
  created_at   timestamptz not null default now(),
  -- the object must live inside the uploader's own folder
  constraint game_photos_path_in_own_folder check (storage_path like user_id || '/%')
);
create index game_photos_user_game_idx on public.game_photos (user_id, game_id);

alter table public.game_photos enable row level security;

create policy game_photos_select_own on public.game_photos
  for select to authenticated
  using (user_id = (select public.current_user_id()));

-- Insert only for yourself and only on a game you can see (RLS on games applies in the subquery).
create policy game_photos_insert_own on public.game_photos
  for insert to authenticated
  with check (
    user_id = (select public.current_user_id())
    and exists (select 1 from public.games g where g.id = game_id)
  );

create policy game_photos_delete_own on public.game_photos
  for delete to authenticated
  using (user_id = (select public.current_user_id()));

revoke all on public.game_photos from anon;
revoke update on public.game_photos from authenticated;

-- ---------------------------------------------------------------------------
-- Storage bucket + policies (path: <user_id>/<file>)
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'game-photos', 'game-photos', false,
  5242880, -- 5 MiB (the client also resizes before uploading)
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

create policy game_photos_objects_select_own on storage.objects
  for select to authenticated
  using (bucket_id = 'game-photos'
         and (storage.foldername(name))[1] = (select public.current_user_id()));

create policy game_photos_objects_insert_own on storage.objects
  for insert to authenticated
  with check (bucket_id = 'game-photos'
              and (storage.foldername(name))[1] = (select public.current_user_id()));

create policy game_photos_objects_delete_own on storage.objects
  for delete to authenticated
  using (bucket_id = 'game-photos'
         and (storage.foldername(name))[1] = (select public.current_user_id()));
