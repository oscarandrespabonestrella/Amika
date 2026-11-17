-- 0021f Restores the 0016 rule that 0021 overwrote by mistake: a NEW match needs a usable
-- sheet version (own or public, enabled), now together with the owner check.
drop policy plays_insert_own on public.plays;
create policy plays_insert_own on public.plays
  for insert to authenticated
  with check (
    created_by = (select public.current_user_id())
    and owner_id = (select public.current_user_id())
    and exists (select 1 from public.games g where g.id = game_id)
    and (scoring_version_id is null or public.version_is_usable(scoring_version_id))
  );
