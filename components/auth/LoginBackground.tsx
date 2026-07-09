/*
  Self-contained decorative background for the Sign In screen — no external
  image requests (nothing to fetch, nothing that can fail to load). A loose
  collage of accounting-themed line icons (invoice, ledger grid, calculator,
  charts, office) plus a rising bar-chart silhouette, under a blue scrim so
  the card stays readable.
*/
import {
  FinanceIcon,
  invoicePath,
  ledgerGridPath,
  trendChartPath,
  pieChartPath,
  buildingPath,
  currencyFlowPath,
  calculatorPath,
} from "@/components/decor/financeIcons";

const ICONS = [
  { path: invoicePath, style: { top: "8%", left: "8%", width: 110, transform: "rotate(-8deg)" } },
  { path: ledgerGridPath, style: { top: "62%", left: "5%", width: 130, transform: "rotate(6deg)" } },
  { path: trendChartPath, style: { top: "14%", right: "10%", width: 140, transform: "rotate(4deg)" } },
  { path: pieChartPath, style: { bottom: "26%", right: "7%", width: 100, transform: "rotate(-6deg)" } },
  { path: buildingPath, style: { top: "38%", left: "42%", width: 90, transform: "rotate(-3deg)" } },
  { path: currencyFlowPath, style: { bottom: "10%", left: "22%", width: 90, transform: "rotate(5deg)" } },
  { path: calculatorPath, style: { top: "58%", right: "22%", width: 85, transform: "rotate(7deg)" } },
];

export function LoginBackground() {
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden="true">
      {/* Scattered accounting-themed icon collage */}
      {ICONS.map((icon, i) => (
        <div key={i} className="absolute text-white opacity-[0.18]" style={icon.style as React.CSSProperties}>
          <FinanceIcon path={icon.path} className="h-auto w-full" />
        </div>
      ))}

      <div className="absolute inset-0 bg-[radial-gradient(circle_at_25%_20%,rgba(120,160,255,0.35),transparent_55%)]" />

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

      {/* Blue scrim so the card stays easy to read, kept in the same blue family as the base */}
      <div className="absolute inset-0 bg-gradient-to-b from-chrome-dark/40 via-chrome/25 to-chrome-dark/55" />
    </div>
  );
}
