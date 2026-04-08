import { RoomSession } from "../types";
import { secondsUntil } from "../utils/time";

type Props = {
  session: RoomSession;
};

export function RoomPanel({ session }: Props) {
  const countdown = secondsUntil(session.scheduledStartIso);

  return (
    <section className="room-panel">
      <div className="room-panel__top">
        <span className="room-code-pill">{session.roomCode}</span>
        <span className="room-role">{session.role}</span>
      </div>
      <div className="metric-grid">
        <Metric label="People here" value={`${session.listenerCount}`} />
        <Metric label="Playback" value={session.playbackState} />
        <Metric label="Drift" value={`${session.driftMs} ms`} />
        {countdown !== null
          ? <Metric label="Starts in" value={`${countdown}s`} />
          : <Metric label="Scheduled" value="—" />
        }
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
