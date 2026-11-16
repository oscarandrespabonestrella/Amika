-- 0015 Statistics (Phase 6b): read-only functions that aggregate a user's own matches by
-- player_id (never by name, so renames and merges carry through).
-- Every function is SECURITY INVOKER: RLS on plays/play_participants/players/games decides
-- what is counted, so nobody can aggregate someone else's matches. Win rate is not
-- computed here (the application divides wins by scored_plays).
-- Rules: a participant without a total is not a "scored play", never wins and never
-- enters averages; ties give every tied player the win (is_winner, set by save_play).
-- ---------------------------------------------------------------------------

-- Per-player numbers for one game.
create function public.game_stats(p_game_id uuid)
returns table (
  player_id    uuid,
  name         text,
  plays        int,
  scored_plays int,
  wins         int,
  avg_score    numeric,
  best_score   int
)
language sql
stable
security invoker
set search_path = ''
as $$
  select pl.id,
         pl.name,
         count(*)::int,
         count(pp.total_score)::int,
         (count(*) filter (where pp.is_winner))::int,
         avg(pp.total_score),
         max(pp.total_score)::int
    from public.plays p
    join public.play_participants pp on pp.play_id = p.id
    join public.players pl on pl.id = pp.player_id
   where p.game_id = p_game_id
   group by pl.id, pl.name
   order by 5 desc, 4 desc, pl.name, pl.id;
$$;

-- One row, always: matches, average of the recorded durations, first and last date.
create function public.game_summary(p_game_id uuid)
returns table (
  plays                int,
  avg_duration_minutes numeric,
  first_played_on      date,
  last_played_on       date
)
language sql
stable
security invoker
set search_path = ''
as $$
  select count(*)::int, avg(p.duration_minutes), min(p.played_on), max(p.played_on)
    from public.plays p
   where p.game_id = p_game_id;
$$;

-- Scored participants of the LATEST p_limit matches (1..200, default 100) in
-- chronological order; seq numbers those matches 1..N (an unscored match keeps its
-- number but yields no rows). Bounded on purpose: a user can have 5 000 matches.
create function public.game_score_series(p_game_id uuid, p_limit int default 100)
returns table (
  play_id   uuid,
  seq       int,
  played_on date,
  player_id uuid,
  name      text,
  total     int
)
language sql
stable
security invoker
set search_path = ''
as $$
  with recent as (
    select p.id, p.played_on, p.created_at
      from public.plays p
     where p.game_id = p_game_id
     order by p.played_on desc, p.created_at desc, p.id desc
     limit greatest(1, least(coalesce(p_limit, 100), 200))
  ),
  numbered as (
    select r.id, r.played_on,
           (row_number() over (order by r.played_on, r.created_at, r.id))::int as seq
      from recent r
  )
  select n.id, n.seq, n.played_on, pl.id, pl.name, pp.total_score
    from numbered n
    join public.play_participants pp on pp.play_id = n.id
    join public.players pl on pl.id = pp.player_id
   where pp.total_score is not null
   order by n.seq, pp.seat;
$$;

-- The record of the user's "me" player (players.linked_user_id = the caller).
-- One row, always; me_player_id is null and the counts are zero when there is no "me".
create function public.my_overview()
returns table (
  me_player_id uuid,
  plays        int,
  scored_plays int,
  wins         int,
  games_played int
)
language sql
stable
security invoker
set search_path = ''
as $$
  with me as (
    select id from public.players
     where linked_user_id = (select public.current_user_id())
     limit 1
  )
  select (select id from me),
         count(*)::int,
         count(pp.total_score)::int,
         (count(*) filter (where pp.is_winner))::int,
         count(distinct p.game_id)::int
    from me
    join public.play_participants pp on pp.player_id = me.id
    join public.plays p on p.id = pp.play_id;
$$;

-- Games "me" played most (1..50, default 5).
create function public.my_top_games(p_limit int default 5)
returns table (
  game_id uuid,
  name    text,
  plays   int,
  wins    int
)
language sql
stable
security invoker
set search_path = ''
as $$
  select g.id, g.name, count(*)::int, (count(*) filter (where pp.is_winner))::int
    from public.players me
    join public.play_participants pp on pp.player_id = me.id
    join public.plays p on p.id = pp.play_id
    join public.games g on g.id = p.game_id
   where me.linked_user_id = (select public.current_user_id())
   group by g.id, g.name
   order by 3 desc, 4 desc, g.name, g.id
   limit greatest(1, least(coalesce(p_limit, 5), 50));
$$;

-- "me" against each rival, over the matches where BOTH have a rank (a match with no
-- scores says nothing about who beat whom). Rivals who never shared such a match do not
-- appear; empty when there is no "me".
create function public.head_to_head()
returns table (
  player_id      uuid,
  name           text,
  plays_together int,
  my_wins        int,
  their_wins     int,
  ties           int
)
language sql
stable
security invoker
set search_path = ''
as $$
  select o.id, o.name,
         count(*)::int,
         (count(*) filter (where a.rank < b.rank))::int,
         (count(*) filter (where a.rank > b.rank))::int,
         (count(*) filter (where a.rank = b.rank))::int
    from public.players me
    join public.play_participants a on a.player_id = me.id
    join public.play_participants b on b.play_id = a.play_id and b.player_id <> me.id
    join public.players o on o.id = b.player_id
   where me.linked_user_id = (select public.current_user_id())
     and a.rank is not null and b.rank is not null
   group by o.id, o.name
   order by 3 desc, o.name, o.id;
$$;

revoke all on function public.game_stats(uuid) from public, anon;
revoke all on function public.game_summary(uuid) from public, anon;
revoke all on function public.game_score_series(uuid, int) from public, anon;
revoke all on function public.my_overview() from public, anon;
revoke all on function public.my_top_games(int) from public, anon;
revoke all on function public.head_to_head() from public, anon;
grant execute on function public.game_stats(uuid) to authenticated;
grant execute on function public.game_summary(uuid) to authenticated;
grant execute on function public.game_score_series(uuid, int) to authenticated;
grant execute on function public.my_overview() to authenticated;
grant execute on function public.my_top_games(int) to authenticated;
grant execute on function public.head_to_head() to authenticated;
