-- 0026 Phase 8a: statistics count the matches shared with the caller. A participant is "me"
-- when its account is the caller (play_participants.user_id) or, as before, when its roster
-- player is linked to the caller. Names come from the participant's own snapshot
-- (display_name): a guest cannot read the owner's roster. Still SECURITY INVOKER: RLS lets a
-- caller see only matches they own or accepted, so nobody aggregates someone else's matches.

create or replace function public.game_stats(p_game_id uuid)
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
  select pp.player_id,
         pp.display_name,
         count(*)::int,
         count(pp.total_score)::int,
         (count(*) filter (where pp.is_winner))::int,
         avg(pp.total_score),
         max(pp.total_score)::int
    from public.plays p
    join public.play_participants pp on pp.play_id = p.id
   where p.game_id = p_game_id
   group by pp.player_id, pp.display_name
   order by 5 desc, 4 desc, pp.display_name, pp.player_id;
$$;

create or replace function public.game_score_series(p_game_id uuid, p_limit int default 100)
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
  select n.id, n.seq, n.played_on, pp.player_id, pp.display_name, pp.total_score
    from numbered n
    join public.play_participants pp on pp.play_id = n.id
   where pp.total_score is not null
   order by n.seq, pp.seat;
$$;

-- The participants that are the caller, in every match they can see.
create function public.my_participants()
returns table (participant_id uuid, play_id uuid)
language sql
stable
security invoker
set search_path = ''
as $$
  select pp.id, pp.play_id
    from public.play_participants pp
    left join public.players pl on pl.id = pp.player_id
   where pp.user_id = (select public.current_user_id())
      or pl.linked_user_id = (select public.current_user_id())
$$;

drop function public.my_overview();
create function public.my_overview()
returns table (
  me_player_id uuid,
  plays        int,
  scored_plays int,
  wins         int,
  games_played int,
  shared_plays int
)
language sql
stable
security invoker
set search_path = ''
as $$
  select (select id from public.players
           where linked_user_id = (select public.current_user_id())
             and owner_id = (select public.current_user_id())
           limit 1),
         count(*)::int,
         count(pp.total_score)::int,
         (count(*) filter (where pp.is_winner))::int,
         count(distinct p.game_id)::int,
         (count(*) filter (where p.owner_id <> (select public.current_user_id())))::int
    from public.my_participants() me
    join public.play_participants pp on pp.id = me.participant_id
    join public.plays p on p.id = pp.play_id;
$$;

create or replace function public.my_top_games(p_limit int default 5)
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
    from public.my_participants() me
    join public.play_participants pp on pp.id = me.participant_id
    join public.plays p on p.id = pp.play_id
    join public.games g on g.id = p.game_id
   group by g.id, g.name
   order by 3 desc, 4 desc, g.name, g.id
   limit greatest(1, least(coalesce(p_limit, 5), 50));
$$;

create or replace function public.head_to_head()
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
  select b.player_id, b.display_name,
         count(*)::int,
         (count(*) filter (where a.rank < b.rank))::int,
         (count(*) filter (where a.rank > b.rank))::int,
         (count(*) filter (where a.rank = b.rank))::int
    from public.my_participants() me
    join public.play_participants a on a.id = me.participant_id
    join public.play_participants b on b.play_id = a.play_id and b.id <> a.id
   where a.rank is not null and b.rank is not null
   group by b.player_id, b.display_name
   order by 3 desc, b.display_name, b.player_id;
$$;

revoke all on function public.my_participants(), public.my_overview() from public, anon;
grant execute on function public.my_participants(), public.my_overview() to authenticated;
