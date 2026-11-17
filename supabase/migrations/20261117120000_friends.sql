-- 0022 Phase 8a: friends. A friendship is made by opening a one-use invitation link; there is
-- no user search. Tables have RLS on and NO policy and no grants: everything goes through the
-- SECURITY DEFINER functions below, which check the caller themselves.
-- Errors: FR001 invalid/used/expired/revoked code, FR003 friends limit (100),
-- FR004 active links limit (10), FR005 your own link.

create table public.friend_invites (
  code       text primary key,
  created_by text not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  used_by    text references public.profiles (id) on delete set null,
  used_at    timestamptz,
  revoked_at timestamptz
);
create index friend_invites_creator_idx on public.friend_invites (created_by);

create table public.friendships (
  user_a     text not null references public.profiles (id) on delete cascade,
  user_b     text not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_a, user_b),
  check (user_a < user_b)
);
create index friendships_b_idx on public.friendships (user_b);

alter table public.friend_invites enable row level security;
alter table public.friendships enable row level security;
revoke all on public.friend_invites, public.friendships from anon, authenticated;

create function public.are_friends(p_a text, p_b text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.friendships
     where user_a = least(p_a, p_b) and user_b = greatest(p_a, p_b))
$$;

create function public.create_friend_invite()
returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  me text := public.current_user_id();
  v_code text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  if me is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if (select count(*) from public.friend_invites
       where created_by = me and used_at is null and revoked_at is null
         and expires_at > now()) >= 10 then
    raise exception 'too many active links' using errcode = 'FR004';
  end if;
  insert into public.friend_invites (code, created_by) values (v_code, me);
  return v_code;
end;
$$;

create function public.revoke_friend_invite(p_code text)
returns void
language sql security definer
set search_path = ''
as $$
  update public.friend_invites set revoked_at = now()
   where code = p_code and created_by = public.current_user_id() and revoked_at is null;
$$;

create function public.redeem_friend_invite(p_code text)
returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  me text := public.current_user_id();
  inv public.friend_invites;
begin
  if me is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select * into inv from public.friend_invites where code = p_code for update;
  if not found or inv.used_at is not null or inv.revoked_at is not null
     or inv.expires_at <= now() then
    raise exception 'invalid link' using errcode = 'FR001';
  end if;
  if inv.created_by = me then
    raise exception 'your own link' using errcode = 'FR005';
  end if;
  if public.are_friends(me, inv.created_by) then
    return inv.created_by; -- already friends: the link stays valid
  end if;
  if (select count(*) from public.friendships where me in (user_a, user_b)) >= 100
     or (select count(*) from public.friendships where inv.created_by in (user_a, user_b)) >= 100 then
    raise exception 'too many friends' using errcode = 'FR003';
  end if;
  insert into public.friendships (user_a, user_b)
  values (least(me, inv.created_by), greatest(me, inv.created_by));
  update public.friend_invites set used_by = me, used_at = now() where code = p_code;
  return inv.created_by;
end;
$$;

create function public.list_friends()
returns table (user_id text, display_name text, avatar_path text)
language sql stable security definer
set search_path = ''
as $$
  select p.id, p.display_name, p.avatar_path
    from public.friendships f
    join public.profiles p
      on p.id = case when f.user_a = public.current_user_id() then f.user_b else f.user_a end
   where public.current_user_id() in (f.user_a, f.user_b)
   order by p.display_name, p.id
$$;

create function public.remove_friend(p_friend text)
returns void
language sql security definer
set search_path = ''
as $$
  delete from public.friendships
   where user_a = least(public.current_user_id(), p_friend)
     and user_b = greatest(public.current_user_id(), p_friend);
$$;

revoke all on function public.are_friends(text, text), public.create_friend_invite(),
  public.revoke_friend_invite(text), public.redeem_friend_invite(text),
  public.list_friends(), public.remove_friend(text) from public, anon;
grant execute on function public.create_friend_invite(), public.revoke_friend_invite(text),
  public.redeem_friend_invite(text), public.list_friends(), public.remove_friend(text)
  to authenticated;
-- are_friends is an internal helper for the other definer functions: not granted.
