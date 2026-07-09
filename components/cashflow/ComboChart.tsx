"use client";

import { useMemo, useState } from "react";
import type { ComboBucket, Granularity } from "@/lib/cashflow";
import { compactCurrency, currency } from "@/lib/cashflow";
import { Card } from "./ui";

const GRANULARITIES: { key: Granularity; label: string }[] = [
  { key: "day", label: "Daily" },
  { key: "week", label: "Weekly" },
  { key: "month", label: "Monthly" },
  { key: "quarter", label: "Quarterly" },
  { key: "year", label: "Yearly" },
];

export function ComboChart({
  buckets,
  granularity,
  onGranularityChange,
  onBucketClick,
}: {
  buckets: ComboBucket[];
  granularity: Granularity;
  onGranularityChange: (g: Granularity) => void;
  onBucketClick?: (key: string) => void;
}) {
  const [hover, setHover] = useState<number | null>(null);

  const maxValue = useMemo(
    () => Math.max(1, ...buckets.map((b) => Math.max(b.forecast + b.dueSoon + b.overdue, b.actual, b.target))),
    [buckets]
  );

  const linePoints = (field: "actual" | "target") =>
    buckets
      .map((b, i) => {
        const x = buckets.length > 1 ? (i / (buckets.length - 1)) * 100 : 50;
        const y = 100 - (b[field] / maxValue) * 100;
        return `${x},${y}`;
      })
      .join(" ");

  return (
    <Card
      title="Expected Collections vs Target"
      subtitle="Stacked bars show the forecast mix by urgency; lines compare actual collections against target (invoiced-due) amounts."
      action={
        <div className="flex rounded-lg border border-slate-200 p-1">
          {GRANULARITIES.map((g) => (
            <button
              key={g.key}
              type="button"
              onClick={() => onGranularityChange(g.key)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                granularity === g.key ? "bg-brand text-white" : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {g.label}
            </button>
          ))}
        </div>
      }
    >
      {buckets.length === 0 ? (
        <p className="py-10 text-center text-sm text-slate-400">No data for this view.</p>
      ) : (
        <>
          <div className="relative" style={{ height: 260 }}>
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full">
              <polyline points={linePoints("target")} fill="none" stroke="#a855f7" strokeWidth="0.8" strokeDasharray="2,2" vectorEffect="non-scaling-stroke" />
              <polyline points={linePoints("actual")} fill="none" stroke="#16a34a" strokeWidth="1" vectorEffect="non-scaling-stroke" />
            </svg>

            <div className="flex h-full items-end gap-1.5">
              {buckets.map((b, i) => {
                const total = b.forecast + b.dueSoon + b.overdue;
                return (
                  <button
                    key={b.key}
                    type="button"
                    onClick={() => onBucketClick?.(b.key)}
                    onMouseEnter={() => setHover(i)}
                    onMouseLeave={() => setHover(null)}
                    className="group relative flex h-full flex-1 flex-col justify-end"
                  >
                    <div className="flex flex-col justify-end overflow-hidden rounded-t-md" style={{ height: `${(total / maxValue) * 100}%`, minHeight: total > 0 ? 2 : 0 }}>
                      {b.overdue > 0 && <div className="w-full bg-red-500" style={{ height: `${(b.overdue / Math.max(total, 1)) * 100}%` }} />}
                      {b.dueSoon > 0 && <div className="w-full bg-orange-400" style={{ height: `${(b.dueSoon / Math.max(total, 1)) * 100}%` }} />}
                      {b.forecast > 0 && <div className="w-full bg-blue-500" style={{ height: `${(b.forecast / Math.max(total, 1)) * 100}%` }} />}
                    </div>

                    {hover === i && (
                      <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 w-44 -translate-x-1/2 rounded-lg bg-slate-900 p-2.5 text-left text-[11px] text-white shadow-lg">
                        <p className="mb-1 font-semibold">{b.label}</p>
                        <p className="flex justify-between"><span className="text-blue-300">Forecast</span><span>{currency(b.forecast)}</span></p>
                        <p className="flex justify-between"><span className="text-orange-300">Due Soon</span><span>{currency(b.dueSoon)}</span></p>
                        <p className="flex justify-between"><span className="text-red-300">Overdue</span><span>{currency(b.overdue)}</span></p>
                        <p className="mt-1 flex justify-between border-t border-white/20 pt-1"><span className="text-emerald-300">Actual</span><span>{currency(b.actual)}</span></p>
                        <p className="flex justify-between"><span className="text-purple-300">Target</span><span>{currency(b.target)}</span></p>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-slate-100 pt-3 text-[11px] text-slate-500">
            <Legend swatch="bg-blue-500" label="Forecast" />
            <Legend swatch="bg-orange-400" label="Due Soon" />
            <Legend swatch="bg-red-500" label="Overdue" />
            <Legend line="border-emerald-600" label="Actual collections" />
            <Legend line="border-purple-500 border-dashed" label="Target" />
          </div>

          <div className="mt-2 flex flex-wrap gap-x-4 text-[11px] text-slate-400">
            {buckets.map((b) => (
              <span key={b.key} className={b.isPast ? "text-red-400" : ""}>
                {b.label}
              </span>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}

function Legend({ swatch, line, label }: { swatch?: string; line?: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {swatch && <span className={`h-2.5 w-2.5 rounded-sm ${swatch}`} />}
      {line && <span className={`inline-block w-4 border-t-2 ${line}`} />}
      {label}
    </span>
  );
}
