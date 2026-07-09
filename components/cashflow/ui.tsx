import type { ReactNode } from "react";

/** Premium white card: rounded corners, subtle border + shadow. Base unit for the whole module. */
export function Card({
  title,
  subtitle,
  action,
  children,
  className = "",
}: {
  title?: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-2xl border border-slate-200 bg-cream p-5 shadow-sm transition-shadow hover:shadow-md ${className}`}>
      {(title || action) && (
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            {title && <h3 className="text-sm font-semibold text-slate-900">{title}</h3>}
            {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
          </div>
          {action && <div className="flex-none">{action}</div>}
        </div>
      )}
      {children}
    </div>
  );
}

export type KpiTone = "green" | "blue" | "orange" | "red" | "purple" | "slate";

const TONE_STYLES: Record<KpiTone, { ring: string; text: string; bg: string }> = {
  green: { ring: "ring-emerald-100", text: "text-emerald-600", bg: "bg-emerald-50" },
  blue: { ring: "ring-blue-100", text: "text-blue-600", bg: "bg-blue-50" },
  orange: { ring: "ring-orange-100", text: "text-orange-600", bg: "bg-orange-50" },
  red: { ring: "ring-red-100", text: "text-red-600", bg: "bg-red-50" },
  purple: { ring: "ring-purple-100", text: "text-purple-600", bg: "bg-purple-50" },
  slate: { ring: "ring-slate-100", text: "text-slate-600", bg: "bg-cream-dim" },
};

export function KpiCard({
  label,
  value,
  hint,
  tone = "slate",
  icon,
  onClick,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: KpiTone;
  icon?: ReactNode;
  onClick?: () => void;
}) {
  const t = TONE_STYLES[tone];
  const Comp = onClick ? "button" : "div";
  return (
    <Comp
      onClick={onClick}
      type={onClick ? "button" : undefined}
      className={`flex w-full flex-col gap-2 rounded-2xl border border-slate-200 bg-cream p-4 text-left shadow-sm ring-1 ring-transparent transition-all ${
        onClick ? "cursor-pointer hover:-translate-y-0.5 hover:shadow-md hover:" + t.ring : ""
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</span>
        {icon && <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${t.bg} ${t.text}`}>{icon}</span>}
      </div>
      <span className="text-2xl font-bold tabular-nums text-slate-900">{value}</span>
      {hint && <span className="text-xs text-slate-400">{hint}</span>}
    </Comp>
  );
}

export type Tone = KpiTone;

export function Badge({ tone, children }: { tone: Tone; children: ReactNode }) {
  const t = TONE_STYLES[tone];
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${t.bg} ${t.text}`}>
      {children}
    </span>
  );
}

export function riskTone(level: "Low" | "Medium" | "High"): Tone {
  return level === "High" ? "red" : level === "Medium" ? "orange" : "green";
}

export function statusTone(status: string): Tone {
  if (status === "paid") return "green";
  if (status === "overdue") return "red";
  if (status === "partial") return "orange";
  return "blue";
}

export function Skeleton({ className = "h-4 w-full" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-slate-100 ${className}`} />;
}

export function EmptyState({ title, note }: { title: string; note?: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-cream-dim/50 px-6 py-10 text-center">
      <p className="text-sm font-medium text-slate-500">{title}</p>
      {note && <p className="mt-1 max-w-sm text-xs text-slate-400">{note}</p>}
    </div>
  );
}

export function LoadingGrid() {
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="rounded-2xl border border-slate-200 bg-cream p-4">
          <Skeleton className="mb-3 h-3 w-2/3" />
          <Skeleton className="h-6 w-1/2" />
        </div>
      ))}
    </div>
  );
}
