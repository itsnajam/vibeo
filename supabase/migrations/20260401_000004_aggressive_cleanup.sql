-- ── Aggressive data cleanup for free-tier sustainability ──

-- 1. Auto-delete anonymous profiles that haven't been in any room for 24 hours
create or replace function public.cleanup_stale_anonymous_users()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Delete profiles for anonymous users not currently in any active room
  -- and created more than 24 hours ago
  delete from public.profiles
  where id in (
    select p.id
    from public.profiles p
    inner join auth.users u on u.id = p.id
    where u.is_anonymous = true
      and p.created_at < now() - interval '24 hours'
      and p.id not in (
        select user_id from public.room_members
        where left_at is null
      )
  );
end;
$$;

-- 2. Auto-delete ended/stale rooms older than 1 hour
-- (catches rooms where host closed browser without clicking "End room")
create or replace function public.cleanup_stale_rooms()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.rooms
  where updated_at < now() - interval '1 hour'
    and status in ('waiting', 'paused', 'ended');

  -- Also delete rooms with no active members for more than 30 minutes
  delete from public.rooms
  where id not in (
    select distinct room_id from public.room_members
    where left_at is null
      and last_seen_at > now() - interval '30 minutes'
  )
  and created_at < now() - interval '30 minutes';
end;
$$;

-- 3. Schedule both cleanup functions to run every hour via pg_cron
-- (requires pg_cron extension — enable in Supabase Dashboard > Database > Extensions)
-- If pg_cron is not available, run these manually or via a cron job:
--   select public.cleanup_stale_rooms();
--   select public.cleanup_stale_anonymous_users();

-- Try to schedule if pg_cron is available
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('cleanup-stale-rooms', '0 * * * *', 'select public.cleanup_stale_rooms()');
    perform cron.schedule('cleanup-anon-users', '30 * * * *', 'select public.cleanup_stale_anonymous_users()');
  end if;
end $$;

-- 4. Run cleanup immediately to clear any existing junk
select public.cleanup_stale_rooms();
