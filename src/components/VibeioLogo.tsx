export function VibeioLogo() {
  return (
    <div className="logo-lockup">
      <svg
        className="logo-mark"
        viewBox="0 0 44 44"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        fill="none"
      >
        <defs>
          <linearGradient id="lg" x1="0" y1="0" x2="44" y2="44" gradientUnits="userSpaceOnUse">
            <stop stopColor="#a78bfa" />
            <stop offset="1" stopColor="#34d399" />
          </linearGradient>
        </defs>
        {/* Rounded background */}
        <rect width="44" height="44" rx="12" fill="url(#lg)" />
        {/* Play triangle */}
        <polygon points="17,13 17,31 33,22" fill="#0c0a14" />
        {/* Sound wave arcs */}
        <path d="M36 16 Q40 22 36 28" stroke="#0c0a14" strokeWidth="2.2" strokeLinecap="round" fill="none" opacity="0.7"/>
        <path d="M38.5 13 Q44 22 38.5 31" stroke="#0c0a14" strokeWidth="2" strokeLinecap="round" fill="none" opacity="0.35"/>
      </svg>
      <span className="logo-word">Vibeo</span>
    </div>
  );
}
