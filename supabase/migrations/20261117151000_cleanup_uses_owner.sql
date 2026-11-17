-- 0025b Account deletion removes the matches the user OWNS now (owner_id), not the ones they
-- once created: a match passed to other players on delete (0025) must survive. Sheets other
-- people used stay, as before (any match of someone else, by its current owner).
create or replace function public.cleanup_user_content()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.plays where owner_id = old.id;
  delete from public.scoring_sheets s
   where s.owner_id = old.id
     and not exists (
       select 1
         from public.plays p
         join public.scoring_sheet_versions v on v.id = p.scoring_version_id
        where v.sheet_id = s.id and p.owner_id <> old.id
     );
  return old;
end;
$$;
