import { useEffect, useId, useRef } from "react";

type Props = {
  videoId: string;
  startSeconds?: number;
  shouldPlay: boolean;
  seekToken?: number;
  showControls?: boolean;
  onPlaybackSample?: (sample: { currentTime: number; state: string }) => void;
};

type PlayerWithApi = {
  cueVideoById: (args: { videoId: string; startSeconds: number }) => void;
  loadVideoById: (args: { videoId: string; startSeconds: number }) => void;
  playVideo: () => void;
  pauseVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  getCurrentTime: () => number;
  getPlayerState: () => number;
  destroy: () => void;
};

declare global {
  interface Window {
    YT?: {
      Player: new (
        elementId: string,
        options: {
          width: string;
          height: string;
          videoId: string;
          playerVars: Record<string, number>;
          events: {
            onReady?: () => void;
            onStateChange?: (event: { data: number }) => void;
          };
        },
      ) => PlayerWithApi;
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

const stateMap: Record<number, string> = {
  [-1]: "unstarted",
  0: "ended",
  1: "playing",
  2: "paused",
  3: "buffering",
  5: "cued",
};

export function YouTubePlayer({
  videoId,
  startSeconds = 0,
  shouldPlay,
  seekToken,
  showControls = true,
  onPlaybackSample,
}: Props) {
  const playerRef = useRef<PlayerWithApi | null>(null);
  const isReadyRef = useRef(false);
  const containerId = useId().replace(/:/g, "_");

  // Stable refs — always current, never cause effects to re-run
  const shouldPlayRef = useRef(shouldPlay);
  const startSecondsRef = useRef(startSeconds);
  const onPlaybackSampleRef = useRef(onPlaybackSample);
  useEffect(() => { shouldPlayRef.current = shouldPlay; }, [shouldPlay]);
  useEffect(() => { startSecondsRef.current = startSeconds; }, [startSeconds]);
  useEffect(() => { onPlaybackSampleRef.current = onPlaybackSample; }, [onPlaybackSample]);

  // Mount/destroy player when videoId changes
  useEffect(() => {
    let disposed = false;
    let intervalId: number | null = null;
    isReadyRef.current = false;

    loadYouTubeApi().then(() => {
      if (disposed || !window.YT) return;

      playerRef.current = new window.YT.Player(containerId, {
        width: "100%",
        height: "100%",
        videoId,
        playerVars: {
          autoplay: 0,
          controls: showControls ? 1 : 0,
          rel: 0,
          playsinline: 1,
          modestbranding: 1,
          disablekb: showControls ? 0 : 1,
          fs: showControls ? 1 : 0,
        },
        events: {
          onReady: () => {
            if (disposed || !playerRef.current) return;
            isReadyRef.current = true;
            if (shouldPlayRef.current) {
              // Load and play from the correct position
              playerRef.current.loadVideoById({ videoId, startSeconds: startSecondsRef.current });
            } else {
              // Just buffer, don't play
              playerRef.current.cueVideoById({ videoId, startSeconds: startSecondsRef.current });
            }
          },
          onStateChange: (event) => {
            onPlaybackSampleRef.current?.({
              currentTime: playerRef.current?.getCurrentTime() ?? 0,
              state: stateMap[event.data] ?? "unknown",
            });
          },
        },
      });

      intervalId = window.setInterval(() => {
        if (!playerRef.current) return;
        onPlaybackSampleRef.current?.({
          currentTime: playerRef.current.getCurrentTime(),
          state: stateMap[playerRef.current.getPlayerState()] ?? "unknown",
        });
      }, 1000);
    });

    return () => {
      disposed = true;
      isReadyRef.current = false;
      if (intervalId !== null) window.clearInterval(intervalId);
      playerRef.current?.destroy();
      playerRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerId, videoId]);

  const prevShouldPlay = useRef(shouldPlay);

  // shouldPlay changed: play or pause
  useEffect(() => {
    if (!playerRef.current || !isReadyRef.current) return;
    const wasPlaying = prevShouldPlay.current;
    prevShouldPlay.current = shouldPlay;

    if (shouldPlay) {
      // Seek only when transitioning from paused→playing, not on every startSeconds tick
      if (!wasPlaying) {
        playerRef.current.seekTo(startSeconds, true);
      }
      playerRef.current.playVideo();
    } else {
      playerRef.current.pauseVideo();
    }
  }, [shouldPlay, startSeconds]); // eslint-disable-line react-hooks/exhaustive-deps

  // Explicit seek (host scrubbing)
  useEffect(() => {
    if (!playerRef.current || !isReadyRef.current || !seekToken) return;
    playerRef.current.seekTo(startSecondsRef.current, true);
    if (shouldPlayRef.current) playerRef.current.playVideo();
  }, [seekToken]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={`player-shell${showControls ? "" : " player-shell--locked"}`}>
      <div id={containerId} className="player-frame" />
    </div>
  );
}

let youtubeApiPromise: Promise<void> | null = null;

function loadYouTubeApi() {
  if (youtubeApiPromise) return youtubeApiPromise;

  youtubeApiPromise = new Promise<void>((resolve) => {
    if (window.YT?.Player) { resolve(); return; }

    if (!document.getElementById("youtube-iframe-api")) {
      const script = document.createElement("script");
      script.id = "youtube-iframe-api";
      script.src = "https://www.youtube.com/iframe_api";
      document.body.appendChild(script);
    }

    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { prev?.(); resolve(); };
  });

  return youtubeApiPromise;
}
