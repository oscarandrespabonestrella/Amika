-- 0017 Retire the perceptual image hashes (Phase 7a-2).
-- Picture matching now happens entirely on the user's device (a CLIP embedding plus an
-- ORB check against the cover), so the server no longer stores or searches any image
-- fingerprint. The barcode table (game_barcodes) and its cap function stay.
-- ---------------------------------------------------------------------------

drop function if exists public.match_game_images(text, int, int);
drop function if exists public.save_photo_hash(uuid, text);
drop function if exists public.upsert_cover_hash(uuid, text);

-- The trigger goes with the table; its function and the hex helper are dropped after.
drop table if exists public.game_image_hashes;
drop function if exists public.enforce_image_hash_cap();
drop function if exists public.hex_to_hash(text);
