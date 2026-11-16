-- 0016 Local game recognition (Phase 7a).
--  * game_barcodes: barcodes a user taught the app (code -> game). PRIVATE per user.
--  * game_image_hashes: 64-bit perceptual hashes of images. Only HASHES are stored,
--    never images. 'cover' rows (one per game) are written by the server when a game
--    is imported; 'user_photo' rows belong to the user who took the photo.
--  * match_game_images(): nearest hashes by Hamming distance.
-- Hashes travel as 16 lowercase hex characters (a JSON number would lose precision) and
-- are stored as bigint.
-- ---------------------------------------------------------------------------

create table public.game_barcodes (
  user_id    text not null default public.current_user_id()
               references public.profiles (id) on delete cascade,
  gtin       text not null check (gtin ~ '^[0-9]{13}$'),
  game_id    uuid not null references public.games (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, gtin)
);

create index game_barcodes_game_idx on public.game_barcodes (game_id);

-- At most 500 per user; the parent row is locked so two inserts cannot both pass.
create function public.enforce_barcode_cap()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform 1 from public.profiles where id = new.user_id for update;
  if (select count(*) from public.game_barcodes where user_id = new.user_id) >= 500 then
    raise exception 'too many barcodes' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger game_barcodes_cap before insert on public.game_barcodes
  for each row execute function public.enforce_barcode_cap();

alter table public.game_barcodes enable row level security;

create policy game_barcodes_select_own on public.game_barcodes
  for select to authenticated
  using (user_id = (select public.current_user_id()));

-- Only for a game you can see (RLS on games applies in the subquery).
create policy game_barcodes_insert_own on public.game_barcodes
  for insert to authenticated
  with check (
    user_id = (select public.current_user_id())
    and exists (select 1 from public.games g where g.id = game_id)
  );

create policy game_barcodes_update_own on public.game_barcodes
  for update to authenticated
  using (user_id = (select public.current_user_id()))
  with check (
    user_id = (select public.current_user_id())
    and exists (select 1 from public.games g where g.id = game_id)
  );

create policy game_barcodes_delete_own on public.game_barcodes
  for delete to authenticated
  using (user_id = (select public.current_user_id()));

revoke all on public.game_barcodes from anon;
revoke insert, update on public.game_barcodes from authenticated;
grant insert (gtin, game_id) on public.game_barcodes to authenticated;
grant update (game_id) on public.game_barcodes to authenticated;

-- ---------------------------------------------------------------------------

create table public.game_image_hashes (
  id         uuid primary key default gen_random_uuid(),
  game_id    uuid not null references public.games (id) on delete cascade,
  owner_id   text references public.profiles (id) on delete cascade,
  source     text not null check (source in ('cover', 'user_photo')),
  hash       bigint not null,
  created_at timestamptz not null default now(),
  -- A cover hash belongs to the catalog (no owner); a photo hash to its taker.
  check ((source = 'cover') = (owner_id is null))
);

create unique index game_image_hashes_cover_uq
  on public.game_image_hashes (game_id) where source = 'cover';
create unique index game_image_hashes_photo_uq
  on public.game_image_hashes (owner_id, game_id, hash) where source = 'user_photo';
create index game_image_hashes_game_idx on public.game_image_hashes (game_id);

-- At most 20 photo hashes per user and game, race-free.
create function public.enforce_image_hash_cap()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.source = 'user_photo' then
    perform 1 from public.profiles where id = new.owner_id for update;
    if (select count(*) from public.game_image_hashes
         where owner_id = new.owner_id and game_id = new.game_id
           and source = 'user_photo') >= 20 then
      raise exception 'too many photo hashes' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

create trigger game_image_hashes_cap before insert on public.game_image_hashes
  for each row execute function public.enforce_image_hash_cap();

alter table public.game_image_hashes enable row level security;

-- Cover hashes: for any game you can see. Photo hashes: only yours.
create policy game_image_hashes_select on public.game_image_hashes
  for select to authenticated
  using (
    (source = 'cover' and exists (select 1 from public.games g where g.id = game_id))
    or owner_id = (select public.current_user_id())
  );

create policy game_image_hashes_insert_own on public.game_image_hashes
  for insert to authenticated
  with check (
    source = 'user_photo'
    and owner_id = (select public.current_user_id())
    and exists (select 1 from public.games g where g.id = game_id)
  );

create policy game_image_hashes_delete_own on public.game_image_hashes
  for delete to authenticated
  using (source = 'user_photo' and owner_id = (select public.current_user_id()));

revoke all on public.game_image_hashes from anon;
revoke insert, update on public.game_image_hashes from authenticated;
grant insert (game_id, owner_id, source, hash) on public.game_image_hashes to authenticated;

-- ---------------------------------------------------------------------------

create function public.hex_to_hash(p_hex text)
returns bigint
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_hex is null or p_hex !~ '^[0-9a-f]{16}$' then
    raise exception 'malformed hash' using errcode = '22023';
  end if;
  return (('x' || p_hex)::bit(64))::bigint;
end;
$$;

-- Saves the hash of the user's own photo of a game (as the user: RLS decides).
create function public.save_photo_hash(p_game_id uuid, p_hash text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_hash bigint := public.hex_to_hash(p_hash);
begin
  if not exists (select 1 from public.games where id = p_game_id) then
    raise exception 'game not found' using errcode = 'P0002';
  end if;
  insert into public.game_image_hashes (game_id, owner_id, source, hash)
  values (p_game_id, (select public.current_user_id()), 'user_photo', v_hash)
  on conflict do nothing;
end;
$$;

-- Server only (service_role): the hash of a game's cover, replaced if it changes.
create function public.upsert_cover_hash(p_game_id uuid, p_hash text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash bigint := public.hex_to_hash(p_hash);
begin
  insert into public.game_image_hashes (game_id, owner_id, source, hash)
  values (p_game_id, null, 'cover', v_hash)
  on conflict (game_id) where source = 'cover'
  do update set hash = excluded.hash, created_at = now();
end;
$$;

-- Nearest hashes (Hamming distance), the minimum per game, over the rows the caller can
-- see: catalog covers of visible games plus their own photos.
create function public.match_game_images(
  p_hash         text,
  p_max_distance int default 12,
  p_limit        int default 5
)
returns table (game_id uuid, distance int)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_probe bit(64) := public.hex_to_hash(p_hash)::bit(64);
begin
  return query
    select h.game_id,
           min(bit_count(h.hash::bit(64) # v_probe))::int as distance
      from public.game_image_hashes h
     group by h.game_id
    having min(bit_count(h.hash::bit(64) # v_probe))
             <= greatest(0, least(coalesce(p_max_distance, 12), 64))
     order by 2, h.game_id
     limit greatest(1, least(coalesce(p_limit, 5), 20));
end;
$$;

revoke all on function public.hex_to_hash(text) from public, anon;
grant execute on function public.hex_to_hash(text) to authenticated, service_role;
revoke all on function public.save_photo_hash(uuid, text) from public, anon;
grant execute on function public.save_photo_hash(uuid, text) to authenticated;
revoke all on function public.upsert_cover_hash(uuid, text) from public, anon, authenticated;
grant execute on function public.upsert_cover_hash(uuid, text) to service_role;
revoke all on function public.match_game_images(text, int, int) from public, anon;
grant execute on function public.match_game_images(text, int, int) to authenticated;
