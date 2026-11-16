-- 0013 Review fixes for Phase 5c.
-- 1. A vote could be moved onto the voter's own sheet with UPDATE: the insert policy
--    refused the author but the update policy did not. Repeat the check there.
-- 2. "Verified" must keep meaning what an administrator reviewed: saving a new version
--    of a sheet clears the badge (the sheet then needs verifying again).

drop policy scoring_votes_update_own on public.scoring_votes;
create policy scoring_votes_update_own on public.scoring_votes
  for update to authenticated
  using (user_id = (select public.current_user_id()))
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

-- AFTER INSERT, so it only runs when the insert itself was allowed. SECURITY DEFINER
-- because users have no UPDATE privilege on the verified columns.
create function public.clear_verified_on_new_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.version > 1 then
    update public.scoring_sheets
       set verified_at = null, verified_by = null
     where id = new.sheet_id and verified_at is not null;
  end if;
  return new;
end;
$$;

create trigger scoring_sheet_versions_clear_verified
  after insert on public.scoring_sheet_versions
  for each row execute function public.clear_verified_on_new_version();
