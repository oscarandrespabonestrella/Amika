-- 0012 Fix: a flag without a reason slipped through the CHECK on scoring_votes.
-- `char_length(null) between 1 and 300` is NULL, and a CHECK accepts NULL. Make the
-- condition null-safe so a flag needs a real reason of 1 to 300 characters.

alter table public.scoring_votes drop constraint scoring_votes_check;

alter table public.scoring_votes
  add constraint scoring_votes_check check (
    (kind = 'up' and reason is null)
    or (kind = 'flag' and coalesce(char_length(reason) between 1 and 300, false))
  );
