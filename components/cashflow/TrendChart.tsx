"use client";

import { useMemo, useState } from "react";
import type { TrendPoint } from "@/lib/cashflow";
import { currency } from "@/lib/cashflow";
import { Card } from "./ui";

export function TrendChart({ points }: { points: TrendPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = useMemo(() => Math.max(1, ...points.map((p) => Math.max(p.invoiced, p.collected))), [points]);

  const linePoints = (field: "invoiced" | "collected") =>
    points
      .map((p, i) => {
        const x = points.length > 1 ? (i / (points.length - 1)) * 100 : 50;
        const y = 100 - (p[field] / max) * 100;
        return `${x},${y}`;
      })
      .join(" ");

  return (
    <Card title="12-Month Cash Flow Trend" subtitle="Invoiced value vs. actually collected, month by month.">
      <div className="relative" style={{ height: 220 }}>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
          <polygon
            points={`0,100 ${linePoints("collected")} 100,100`}
            fill="rgba(22,163,74,0.08)"
            stroke="none"
          />
          <polyline points={linePoints("invoiced")} fill="none" stroke="#2f6bff" strokeWidth="0.8" vectorEffect="non-scaling-stroke" />
          <polyline points={linePoints("collected")} fill="none" stroke="#16a34a" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        </svg>

        <div className="absolute inset-0 flex">
          {points.map((p, i) => (
            <div
              key={p.key}
              className="relative flex-1"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            >
              {hover === i && (
                <div className="pointer-events-none absolute bottom-2 left-1/2 z-10 w-40 -translate-x-1/2 rounded-lg bg-slate-900 p-2.5 text-left text-[11px] text-white shadow-lg">
                  <p className="mb-1 font-semibold">{p.label}</p>
                  <p className="flex justify-between"><span className="text-blue-300">Invoiced</span><span>{currency(p.invoiced)}</span></p>
                  <p className="flex justify-between"><span className="text-emerald-300">Collected</span><span>{currency(p.collected)}</span></p>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="mt-2 flex justify-between text-[10px] text-slate-400">
        {points.map((p) => (
          <span key={p.key}>{p.label}</span>
        ))}
      </div>
      <div className="mt-3 flex gap-4 border-t border-slate-100 pt-3 text-[11px] text-slate-500">
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-blue-500" />Invoiced</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-emerald-600" />Collected</span>
      </div>
    </Card>
  );
}
