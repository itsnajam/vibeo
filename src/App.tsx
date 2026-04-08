import { type RealtimeChannel } from "@supabase/supabase-js";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChatPanel } from "./components/ChatPanel";
import { RoomPanel } from "./components/RoomPanel";
import { VibeioLogo } from "./components/VibeioLogo";
import { VideoSearch } from "./components/VideoSearch";
import { YouTubePlayer } from "./components/YouTubePlayer";
import {
  createRoomForHost, deleteRoom, fetchMessages, fetchRoomMembers, fetchRoomSnapshotById,
  joinRoomByCode, promoteToHost, refreshPresence, scheduleRoomPlayback,
  sendMessage, setRoomPaused, setRoomPlaying, subscribeToRoom,
  unsubscribeFromRoom, updateRoomMedia,
} from "./lib/rooms";
import { ChatMessage, PlaybackState, RoomMember, RoomRole, RoomSession, RoomSnapshot, UserProfile } from "./types";
import { clearUser, getOrCreateUser, loadStoredUser } from "./utils/auth";
import { friendlyError } from "./utils/errors";
import { buildYouTubeThumbnail, createRoomCode } from "./utils/youtube";

export default function App() {
  const roomChannelRef = useRef<RealtimeChannel | null>(null);
  const roomRoleRef = useRef<RoomRole>("host");
  const shareTimerRef = useRef<number | null>(null);
  const didCommitPlayRef = useRef<string | null>(null);
  const roomDeletedTimerRef = useRef<number | null>(null);

  const [user, setUser] = useState<UserProfile | null>(null);
  const [nameInput, setNameInput] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [roomError, setRoomError] = useState<string | null>(null);
  const [isBooting, setIsBooting] = useState(true);
  const [isRoomLoading, setIsRoomLoading] = useState(false);
  const [isPlaybackBusy, setIsPlaybackBusy] = useState(false);
  const [hostPlaybackTime, setHostPlaybackTime] = useState(0);
  const [listenerPlaybackTime, setListenerPlaybackTime] = useState(0);
  const [manualSeekToken, setManualSeekToken] = useState(0);
  const [currentRoomId, setCurrentRoomId] = useState<string | null>(null);
  const [currentRole, setCurrentRole] = useState<RoomRole>("host");
  const [shareMessage, setShareMessage] = useState<string | null>(null);
  const [routeRoomCode, setRouteRoomCode] = useState<string | null>(readRoomCodeFromPath());
  const [joinCode, setJoinCode] = useState("");
  const [isJoining, setIsJoining] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [roomMembers, setRoomMembers] = useState<RoomMember[]>([]);
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const [roomDeleted, setRoomDeleted] = useState(false);

  const [roomSession, setRoomSession] = useState<RoomSession>({
    roomId: "", roomCode: "", hostUserId: "", hostName: "Host",
    listenerCount: 0, trackTitle: "No video selected yet", artistName: "",
    youtubeVideoId: "", startSeconds: 0, playStartedAt: null, scheduledStartIso: null,
    playbackState: "idle", role: "host", driftMs: 0, shareUrl: "",
  });

  const currentDriftMs = hostPlaybackTime > 0 && listenerPlaybackTime > 0
    ? Math.round((listenerPlaybackTime - hostPlaybackTime) * 1000) : 0;

  const listenerSession = useMemo<RoomSession>(() => ({
    ...roomSession, role: "listener", driftMs: currentDriftMs,
  }), [currentDriftMs, roomSession]);

  const shouldHostPlay = useScheduledPlay(roomSession.scheduledStartIso, roomSession.playbackState);
  const shouldListenerPlay = useScheduledPlay(listenerSession.scheduledStartIso, listenerSession.playbackState);
  const hasVideo = Boolean(roomSession.youtubeVideoId);

  // ── Bootstrap ──
  useEffect(() => {
    const stored = loadStoredUser();
    if (stored) setUser(stored);
    setRouteRoomCode(readRoomCodeFromPath());
    setIsBooting(false);

    return () => {
      unsubscribeFromRoom(roomChannelRef.current);
      if (shareTimerRef.current) window.clearTimeout(shareTimerRef.current);
      if (roomDeletedTimerRef.current) window.clearTimeout(roomDeletedTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const h = () => setRouteRoomCode(readRoomCodeFromPath());
    window.addEventListener("popstate", h);
    return () => window.removeEventListener("popstate", h);
  }, []);

  useEffect(() => { roomRoleRef.current = currentRole; }, [currentRole]);

  useEffect(() => {
    if (!currentRoomId || !user) return;
    void refreshPresence(currentRoomId, user, currentRole).catch(() => null);
    const t = window.setInterval(() => void refreshPresence(currentRoomId, user, currentRole).catch(() => null), 15000);
    return () => window.clearInterval(t);
  }, [currentRole, currentRoomId, user]);

  useEffect(() => {
    if (!user || !routeRoomCode || isRoomLoading || currentRoomId) return;
    void joinRoomFromRoute(routeRoomCode.toUpperCase());
  }, [currentRoomId, isRoomLoading, routeRoomCode, user]);

  useEffect(() => {
    if (currentRole !== "host" || roomSession.playbackState !== "queued" || !shouldHostPlay) return;
    const key = roomSession.scheduledStartIso;
    if (didCommitPlayRef.current === key || !user || !currentRoomId) return;
    didCommitPlayRef.current = key;
    void setRoomPlaying({ roomId: currentRoomId, userId: user.id, startSeconds: roomSession.startSeconds }).catch(() => null);
  }, [shouldHostPlay, roomSession.playbackState, roomSession.scheduledStartIso, roomSession.startSeconds, currentRole, user, currentRoomId]);

  // ── Helpers ──
  function flashShareMessage(msg: string) {
    setShareMessage(msg);
    if (shareTimerRef.current) window.clearTimeout(shareTimerRef.current);
    shareTimerRef.current = window.setTimeout(() => setShareMessage(null), 3000);
  }

  function setSessionFromSnapshot(snapshot: RoomSnapshot, role: RoomRole) {
    setRoomSession({ ...snapshot, role, driftMs: role === "listener" ? currentDriftMs : 0, shareUrl: buildRoomShareUrl(snapshot.roomCode) });
  }

  async function syncRoomState(roomId: string, role: RoomRole) {
    const snapshot = await fetchRoomSnapshotById(roomId);
    setCurrentRoomId(snapshot.roomId);
    setCurrentRole(role);
    roomRoleRef.current = role;
    setSessionFromSnapshot(snapshot, role);
  }

  async function refreshMembers(roomId: string) {
    const members = await fetchRoomMembers(roomId).catch(() => [] as RoomMember[]);
    setRoomMembers(members);
  }

  function connectRoomSubscription(roomId: string) {
    unsubscribeFromRoom(roomChannelRef.current);
    let debounceTimer: number | null = null;
    const debouncedSync = () => {
      if (debounceTimer) window.clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(() => void syncRoomState(roomId, roomRoleRef.current).catch(() => null), 100);
    };
    roomChannelRef.current = subscribeToRoom(
      roomId,
      debouncedSync,
      () => {
        setRoomDeleted(true);
        unsubscribeFromRoom(roomChannelRef.current);
        roomChannelRef.current = null;
        roomDeletedTimerRef.current = window.setTimeout(() => {
          setRoomDeleted(false);
          setCurrentRoomId(null); setRoomError(null);
          setChatMessages([]); setRoomMembers([]);
          navigateHome(); setRouteRoomCode(null);
        }, 3000);
      },
      (msg) => setChatMessages((prev) => prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]),
      () => void refreshMembers(roomId),
    );
  }

  // ── Enter ──
  async function handleEnter() {
    const name = nameInput.trim();
    if (!name) { setNameError("Please enter your name to continue."); return; }
    if (name.length < 2) { setNameError("Name must be at least 2 characters."); return; }
    setNameError(null);
    const newUser = getOrCreateUser(name);
    setUser(newUser);
  }

  // ── Room ──
  async function createHostRoom() {
    if (!user) return;
    setIsRoomLoading(true); setRoomError(null);
    try {
      const code = createRoomCode();
      const roomId = await createRoomForHost(user, code);
      await syncRoomState(roomId, "host");
      connectRoomSubscription(roomId);
      await refreshMembers(roomId);
      navigateToRoom(code);
      setRouteRoomCode(code);
    } catch (e) { setRoomError(friendlyError(e)); }
    finally { setIsRoomLoading(false); }
  }

  async function joinRoomFromRoute(code: string) {
    if (!user) return;
    setIsRoomLoading(true); setRoomError(null);
    try {
      const { roomId, role } = await joinRoomByCode(code, user);
      const msgs = await fetchMessages(roomId).catch(() => [] as ChatMessage[]);
      setChatMessages(msgs);
      await syncRoomState(roomId, role);
      connectRoomSubscription(roomId);
      await refreshMembers(roomId);
      navigateToRoom(code);
      setRouteRoomCode(code);
    } catch (e) {
      navigateHome(); setRouteRoomCode(null);
      setRoomError(friendlyError(e));
    } finally { setIsRoomLoading(false); }
  }

  async function joinByCode() {
    const code = joinCode.trim().toUpperCase();
    if (!code || !user) return;
    setIsJoining(true); setRoomError(null);
    try {
      const { roomId, role } = await joinRoomByCode(code, user);
      const msgs = await fetchMessages(roomId).catch(() => [] as ChatMessage[]);
      setChatMessages(msgs);
      await syncRoomState(roomId, role);
      connectRoomSubscription(roomId);
      await refreshMembers(roomId);
      navigateToRoom(code);
      setRouteRoomCode(code);
      setJoinCode("");
    } catch (e) { setRoomError(friendlyError(e)); }
    finally { setIsJoining(false); }
  }

  async function exitRoom() {
    const roomId = currentRoomId;
    unsubscribeFromRoom(roomChannelRef.current);
    roomChannelRef.current = null;
    setCurrentRoomId(null); setRoomError(null);
    setChatMessages([]); setRoomMembers([]);
    navigateHome(); setRouteRoomCode(null);
    if (currentRole === "host" && roomId) await deleteRoom(roomId).catch(() => null);
  }

  async function publishVideo(videoId: string, title: string, artist = "YouTube") {
    if (!user || !currentRoomId) return;
    setIsRoomLoading(true); setRoomError(null);
    try {
      await updateRoomMedia({ roomId: currentRoomId, userId: user.id, title, artistName: artist, youtubeVideoId: videoId, youtubeUrl: `https://www.youtube.com/watch?v=${videoId}` });
      // Update local state immediately — don't wait for realtime round trip
      setRoomSession((prev) => ({
        ...prev,
        youtubeVideoId: videoId,
        trackTitle: title,
        artistName: artist,
        playbackState: "idle",
        startSeconds: 0,
        scheduledStartIso: null,
      }));
      setManualSeekToken((v) => v + 1);
    } catch (e) {
      console.error("[vibeo] publishVideo failed:", e);
      setRoomError(friendlyError(e));
    }
    finally { setIsRoomLoading(false); }
  }

  async function schedulePlaybackIn(seconds: number) {
    if (!user || !currentRoomId || isPlaybackBusy) return;
    setIsPlaybackBusy(true); setRoomError(null);
    try {
      await scheduleRoomPlayback({ roomId: currentRoomId, userId: user.id, scheduledStartIso: new Date(Date.now() + seconds * 1000).toISOString(), startSeconds: roomSession.startSeconds });
      await syncRoomState(currentRoomId, "host");
    } catch (e) { setRoomError(friendlyError(e)); }
    finally { setIsPlaybackBusy(false); }
  }

  async function pausePlayback() {
    if (!user || !currentRoomId || isPlaybackBusy) return;
    setIsPlaybackBusy(true); setRoomError(null);
    try {
      await setRoomPaused({ roomId: currentRoomId, userId: user.id, startSeconds: Math.max(0, Math.floor(hostPlaybackTime)) });
      await syncRoomState(currentRoomId, "host");
      setManualSeekToken((v) => v + 1);
    } catch (e) { setRoomError(friendlyError(e)); }
    finally { setIsPlaybackBusy(false); }
  }

  async function resumePlayback() {
    if (!user || !currentRoomId || isPlaybackBusy) return;
    setIsPlaybackBusy(true); setRoomError(null);
    try {
      await scheduleRoomPlayback({ roomId: currentRoomId, userId: user.id, scheduledStartIso: new Date(Date.now() + 5000).toISOString(), startSeconds: Math.max(0, Math.floor(hostPlaybackTime)) });
      await syncRoomState(currentRoomId, "host");
    } catch (e) { setRoomError(friendlyError(e)); }
    finally { setIsPlaybackBusy(false); }
  }

  async function playNow() {
    if (!user || !currentRoomId || isPlaybackBusy) return;
    setIsPlaybackBusy(true); setRoomError(null);
    try {
      await scheduleRoomPlayback({ roomId: currentRoomId, userId: user.id, scheduledStartIso: new Date(Date.now() + 3000).toISOString(), startSeconds: Math.max(0, Math.floor(hostPlaybackTime)) });
      await syncRoomState(currentRoomId, "host");
    } catch (e) { setRoomError(friendlyError(e)); }
    finally { setIsPlaybackBusy(false); }
  }

  async function handleSendMessage(body: string) {
    if (!user || !currentRoomId) return;
    setIsSendingMessage(true);
    try { await sendMessage(currentRoomId, user.id, user.fullName, body); }
    catch (e) { setRoomError(friendlyError(e)); }
    finally { setIsSendingMessage(false); }
  }

  async function handlePromote(targetUserId: string) {
    if (!currentRoomId) return;
    try {
      await promoteToHost(currentRoomId, targetUserId);
      await refreshMembers(currentRoomId);
      if (targetUserId !== user?.id) { setCurrentRole("listener"); roomRoleRef.current = "listener"; }
      await syncRoomState(currentRoomId, roomRoleRef.current);
    } catch (e) { setRoomError(friendlyError(e)); }
  }

  async function copyShareUrl() {
    try { await navigator.clipboard.writeText(roomSession.shareUrl); flashShareMessage("Copied to clipboard"); }
    catch { flashShareMessage("Copy failed — select the link above manually"); }
  }

  async function leaveSession() {
    unsubscribeFromRoom(roomChannelRef.current);
    roomChannelRef.current = null;
    setCurrentRoomId(null); setRoomError(null);
    setChatMessages([]); setRoomMembers([]);
    clearUser();
    setUser(null);
    navigateHome(); setRouteRoomCode(null);
  }

  // ── Render ──
  if (isBooting) return (
    <div className="app-shell"><div className="bg-glow" /><div className="boot-screen"><VibeioLogo /></div></div>
  );

  const isInRoom = Boolean(currentRoomId);
  const activeSession = currentRole === "host" ? roomSession : listenerSession;

  return (
    <div className="app-shell">
      <div className="bg-glow" />

      {roomDeleted && (
        <div className="room-deleted-overlay">
          <div className="room-deleted-card">
            <div className="room-deleted-card__icon">🚪</div>
            <h2>Room closed</h2>
            <p>The host ended the session. Redirecting you back…</p>
            <div className="spinner" style={{ margin: "0 auto" }} />
          </div>
        </div>
      )}

      <main className="layout">
        <nav className="navbar">
          <VibeioLogo />
          {user && isInRoom && (
            <button className="secondary-btn" style={{ width: "auto", padding: "0.5rem 1.25rem", fontSize: "0.85rem" }} onClick={() => void leaveSession()}>
              Leave
            </button>
          )}
        </nav>

        {/* ── Name prompt ── */}
        {!user && (
          <div className="auth-page">
            <div className="auth-hero">
              <h1>Watch YouTube<br />together, <span>in sync.</span></h1>
              <p>The free watch party that needs no account, no extension, no download. Paste a YouTube link, share the room, and everyone watches in perfect sync — instantly.</p>
              <div className="auth-features">
                <div className="auth-feature"><div className="auth-feature-dot" />No signup — just enter your name</div>
                <div className="auth-feature"><div className="auth-feature-dot" />Frame-accurate sync across all devices</div>
                <div className="auth-feature"><div className="auth-feature-dot" />Live chat built right in</div>
              </div>
            </div>
            <div className="auth-card">
              <div>
                <h2>What's your name?</h2>
                <p className="subtitle">Just enter a display name to get started — no account needed.</p>
              </div>
              <input
                value={nameInput}
                onChange={(e) => { setNameInput(e.target.value); setNameError(null); }}
                placeholder="Your name"
                autoComplete="nickname"
                autoFocus
                onKeyDown={(e) => e.key === "Enter" && void handleEnter()}
                maxLength={32}
              />
              <button className="primary-btn" onClick={() => void handleEnter()}>
                Let's go →
              </button>
              {routeRoomCode && <p className="info-pill">You were invited to room <strong>{routeRoomCode.toUpperCase()}</strong> — enter your name to join.</p>}
              {nameError && <p className="error-text">{nameError}</p>}
            </div>
          </div>
        )}

        {/* ── Lobby ── */}
        {user && !isInRoom && (
          <div className="lobby-page">
            {isRoomLoading || isJoining ? (
              <div className="lobby-loading">
                <div className="spinner" />
                <p>{routeRoomCode ? `Joining room ${routeRoomCode}…` : isJoining ? "Joining room…" : "Setting up your room…"}</p>
              </div>
            ) : (
              <>
                <div className="lobby-header">
                  <p className="eyebrow">Ready to vibe</p>
                  <h2>Hey, {user.fullName.split(" ")[0]}</h2>
                  <p>Host a room or join one with a code.</p>
                </div>
                <div className="lobby-cards">
                  <div className="lobby-card">
                    <div className="lobby-card__icon">🎬</div>
                    <h3>Create a room</h3>
                    <p>Start a session, pick a video, and invite friends with a link.</p>
                    <button className="primary-btn" onClick={() => void createHostRoom()} disabled={isRoomLoading}>Create room</button>
                  </div>
                  <div className="lobby-card">
                    <div className="lobby-card__icon">🔗</div>
                    <h3>Join a room</h3>
                    <p>Enter the room code from your invite.</p>
                    <div className="join-row">
                      <input value={joinCode} onChange={(e) => setJoinCode(e.target.value.toUpperCase().slice(0, 8))} placeholder="e.g. ABC123" className="join-input" onKeyDown={(e) => e.key === "Enter" && void joinByCode()} maxLength={8} />
                      <button className="primary-btn join-btn" onClick={() => void joinByCode()} disabled={!joinCode.trim() || isJoining}>Join</button>
                    </div>
                  </div>
                </div>
                {roomError && <div className="error-banner"><span>{roomError}</span><button onClick={() => setRoomError(null)}>✕</button></div>}
              </>
            )}
          </div>
        )}

        {/* ── Room ── */}
        {user && isInRoom && (
          <div className="room-layout">
            <div className="room-main">
              <RoomPanel session={activeSession} />

              {!hasVideo && currentRole === "host" && (
                <section className="card empty-video-state">
                  <div className="empty-video-state__icon">🎬</div>
                  <h3>Pick a video to get started</h3>
                  <p className="muted">Paste a YouTube URL in the sidebar and publish it to the room.</p>
                </section>
              )}
              {!hasVideo && currentRole === "listener" && (
                <section className="card empty-video-state">
                  <div className="empty-video-state__icon">⏳</div>
                  <h3>Waiting for the host</h3>
                  <p className="muted">The host hasn't picked a video yet. Hang tight.</p>
                </section>
              )}

              {hasVideo && (
                <section className="card">
                  <div className="media-card__header">
                    <div>
                      <p className="eyebrow">{currentRole === "host" ? "Now playing" : "Listening live"}</p>
                      <h2 style={{ marginTop: "0.4rem" }}>{activeSession.trackTitle}</h2>
                      <p className="muted" style={{ marginTop: "0.3rem" }}>{activeSession.artistName}</p>
                    </div>
                    <img alt={activeSession.trackTitle} className="video-thumb" src={buildYouTubeThumbnail(activeSession.youtubeVideoId)} />
                  </div>
                  <div style={{ position: "relative" }}>
                    <YouTubePlayer
                      key={`${currentRole}-${activeSession.youtubeVideoId}`}
                      onPlaybackSample={({ currentTime }) => {
                        if (currentRole === "host") setHostPlaybackTime(currentTime);
                        else setListenerPlaybackTime(currentTime);
                      }}
                      seekToken={manualSeekToken}
                      shouldPlay={currentRole === "host" ? shouldHostPlay : shouldListenerPlay}
                      startSeconds={activeSession.startSeconds}
                      videoId={activeSession.youtubeVideoId}
                      showControls={false}
                    />
                    {currentRole === "listener" && activeSession.playbackState !== "playing" && activeSession.playbackState !== "queued" && (
                      <div className="waiting-overlay">
                        <div className="waiting-overlay__icon">🎬</div>
                        <h3>Waiting for the host to play</h3>
                        <p>You'll be synced the moment they hit play.</p>
                      </div>
                    )}
                  </div>
                  {currentRole === "host" && hasVideo && (
                    <div className="player-controls">
                      {/* Smart play/pause toggle */}
                      {activeSession.playbackState === "playing" ? (
                        <button className="ctrl-btn ctrl-btn--pause" onClick={() => void pausePlayback()} disabled={isPlaybackBusy} title="Pause">
                          <svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
                        </button>
                      ) : (
                        <button className="ctrl-btn ctrl-btn--play" onClick={() => void playNow()} disabled={isPlaybackBusy} title="Play">
                          <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>
                        </button>
                      )}
                      <button className="ctrl-btn ctrl-btn--skip" onClick={() => void schedulePlaybackIn(5)} disabled={isPlaybackBusy} title="Schedule in 5s"><span>+5s</span></button>
                      <button className="ctrl-btn ctrl-btn--skip" onClick={() => void schedulePlaybackIn(10)} disabled={isPlaybackBusy} title="Schedule in 10s"><span>+10s</span></button>
                    </div>
                  )}
                </section>
              )}

              <ChatPanel
                messages={chatMessages}
                members={roomMembers}
                currentUserId={user.id}
                currentRole={currentRole}
                onSend={(body) => void handleSendMessage(body)}
                onPromote={(uid) => void handlePromote(uid)}
                isSending={isSendingMessage}
              />
            </div>

            <aside className="room-sidebar">
              {roomError && <div className="error-banner"><span>{roomError}</span><button onClick={() => setRoomError(null)}>✕</button></div>}

              {currentRole === "host" ? (
                <>
                  <section className="card">
                    <p className="eyebrow">Share room</p>
                    <h3 style={{ marginTop: "0.4rem", marginBottom: "0.75rem" }}>Invite listeners</h3>
                    <code className="share-code">{roomSession.shareUrl}</code>
                    <button className="primary-btn" style={{ marginTop: "0.75rem" }} onClick={() => void copyShareUrl()}>Copy invite link</button>
                    {shareMessage && <p className="info-pill">{shareMessage}</p>}
                  </section>

                  <section className="card">
                    <p className="eyebrow">Queue a video</p>
                    <VideoSearch onSelect={(videoId, title) => void publishVideo(videoId, title)} disabled={isRoomLoading} />
                    {isRoomLoading && <p className="muted" style={{ fontSize: "0.82rem", marginTop: "0.5rem" }}>Saving…</p>}
                  </section>

                  <section className="card">
                    <button className="danger-btn" onClick={() => void exitRoom()}>🗑 End &amp; delete room</button>
                  </section>
                </>
              ) : (
                <section className="card">
                  <p className="eyebrow">Listener</p>
                  <h3 style={{ marginTop: "0.4rem", marginBottom: "0.5rem" }}>You're in the room</h3>
                  <p className="muted">Playback is controlled by the host.</p>
                  <div className="stack" style={{ marginTop: "1rem" }}>
                    <a className="secondary-btn link-btn" href={roomSession.shareUrl}>Share room link</a>
                    <button className="danger-btn" onClick={() => void exitRoom()}>← Leave room</button>
                  </div>
                </section>
              )}
            </aside>
          </div>
        )}
      </main>
    </div>
  );
}

function useScheduledPlay(scheduledStartIso: string | null, playbackState: PlaybackState) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(t);
  }, []);
  if (playbackState === "playing") return true;
  if (playbackState === "paused" || playbackState === "idle") return false;
  if (!scheduledStartIso) return false;
  return now >= new Date(scheduledStartIso).getTime();
}

function buildRoomShareUrl(roomCode: string) {
  return `${window.location.origin}/room/${roomCode}`;
}

function readRoomCodeFromPath() {
  const match = window.location.pathname.match(/^\/room\/([A-Z0-9]+)/i);
  return match?.[1]?.toUpperCase() ?? null;
}

function navigateToRoom(roomCode: string) {
  const nextPath = `/room/${roomCode}`;
  if (window.location.pathname !== nextPath) window.history.replaceState({}, "", nextPath);
}

function navigateHome() {
  if (window.location.pathname !== "/") window.history.replaceState({}, "", "/");
}
