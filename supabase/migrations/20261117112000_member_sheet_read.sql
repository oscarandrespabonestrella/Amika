-- 0021c Members read the sheet version of their matches through SECURITY DEFINER helpers:
-- a policy on scoring_sheet_versions that queried plays directly looped with the plays
-- policies, which query scoring_sheet_versions.

drop policy scoring_sheet_versions_select_member on public.scoring_sheet_versions;
drop policy scoring_sheets_select_member on public.scoring_sheets;

create function public.member_reads_version(p_version uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.plays p
     where p.scoring_version_id = p_version and public.is_play_member(p.id))
$$;

create function public.member_reads_sheet(p_sheet uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.scoring_sheet_versions v
      join public.plays p on p.scoring_version_id = v.id
     where v.sheet_id = p_sheet and public.is_play_member(p.id))
$$;

revoke all on function public.member_reads_version(uuid), public.member_reads_sheet(uuid)
  from public, anon;
grant execute on function public.member_reads_version(uuid), public.member_reads_sheet(uuid)
  to authenticated;

create policy scoring_sheet_versions_select_member on public.scoring_sheet_versions
  for select to authenticated using (public.member_reads_version(id));
create policy scoring_sheets_select_member on public.scoring_sheets
  for select to authenticated using (public.member_reads_sheet(id));
