create extension if not exists pgcrypto;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(coalesce(new.email, ''), '@', 1))
  )
  on conflict (id) do update
  set
    email = excluded.email,
    full_name = coalesce(excluded.full_name, public.profiles.full_name),
    updated_at = timezone('utc', now());

  return new;
end;
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text unique,
  full_name text not null,
  avatar_url text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  host_user_id uuid not null references public.profiles (id) on delete cascade,
  title text,
  status text not null default 'waiting' check (status in ('waiting', 'scheduled', 'playing', 'paused', 'ended')),
  current_track_id uuid,
  scheduled_start_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  ended_at timestamptz,
  constraint rooms_code_format check (code ~ '^[A-Z0-9]{4,10}$')
);

create table if not exists public.tracks (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.profiles (id) on delete cascade,
  storage_path text unique,
  source_type text not null default 'youtube' check (source_type in ('youtube', 'upload', 'library')),
  youtube_video_id text,
  title text not null,
  artist_name text,
  album_name text,
  duration_ms integer check (duration_ms is null or duration_ms > 0),
  mime_type text,
  file_size_bytes bigint check (file_size_bytes is null or file_size_bytes > 0),
  is_public boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint tracks_youtube_or_storage_check check (
    (source_type = 'youtube' and youtube_video_id is not null)
    or (source_type in ('upload', 'library') and storage_path is not null)
  )
);

create table if not exists public.room_members (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null check (role in ('host', 'listener')),
  joined_at timestamptz not null default timezone('utc', now()),
  left_at timestamptz,
  last_seen_at timestamptz not null default timezone('utc', now()),
  device_label text,
  constraint room_members_unique_active_member unique (room_id, user_id)
);

create table if not exists public.playback_events (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  actor_user_id uuid not null references public.profiles (id) on delete cascade,
  track_id uuid references public.tracks (id) on delete set null,
  event_type text not null check (event_type in ('track_selected', 'play_scheduled', 'play_started', 'paused', 'resumed', 'skipped', 'ended', 'drift_report')),
  scheduled_for timestamptz,
  playback_position_ms integer check (playback_position_ms is null or playback_position_ms >= 0),
  drift_ms integer,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists rooms_host_user_id_idx on public.rooms (host_user_id);
create index if not exists rooms_status_created_at_idx on public.rooms (status, created_at desc);
create index if not exists tracks_owner_user_id_idx on public.tracks (owner_user_id);
create index if not exists tracks_public_created_at_idx on public.tracks (is_public, created_at desc);
create index if not exists room_members_room_id_idx on public.room_members (room_id);
create index if not exists room_members_user_id_idx on public.room_members (user_id);
create index if not exists room_members_room_id_last_seen_idx on public.room_members (room_id, last_seen_at desc);
create index if not exists playback_events_room_id_created_at_idx on public.playback_events (room_id, created_at desc);
create index if not exists playback_events_actor_user_id_idx on public.playback_events (actor_user_id);
create index if not exists playback_events_track_id_idx on public.playback_events (track_id);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'rooms_current_track_id_fkey'
      and conrelid = 'public.rooms'::regclass
  ) then
    alter table public.rooms
      add constraint rooms_current_track_id_fkey
      foreign key (current_track_id) references public.tracks (id) on delete set null;
  end if;
end $$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
before update on public.profiles
for each row
execute function public.set_updated_at();

drop trigger if exists set_rooms_updated_at on public.rooms;
create trigger set_rooms_updated_at
before update on public.rooms
for each row
execute function public.set_updated_at();

drop trigger if exists set_tracks_updated_at on public.tracks;
create trigger set_tracks_updated_at
before update on public.tracks
for each row
execute function public.set_updated_at();

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row
execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.rooms enable row level security;
alter table public.tracks enable row level security;
alter table public.room_members enable row level security;
alter table public.playback_events enable row level security;

create or replace function public.is_room_member(target_room_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.room_members rm
    where rm.room_id = target_room_id
      and rm.user_id = (select auth.uid())
  );
$$;

create or replace function public.is_room_host(target_room_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.rooms r
    where r.id = target_room_id
      and r.host_user_id = (select auth.uid())
  );
$$;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
on public.profiles
for select
to authenticated
using ((select auth.uid()) = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
on public.profiles
for update
to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

drop policy if exists "rooms_select_members" on public.rooms;
create policy "rooms_select_members"
on public.rooms
for select
to authenticated
using (
  (select auth.uid()) = host_user_id
  or (select public.is_room_member(id))
);

drop policy if exists "rooms_insert_host" on public.rooms;
create policy "rooms_insert_host"
on public.rooms
for insert
to authenticated
with check ((select auth.uid()) = host_user_id);

drop policy if exists "rooms_update_host" on public.rooms;
create policy "rooms_update_host"
on public.rooms
for update
to authenticated
using ((select auth.uid()) = host_user_id)
with check ((select auth.uid()) = host_user_id);

drop policy if exists "tracks_select_owner_or_public" on public.tracks;
create policy "tracks_select_owner_or_public"
on public.tracks
for select
to authenticated
using (
  is_public = true
  or (select auth.uid()) = owner_user_id
);

drop policy if exists "tracks_insert_owner" on public.tracks;
create policy "tracks_insert_owner"
on public.tracks
for insert
to authenticated
with check ((select auth.uid()) = owner_user_id);

drop policy if exists "tracks_update_owner" on public.tracks;
create policy "tracks_update_owner"
on public.tracks
for update
to authenticated
using ((select auth.uid()) = owner_user_id)
with check ((select auth.uid()) = owner_user_id);

drop policy if exists "room_members_select_same_room" on public.room_members;
create policy "room_members_select_same_room"
on public.room_members
for select
to authenticated
using (
  user_id = (select auth.uid())
  or (select public.is_room_member(room_id))
  or (select public.is_room_host(room_id))
);

drop policy if exists "room_members_insert_self_or_host" on public.room_members;
create policy "room_members_insert_self_or_host"
on public.room_members
for insert
to authenticated
with check (
  user_id = (select auth.uid())
  or (select public.is_room_host(room_id))
);

drop policy if exists "room_members_update_self_or_host" on public.room_members;
create policy "room_members_update_self_or_host"
on public.room_members
for update
to authenticated
using (
  user_id = (select auth.uid())
  or (select public.is_room_host(room_id))
)
with check (
  user_id = (select auth.uid())
  or (select public.is_room_host(room_id))
);

drop policy if exists "playback_events_select_room_members" on public.playback_events;
create policy "playback_events_select_room_members"
on public.playback_events
for select
to authenticated
using (
  (select public.is_room_member(room_id))
  or (select public.is_room_host(room_id))
);

drop policy if exists "playback_events_insert_room_members" on public.playback_events;
create policy "playback_events_insert_room_members"
on public.playback_events
for insert
to authenticated
with check (
  actor_user_id = (select auth.uid())
  and (
    (select public.is_room_member(room_id))
    or (select public.is_room_host(room_id))
  )
);

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'rooms'
  ) then
    alter publication supabase_realtime add table public.rooms;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'room_members'
  ) then
    alter publication supabase_realtime add table public.room_members;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'playback_events'
  ) then
    alter publication supabase_realtime add table public.playback_events;
  end if;
end $$;
