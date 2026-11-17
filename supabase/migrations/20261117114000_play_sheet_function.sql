-- 0021e A member must not be able to USE the owner's private sheet for their own matches,
-- which is what reading it through a policy would allow. Instead the members of a match get
-- exactly that match's sheet through a function.
drop policy scoring_sheet_versions_select_member on public.scoring_sheet_versions;
drop policy scoring_sheets_select_member on public.scoring_sheets;
drop function public.member_reads_version(uuid);
drop function public.member_reads_sheet(uuid);

create function public.play_sheet(p_play uuid)
returns table (sheet_id uuid, version_id uuid, version int, title text, definition jsonb)
language sql stable security definer
set search_path = ''
as $$
  select s.id, v.id, v.version, s.title, v.definition
    from public.plays p
    join public.scoring_sheet_versions v on v.id = p.scoring_version_id
    join public.scoring_sheets s on s.id = v.sheet_id
   where p.id = p_play and public.is_play_member(p_play)
$$;

revoke all on function public.play_sheet(uuid) from public, anon;
grant execute on function public.play_sheet(uuid) to authenticated;
