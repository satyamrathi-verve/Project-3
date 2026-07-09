import type { ReactNode } from "react";

/*
  Reusable summary tile for list-screen headers (Receipts, and later the
  Dashboard's overview tiles). Keep the tone palette small and reuse it.
*/
export function StatTile({
  icon,
  tone,
  label,
  value,
  sub,
}: {
  icon: ReactNode;
  tone: "blue" | "emerald" | "purple" | "amber";
  label: string;
  value: string;
  sub?: string;
}) {
  const toneClass = {
    blue: "bg-blue-50 text-blue-600",
    emerald: "bg-emerald-50 text-emerald-600",
    purple: "bg-purple-50 text-purple-600",
    amber: "bg-amber-50 text-amber-600",
  }[tone];

  return (
    <div className="rounded-xl border border-slate-200 bg-cream p-5">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p>
        <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${toneClass}`}>{icon}</span>
      </div>
      <p className="text-2xl font-bold text-slate-900">{value}</p>
      {sub && <p className="mt-1 text-xs text-slate-400">{sub}</p>}
    </div>
  );
}
