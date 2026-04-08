-- Chat messages
create table if not exists public.room_messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  display_name text not null,
  body text not null check (char_length(body) > 0 and char_length(body) <= 500),
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists room_messages_room_id_created_at_idx
  on public.room_messages (room_id, created_at asc);

alter table public.room_messages enable row level security;

drop policy if exists "messages_select_room_members" on public.room_messages;
create policy "messages_select_room_members"
on public.room_messages for select to authenticated
using (
  (select public.is_room_member(room_id))
  or (select public.is_room_host(room_id))
);

drop policy if exists "messages_insert_room_members" on public.room_messages;
create policy "messages_insert_room_members"
on public.room_messages for insert to authenticated
with check (
  user_id = (select auth.uid())
  and (
    (select public.is_room_member(room_id))
    or (select public.is_room_host(room_id))
  )
);

create index if not exists room_messages_room_id_created_at_idx
  on public.room_messages (room_id, created_at asc);

alter table public.room_messages enable row level security;

drop policy if exists "messages_select_room_members" on public.room_messages;
create policy "messages_select_room_members"
on public.room_messages for select to authenticated
using (
  (select public.is_room_member(room_id))
  or (select public.is_room_host(room_id))
);

drop policy if exists "messages_insert_room_members" on public.room_messages;
create policy "messages_insert_room_members"
on public.room_messages for insert to authenticated
with check (
  user_id = (select auth.uid())
  and (
    (select public.is_room_member(room_id))
    or (select public.is_room_host(room_id))
  )
);

-- Allow host to promote members (update role)
drop policy if exists "room_members_update_self_or_host" on public.room_members;
create policy "room_members_update_self_or_host"
on public.room_members for update to authenticated
using (
  user_id = (select auth.uid())
  or (select public.is_room_host(room_id))
)
with check (
  user_id = (select auth.uid())
  or (select public.is_room_host(room_id))
);

-- Allow host to update rooms.host_user_id when promoting
drop policy if exists "rooms_update_host" on public.rooms;
create policy "rooms_update_host"
on public.rooms for update to authenticated
using ((select auth.uid()) = host_user_id)
with check (true);

-- Realtime for messages
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'room_messages'
  ) then
    alter publication supabase_realtime add table public.room_messages;
  end if;
end $$;

-- Required for realtime filtered subscriptions on INSERT events
alter table public.room_messages replica identity full;
