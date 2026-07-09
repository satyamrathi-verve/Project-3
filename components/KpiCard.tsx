import type { ReactNode } from "react";

const TONE_CLASSES = {
  default: "text-slate-900",
  danger: "text-red-700",
  success: "text-emerald-700",
} as const;

export function KpiCard({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: keyof typeof TONE_CLASSES;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-[22px] font-semibold leading-tight tabular-nums ${TONE_CLASSES[tone]}`}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-400">{hint}</p>}
    </div>
  );
}
