import { RoomSession } from "../types";
import { secondsUntil } from "../utils/time";

type Props = { session: RoomSession };

const STATE_LABEL: Record<string, string> = {
  idle: "Waiting",
  queued: "Starting…",
  playing: "▶ Live",
  paused: "⏸ Paused",
};

const STATE_COLOR: Record<string, string> = {
  idle: "#5a5080",
  queued: "#f59e0b",
  playing: "#34d399",
  paused: "#a78bfa",
};

export function RoomPanel({ session }: Props) {
  const countdown = secondsUntil(session.scheduledStartIso);
  const stateLabel = STATE_LABEL[session.playbackState] ?? session.playbackState;
  const stateColor = STATE_COLOR[session.playbackState] ?? "#5a5080";

  return (
    <section className="room-panel">
      <div className="room-panel__top">
        <div className="room-panel__left">
          <span className="room-code-pill">{session.roomCode}</span>
          <span className="room-role">{session.role}</span>
        </div>
        <span className="playback-state-badge" style={{ color: stateColor, borderColor: stateColor }}>
          {countdown !== null ? `Starting in ${countdown}s` : stateLabel}
        </span>
      </div>
      <div className="room-panel__stats">
        <span className="room-stat">
          <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>
          {session.listenerCount} {session.listenerCount === 1 ? "person" : "people"}
        </span>
        {session.role === "listener" && session.driftMs !== 0 && (
          <span className="room-stat room-stat--drift">
            Drift: {session.driftMs > 0 ? "+" : ""}{session.driftMs}ms
          </span>
        )}
      </div>
    </section>
  );
}
