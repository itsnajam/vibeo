import { useState } from "react";
import { extractYouTubeVideoId, buildYouTubeThumbnail } from "../utils/youtube";

type Props = {
  onSelect: (videoId: string, title: string) => void;
  disabled?: boolean;
};

type Suggestion = { videoId: string; title: string; channel: string };

// Curated suggestions so the host can pick something fast without typing
const SUGGESTIONS: Suggestion[] = [
  { videoId: "jfKfPfyJRdk", title: "lofi hip hop radio", channel: "Lofi Girl" },
  { videoId: "4xDzrJKXOOY", title: "synthwave radio", channel: "Lofi Girl" },
  { videoId: "DWcJFNfaw9c", title: "jazz & bossa nova", channel: "Lofi Girl" },
  { videoId: "HuFYqnbVbzY", title: "chill beats to study", channel: "ChilledCow" },
  { videoId: "5qap5aO4i9A", title: "lofi hip hop beats", channel: "Lofi Girl" },
];

export function VideoSearch({ onSelect, disabled }: Props) {
  const [input, setInput] = useState("");
  const [title, setTitle] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(true);

  const parsedId = extractYouTubeVideoId(input);

  function handleSelect(videoId: string, videoTitle: string) {
    onSelect(videoId, videoTitle);
    setInput("");
    setTitle("");
    setShowSuggestions(true);
  }

  function handleInputChange(val: string) {
    setInput(val);
    setShowSuggestions(false);
    const id = extractYouTubeVideoId(val);
    if (!id) setTitle("");
  }

  return (
    <div className="video-search">
      <div className="video-search__input-row">
        <input
          value={input}
          onChange={(e) => handleInputChange(e.target.value)}
          placeholder="Paste a YouTube URL or video ID"
          disabled={disabled}
          onFocus={() => !input && setShowSuggestions(true)}
        />
        {input && (
          <button
            className="video-search__clear"
            onClick={() => { setInput(""); setTitle(""); setShowSuggestions(true); }}
            type="button"
            aria-label="Clear"
          >✕</button>
        )}
      </div>

      {/* Live preview once a valid ID is parsed */}
      {parsedId && (
        <div className="video-preview">
          <img
            src={buildYouTubeThumbnail(parsedId)}
            alt="Video thumbnail"
            className="video-preview__thumb"
          />
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Enter a title for this video"
            disabled={disabled}
          />
          <span className="video-preview__id">ID: {parsedId}</span>
          <button
            className="primary-btn"
            onClick={() => handleSelect(parsedId, title || `YouTube · ${parsedId}`)}
            disabled={disabled}
            type="button"
          >
            Use this video
          </button>
        </div>
      )}

      {/* Quick-pick suggestions */}
      {showSuggestions && !parsedId && (
        <div className="video-suggestions">
          <p className="video-suggestions__label">Quick picks</p>
          <div className="video-suggestions__grid">
            {SUGGESTIONS.map((s) => (
              <button
                key={s.videoId}
                className="suggestion-card"
                onClick={() => handleSelect(s.videoId, s.title)}
                disabled={disabled}
                type="button"
              >
                <img src={buildYouTubeThumbnail(s.videoId)} alt={s.title} className="suggestion-card__thumb" />
                <div className="suggestion-card__info">
                  <span className="suggestion-card__title">{s.title}</span>
                  <span className="suggestion-card__channel">{s.channel}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
