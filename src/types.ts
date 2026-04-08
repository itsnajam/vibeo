export type UserProfile = {
  id: string;
  fullName: string;
};

export type PlaybackState = "idle" | "queued" | "playing" | "paused";

export type RoomRole = "host" | "listener";

export type RoomSnapshot = {
  roomId: string;
  roomCode: string;
  hostUserId: string;
  hostName: string;
  listenerCount: number;
  trackTitle: string;
  artistName: string;
  youtubeVideoId: string;
  startSeconds: number;
  playStartedAt: string | null;
  scheduledStartIso: string | null;
  playbackState: PlaybackState;
};

export type RoomSession = RoomSnapshot & {
  role: RoomRole;
  driftMs: number;
  shareUrl: string;
};

export type ChatMessage = {
  id: string;
  userId: string;
  displayName: string;
  body: string;
  createdAt: string;
};

export type RoomMember = {
  userId: string;
  displayName: string;
  role: RoomRole;
};
