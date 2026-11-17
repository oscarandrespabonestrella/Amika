-- 0024b plays.status is written by close_play / save_play (SECURITY INVOKER), so the caller needs
-- the column grant; RLS still limits the update to the owner.
grant update (status) on public.plays to authenticated;
