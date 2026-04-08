import { RealtimeChannel } from "@supabase/supabase-js";
import { ChatMessage, PlaybackState, RoomMember, RoomRole, RoomSnapshot, UserProfile } from "../types";
import { supabase } from "./supabase";

type RoomRecord = {
  id: string;
  code: string;
  status: string;
  scheduled_start_at: string | null;
  host_user_id: string;
  start_seconds: number | null;
  play_started_at: string | null;
  video_id: string | null;
  video_title: string | null;
  video_artist: string | null;
  host: Array<{ full_name: string | null }> | null;
};

const ROOM_SELECT = `
  id, code, status, scheduled_start_at, host_user_id,
  start_seconds, play_started_at, video_id, video_title, video_artist,
  host:profiles!rooms_host_user_id_fkey(full_name)
`;

export async function createRoomForHost(user: UserProfile, roomCode: string) {
  // Sweep stale rooms on creation — free-tier cleanup
  await supabase.rpc("cleanup_stale_rooms").then(() => null, () => null);

  const { data: room, error } = await supabase
    .from("rooms")
    .insert({
      code: roomCode,
      host_user_id: user.id,
      title: `${user.fullName}'s room`,
      status: "waiting",
      start_seconds: 0,
    })
    .select("id")
    .single();

  if (error || !room) throw error ?? new Error("Could not create room.");

  await upsertPresence(room.id, user.id, "host");
  return room.id as string;
}

export async function joinRoomByCode(code: string, user: UserProfile): Promise<{ roomId: string; role: RoomRole }> {
  const normalizedCode = code.trim().toUpperCase();
  const snapshot = await fetchRoomSnapshotByCode(normalizedCode);
  if (!snapshot) throw new Error("That room was not found.");
  const role: RoomRole = snapshot.hostUserId === user.id ? "host" : "listener";
  await upsertPresence(snapshot.roomId, user.id, role);
  return { roomId: snapshot.roomId, role };
}

export async function fetchRoomSnapshotByCode(code: string) {
  const { data, error } = await supabase
    .from("rooms").select(ROOM_SELECT).eq("code", code).single();
  if (error) {
    if (error.code === "PGRST116") return null;
    throw error;
  }
  return buildRoomSnapshot(data as RoomRecord);
}

export async function fetchRoomSnapshotById(roomId: string) {
  const { data, error } = await supabase
    .from("rooms").select(ROOM_SELECT).eq("id", roomId).single();
  if (error) throw error;
  return buildRoomSnapshot(data as RoomRecord);
}

export async function updateRoomMedia(args: {
  roomId: string; userId: string; title: string;
  artistName: string; youtubeVideoId: string; youtubeUrl: string;
}) {
  const { error } = await supabase
    .from("rooms")
    .update({
      video_id: args.youtubeVideoId,
      video_title: args.title,
      video_artist: args.artistName,
      status: "waiting",
      scheduled_start_at: null,
      start_seconds: 0,
    })
    .eq("id", args.roomId);
  if (error) throw error;
}

export async function scheduleRoomPlayback(args: {
  roomId: string; userId: string; scheduledStartIso: string; startSeconds: number;
}) {
  const { error } = await supabase
    .from("rooms")
    .update({ status: "scheduled", scheduled_start_at: args.scheduledStartIso, start_seconds: args.startSeconds })
    .eq("id", args.roomId);
  if (error) throw error;
}

export async function setRoomPlaying(args: {
  roomId: string; userId: string; startSeconds: number;
}) {
  const { error } = await supabase
    .from("rooms")
    .update({ status: "playing", scheduled_start_at: null, start_seconds: args.startSeconds, play_started_at: new Date().toISOString() })
    .eq("id", args.roomId);
  if (error) throw error;
}

export async function setRoomPaused(args: {
  roomId: string; userId: string; startSeconds: number;
}) {
  const { error } = await supabase
    .from("rooms")
    .update({ status: "paused", scheduled_start_at: null, start_seconds: args.startSeconds })
    .eq("id", args.roomId);
  if (error) throw error;
}

export async function refreshPresence(roomId: string, user: UserProfile, role: "host" | "listener") {
  await upsertPresence(roomId, user.id, role);
}

export async function deleteRoom(roomId: string): Promise<void> {
  const { error } = await supabase.from("rooms").delete().eq("id", roomId);
  if (error) throw error;
}

// Single channel for everything — rooms + chat + members
export function subscribeToRoom(
  roomId: string,
  onRoomUpdate: () => void,
  onDeleted: () => void,
  onMessage: (msg: ChatMessage) => void,
  onMembersChange: () => void,
): RealtimeChannel {
  return supabase
    .channel(`room:${roomId}`)
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "rooms", filter: `id=eq.${roomId}` }, onRoomUpdate)
    .on("postgres_changes", { event: "DELETE", schema: "public", table: "rooms", filter: `id=eq.${roomId}` }, onDeleted)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "room_messages", filter: `room_id=eq.${roomId}` }, (payload) => {
      const row = payload.new as { id: string; user_id: string; display_name: string; body: string; created_at: string };
      onMessage({ id: row.id, userId: row.user_id, displayName: row.display_name, body: row.body, createdAt: row.created_at });
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "room_members", filter: `room_id=eq.${roomId}` }, onMembersChange)
    .subscribe();
}

export function unsubscribeFromRoom(channel: RealtimeChannel | null) {
  if (channel) void supabase.removeChannel(channel);
}

export async function fetchRoomMembers(roomId: string): Promise<RoomMember[]> {
  const { data, error } = await supabase
    .from("room_members")
    .select("user_id, role, profile:profiles!room_members_user_id_fkey(full_name)")
    .eq("room_id", roomId)
    .is("left_at", null);
  if (error) throw error;
  return (data ?? []).map((row: { user_id: string; role: string; profile: { full_name: string | null }[] | null }) => ({
    userId: row.user_id,
    displayName: row.profile?.[0]?.full_name ?? "User",
    role: row.role as RoomRole,
  }));
}

export async function promoteToHost(roomId: string, targetUserId: string): Promise<void> {
  const [{ error: e1 }, { error: e2 }] = await Promise.all([
    supabase.from("room_members").update({ role: "host" }).eq("room_id", roomId).eq("user_id", targetUserId),
    supabase.from("rooms").update({ host_user_id: targetUserId }).eq("id", roomId),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;
}

export async function fetchMessages(roomId: string): Promise<ChatMessage[]> {
  const { data, error } = await supabase
    .from("room_messages")
    .select("id, user_id, display_name, body, created_at")
    .eq("room_id", roomId)
    .order("created_at", { ascending: true })
    .limit(100); // cap at 100 — enough for a session
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id as string, userId: row.user_id as string,
    displayName: row.display_name as string, body: row.body as string,
    createdAt: row.created_at as string,
  }));
}

export async function sendMessage(roomId: string, userId: string, displayName: string, body: string): Promise<void> {
  const { error } = await supabase.from("room_messages").insert({
    room_id: roomId, user_id: userId, display_name: displayName, body: body.trim(),
  });
  if (error) throw error;
}

async function upsertPresence(roomId: string, userId: string, role: "host" | "listener") {
  const { error } = await supabase.from("room_members").upsert(
    { room_id: roomId, user_id: userId, role, left_at: null, last_seen_at: new Date().toISOString() },
    { onConflict: "room_id,user_id" },
  );
  if (error) throw error;
}

function buildRoomSnapshot(record: RoomRecord): RoomSnapshot {
  const host = record.host?.[0] ?? null;

  let startSeconds = record.start_seconds ?? 0;
  if (record.status === "playing" && record.play_started_at) {
    const elapsedSec = (Date.now() - new Date(record.play_started_at).getTime()) / 1000;
    if (elapsedSec > 0 && elapsedSec < 43200) startSeconds += elapsedSec;
  }

  return {
    roomId: record.id,
    roomCode: record.code,
    hostUserId: record.host_user_id,
    hostName: host?.full_name ?? "Host",
    listenerCount: 0,
    trackTitle: record.video_title ?? "No video selected yet",
    artistName: record.video_artist ?? "",
    youtubeVideoId: record.video_id ?? "",
    startSeconds,
    playStartedAt: record.play_started_at ?? null,
    scheduledStartIso: record.scheduled_start_at,
    playbackState: mapPlaybackState(record.status),
  };
}

function mapPlaybackState(status: string): PlaybackState {
  if (status === "scheduled") return "queued";
  if (status === "playing") return "playing";
  if (status === "paused") return "paused";
  return "idle";
}
