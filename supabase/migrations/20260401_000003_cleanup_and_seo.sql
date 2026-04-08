-- Auto-cleanup orphaned tracks after room changes
-- Tracks not linked to any room as current_track_id are junk and get deleted

create or replace function public.cleanup_orphaned_tracks()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.tracks
  where id not in (
    select current_track_id from public.rooms
    where current_track_id is not null
  );
  return null;
end;
$$;

drop trigger if exists cleanup_tracks_after_room_change on public.rooms;
create trigger cleanup_tracks_after_room_change
after update or delete on public.rooms
for each statement
execute function public.cleanup_orphaned_tracks();

-- Also clean up any existing orphaned tracks right now
delete from public.tracks
where id not in (
  select current_track_id from public.rooms
  where current_track_id is not null
);
