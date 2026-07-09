/*
  Self-contained decorative background for the Sign In screen — no external
  image requests (nothing to fetch, nothing that can fail to load). A loose
  collage of accounting-themed line icons (invoice, ledger grid, charts,
  office) plus a rising bar-chart silhouette, under a dark scrim so the card
  stays readable.
*/

function Icon({ path, className }: { path: React.ReactNode; className: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {path}
    </svg>
  );
}

const ICONS = [
  {
    // invoice / financial report
    path: (
      <>
        <path d="M6 2h9l3 3v17H6z" />
        <path d="M9 8h6M9 12h6M9 16h4" />
      </>
    ),
    style: { top: "8%", left: "8%", width: 110, transform: "rotate(-8deg)" },
  },
  {
    // ledger / spreadsheet grid
    path: (
      <>
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
      </>
    ),
    style: { top: "62%", left: "5%", width: 130, transform: "rotate(6deg)" },
  },
  {
    // trending line chart / business analytics
    path: (
      <>
        <path d="M3 17l6-6 4 4 8-8" />
        <path d="M17 7h4v4" />
      </>
    ),
    style: { top: "14%", right: "10%", width: 140, transform: "rotate(4deg)" },
  },
  {
    // pie chart / accounting dashboard
    path: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 3v9l6 6" />
      </>
    ),
    style: { bottom: "26%", right: "7%", width: 100, transform: "rotate(-6deg)" },
  },
  {
    // office / corporate building
    path: (
      <>
        <path d="M4 21V6l8-4 8 4v15" />
        <path d="M9 21v-6h6v6M9 10h.01M15 10h.01M9 14h.01M15 14h.01" />
      </>
    ),
    style: { top: "38%", left: "42%", width: 90, transform: "rotate(-3deg)" },
  },
  {
    // AR / currency flow
    path: (
      <>
        <line x1="12" y1="1" x2="12" y2="23" />
        <path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
      </>
    ),
    style: { bottom: "10%", left: "22%", width: 90, transform: "rotate(5deg)" },
  },
];

export function LoginBackground() {
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden="true">
      {/* Ledger-paper grid */}
      <div
        className="absolute inset-0 opacity-[0.06]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(0deg, rgba(255,255,255,.6) 0 1px, transparent 1px 32px), repeating-linear-gradient(90deg, rgba(255,255,255,.6) 0 1px, transparent 1px 32px)",
        }}
      />

      {/* Scattered accounting-themed icon collage */}
      {ICONS.map((icon, i) => (
        <div key={i} className="absolute text-white opacity-[0.10]" style={icon.style as React.CSSProperties}>
          <Icon path={icon.path} className="h-auto w-full" />
        </div>
      ))}

      <div className="absolute inset-0 bg-[radial-gradient(circle_at_25%_20%,rgba(47,107,255,0.35),transparent_55%)]" />

      {/* Rising bar-chart silhouette */}
      <div className="absolute inset-x-0 bottom-0 flex h-64 items-end gap-3 px-8 opacity-[0.15] sm:gap-6 sm:px-16">
        {[30, 55, 40, 70, 50, 85, 60, 95, 45, 75, 35, 65].map((h, i) => (
          <div
            key={i}
            className="animate-bar-rise flex-1 rounded-t bg-brand"
            style={{ height: `${h}%`, animationDelay: `${i * 60}ms` }}
          />
        ))}
      </div>

      {/* Dark scrim so the card stays easy to read */}
      <div className="absolute inset-0 bg-gradient-to-b from-slate-900/85 via-slate-900/75 to-slate-950/90" />
    </div>
  );
}
