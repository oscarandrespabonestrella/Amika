-- Phase 8a: live shared matches use Supabase Realtime (postgres_changes, RLS-checked).
-- Idempotent: only adds what is missing. Full replica identity so that DELETE events carry
-- the key columns RLS needs.
do $$
declare t text;
begin
  foreach t in array array['plays','play_participants','play_scores'] loop
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
    execute format('alter table public.%I replica identity full', t);
  end loop;
end $$;
