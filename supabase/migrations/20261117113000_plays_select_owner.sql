-- 0021d INSERT ... RETURNING checks the SELECT policy on the new row BEFORE the AFTER trigger
-- that registers the owner as a member has run, so the owner is allowed directly.
drop policy plays_select_member on public.plays;
create policy plays_select_member on public.plays
  for select to authenticated
  using (owner_id = (select public.current_user_id()) or public.is_play_member(id));
