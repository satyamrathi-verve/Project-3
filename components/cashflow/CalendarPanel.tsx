"use client";

import { useMemo, useState } from "react";
import type { NormalizedInvoice } from "@/lib/cashflow";
import { compactCurrency, currency } from "@/lib/cashflow";
import { Card } from "./ui";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function CalendarPanel({ invoices, onDayClick }: { invoices: NormalizedInvoice[]; onDayClick?: (date: string) => void }) {
  const [monthOffset, setMonthOffset] = useState(0);
  const [heatMap, setHeatMap] = useState(false);

  const { year, month, label, cells, maxDay } = useMemo(() => {
    const base = new Date();
    base.setDate(1);
    base.setMonth(base.getMonth() + monthOffset);
    const y = base.getFullYear();
    const m = base.getMonth();

    const byDay = new Map<string, { amount: number; count: number }>();
    for (const inv of invoices) {
      if (inv.outstanding <= 0) continue;
      const d = new Date(inv.due_date + "T00:00:00");
      if (d.getFullYear() !== y || d.getMonth() !== m) continue;
      const existing = byDay.get(inv.due_date) ?? { amount: 0, count: 0 };
      existing.amount += inv.outstanding;
      existing.count += 1;
      byDay.set(inv.due_date, existing);
    }

    const firstWeekday = new Date(y, m, 1).getDay();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const cellList: { date: string | null; day: number; amount: number; count: number }[] = [];
    for (let i = 0; i < firstWeekday; i++) cellList.push({ date: null, day: 0, amount: 0, count: 0 });
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const entry = byDay.get(dateStr);
      cellList.push({ date: dateStr, day: d, amount: entry?.amount ?? 0, count: entry?.count ?? 0 });
    }

    return {
      year: y,
      month: m,
      label: base.toLocaleDateString("en-IN", { month: "long", year: "numeric" }),
      cells: cellList,
      maxDay: Math.max(1, ...Array.from(byDay.values()).map((v) => v.amount)),
    };
  }, [invoices, monthOffset]);

  return (
    <Card
      title="Cash Flow Calendar"
      subtitle="Expected collections by due date. Toggle Heat Map to see concentration at a glance."
      action={
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setHeatMap((v) => !v)} className="rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-cream-dim">
            {heatMap ? "Show Amounts" : "Heat Map"}
          </button>
          <button type="button" onClick={() => setMonthOffset((v) => v - 1)} className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-cream-dim">‹</button>
          <span className="min-w-[7rem] text-center text-xs font-semibold text-slate-700">{label}</span>
          <button type="button" onClick={() => setMonthOffset((v) => v + 1)} className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-cream-dim">›</button>
        </div>
      }
    >
      <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-semibold uppercase tracking-wide text-slate-400">
        {WEEKDAYS.map((w) => (
          <div key={w}>{w}</div>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {cells.map((c, i) => {
          const intensity = c.amount > 0 ? Math.max(0.12, c.amount / maxDay) : 0;
          return (
            <button
              key={i}
              type="button"
              disabled={!c.date}
              onClick={() => c.date && onDayClick?.(c.date)}
              title={c.date && c.amount > 0 ? `${c.date}: ${currency(c.amount)} across ${c.count} invoice(s)` : undefined}
              className={`flex h-16 flex-col items-start justify-between rounded-lg border p-1.5 text-left text-[10px] transition-colors ${
                !c.date ? "border-transparent" : c.amount > 0 ? "border-slate-200 hover:border-brand" : "border-slate-100 text-slate-300"
              }`}
              style={c.date && c.amount > 0 && heatMap ? { backgroundColor: `rgba(239,68,68,${intensity})` } : undefined}
            >
              {c.date && <span className={`font-medium ${c.amount > 0 && heatMap && intensity > 0.5 ? "text-white" : "text-slate-500"}`}>{c.day}</span>}
              {c.date && c.amount > 0 && !heatMap && (
                <span className="w-full truncate font-semibold text-slate-800">{compactCurrency(c.amount)}</span>
              )}
            </button>
          );
        })}
      </div>
    </Card>
  );
}
