import { createClient } from "@supabase/supabase-js";

const url = "https://jhzaxdbdzavdsqzgxzgg.supabase.co";
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(url, key);

const fixes = [
  // Fix 1: Allow any authenticated user to look up a room by code so they can join
  `drop policy if exists "rooms_select_members" on public.rooms`,
  `create policy "rooms_select_by_code_or_member"
   on public.rooms for select to authenticated
   using (
     (select auth.uid()) = host_user_id
     or (select public.is_room_member(id))
     or status in ('waiting', 'scheduled', 'playing', 'paused')
   )`,

  // Fix 2: Allow room members to read the current track via RLS
  `drop policy if exists "tracks_select_owner_or_public" on public.tracks`,
  `create policy "tracks_select_owner_or_public"
   on public.tracks for select to authenticated
   using (
     is_public = true
     or (select auth.uid()) = owner_user_id
     or exists (
       select 1 from public.rooms r
       where r.current_track_id = tracks.id
         and (
           r.host_user_id = (select auth.uid())
           or (select public.is_room_member(r.id))
         )
     )
   )`,

  // Fix 3: replica identity for room delete realtime events
  `alter table public.rooms replica identity full`,
];

for (const sql of fixes) {
  const { error } = await supabase.rpc("query", { query: sql }).catch(() => ({ error: { message: "rpc not available" } }));
  if (error) {
    // Fall back to raw postgres via supabase-js doesn't support raw SQL directly
    // so we use the from().select() trick won't work — log what needs running
    console.log("⚠ Run manually:\n", sql.trim(), "\n");
  } else {
    console.log("✓ Done:", sql.slice(0, 60));
  }
}
