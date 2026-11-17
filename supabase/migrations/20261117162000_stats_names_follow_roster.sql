-- 0026c Names in the statistics come from the roster player when the caller can read it (so a
-- rename or a merge always shows), and from the participant's own snapshot otherwise (a guest
-- cannot read the owner's roster). Grouping is by player only: two snapshot spellings of the
-- same player never make two rows.

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
         coalesce(max(pl.name), max(pp.display_name)),
         count(*)::int,
         count(pp.total_score)::int,
         (count(*) filter (where pp.is_winner))::int,
         avg(pp.total_score),
         max(pp.total_score)::int
    from public.plays p
    join public.play_participants pp on pp.play_id = p.id
    left join public.players pl on pl.id = pp.player_id
   where p.game_id = p_game_id
   group by pp.player_id
   order by 5 desc, 4 desc, 2, pp.player_id;
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
  select n.id, n.seq, n.played_on, pp.player_id,
         coalesce(pl.name, pp.display_name), pp.total_score
    from numbered n
    join public.play_participants pp on pp.play_id = n.id
    left join public.players pl on pl.id = pp.player_id
   where pp.total_score is not null
   order by n.seq, pp.seat;
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
  select b.player_id,
         coalesce(max(o.name), max(b.display_name)),
         count(*)::int,
         (count(*) filter (where a.rank < b.rank))::int,
         (count(*) filter (where a.rank > b.rank))::int,
         (count(*) filter (where a.rank = b.rank))::int
    from public.my_participants() me
    join public.play_participants a on a.id = me.participant_id
    join public.play_participants b on b.play_id = a.play_id and b.id <> a.id
    left join public.players o on o.id = b.player_id
   where a.rank is not null and b.rank is not null
   group by b.player_id
   order by 3 desc, 2, b.player_id;
$$;
