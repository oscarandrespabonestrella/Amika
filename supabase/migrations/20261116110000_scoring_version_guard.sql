-- 0008 Optimistic concurrency for score sheet versions.
-- Before: the numbering trigger always overwrote `version` with max + 1, so a second
-- tab holding an old copy of a sheet silently became the newest version.
-- Now: the application sends the version it expects to create (the one it loaded + 1).
-- The trigger accepts it only when it really is the next number; otherwise the save
-- loses with 23505 (unique_violation), which the app reports as a conflict. A NULL
-- version is still numbered automatically (max + 1).

create or replace function public.number_scoring_sheet_version()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  current_max integer;
  current_count integer;
begin
  select coalesce(max(version), 0), count(*)
    into current_max, current_count
    from public.scoring_sheet_versions
   where sheet_id = new.sheet_id;

  if current_count >= 50 then
    raise exception 'too many versions of this score sheet' using errcode = 'P0001';
  end if;

  if new.version is null then
    new.version := current_max + 1;
  elsif new.version <> current_max + 1 then
    raise exception 'this score sheet changed elsewhere' using errcode = '23505';
  end if;
  return new;
end;
$$;
