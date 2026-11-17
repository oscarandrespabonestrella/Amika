-- 0021 Phase 8a: who can read and write a shared match. Helpers are SECURITY DEFINER so
-- the policies never recurse through play_members' own RLS.

create function public.is_play_member(p_play uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.play_members m
     where m.play_id = p_play
       and m.user_id = (select public.current_user_id())
       and m.status = 'accepted')
$$;

create function public.is_play_owner(p_play uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.plays p
     where p.id = p_play and p.owner_id = (select public.current_user_id()))
$$;

-- The owner writes any score; a member only the scores of THEIR participant, while open.
create function public.can_write_scores(p_participant uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.play_participants pp
      join public.plays p on p.id = pp.play_id
     where pp.id = p_participant
       and (p.owner_id = (select public.current_user_id())
            or (p.status = 'open'
                and pp.user_id = (select public.current_user_id())
                and public.is_play_member(p.id))))
$$;

revoke all on function public.is_play_member(uuid), public.is_play_owner(uuid),
  public.can_write_scores(uuid) from public, anon;
grant execute on function public.is_play_member(uuid), public.is_play_owner(uuid),
  public.can_write_scores(uuid) to authenticated;

-- plays ----------------------------------------------------------------------
drop policy plays_select_own on public.plays;
create policy plays_select_member on public.plays
  for select to authenticated using (public.is_play_member(id));

drop policy plays_insert_own on public.plays;
create policy plays_insert_own on public.plays
  for insert to authenticated
  with check (
    created_by = (select public.current_user_id())
    and owner_id = (select public.current_user_id())
    and exists (select 1 from public.games g where g.id = game_id)
    and (scoring_version_id is null
         or exists (select 1 from public.scoring_sheet_versions v where v.id = scoring_version_id))
  );

drop policy plays_update_own on public.plays;
create policy plays_update_owner on public.plays
  for update to authenticated
  using (owner_id = (select public.current_user_id()))
  with check (
    owner_id = (select public.current_user_id())
    and (scoring_version_id is null
         or exists (select 1 from public.scoring_sheet_versions v where v.id = scoring_version_id))
  );

drop policy plays_delete_own on public.plays;
create policy plays_delete_owner on public.plays
  for delete to authenticated using (owner_id = (select public.current_user_id()));

-- participants ---------------------------------------------------------------
drop policy play_participants_all_own on public.play_participants;
create policy play_participants_select on public.play_participants
  for select to authenticated using (public.is_play_member(play_id));
create policy play_participants_write_owner on public.play_participants
  for all to authenticated
  using (public.is_play_owner(play_id))
  with check (
    public.is_play_owner(play_id)
    and exists (select 1 from public.players pl where pl.id = player_id)
  );

-- scores ---------------------------------------------------------------------
drop policy play_scores_all_own on public.play_scores;
create policy play_scores_select on public.play_scores
  for select to authenticated
  using (exists (select 1 from public.play_participants pp where pp.id = participant_id));
create policy play_scores_write on public.play_scores
  for all to authenticated
  using (public.can_write_scores(participant_id))
  with check (public.can_write_scores(participant_id));

-- expansions -----------------------------------------------------------------
drop policy play_expansions_select_own on public.play_expansions;
drop policy play_expansions_insert_own on public.play_expansions;
drop policy play_expansions_delete_own on public.play_expansions;
create policy play_expansions_select on public.play_expansions
  for select to authenticated using (public.is_play_member(play_id));
create policy play_expansions_insert_owner on public.play_expansions
  for insert to authenticated
  with check (
    public.is_play_owner(play_id)
    and exists (select 1 from public.games g where g.id = game_id and g.kind = 'expansion')
  );
create policy play_expansions_delete_owner on public.play_expansions
  for delete to authenticated using (public.is_play_owner(play_id));

-- members: you see your own rows and those of matches you belong to; nobody writes directly.
create policy play_members_select on public.play_members
  for select to authenticated
  using (user_id = (select public.current_user_id()) or public.is_play_member(play_id));
revoke insert, update, delete on public.play_members from authenticated;
revoke all on public.play_members from anon;

-- A member reads the sheet version (and its sheet) the match is scored with.
create policy scoring_sheet_versions_select_member on public.scoring_sheet_versions
  for select to authenticated
  using (exists (
    select 1 from public.plays p
     where p.scoring_version_id = scoring_sheet_versions.id and public.is_play_member(p.id)));
create policy scoring_sheets_select_member on public.scoring_sheets
  for select to authenticated
  using (exists (
    select 1 from public.scoring_sheet_versions v
      join public.plays p on p.scoring_version_id = v.id
     where v.sheet_id = scoring_sheets.id and public.is_play_member(p.id)));
