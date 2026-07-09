"use client";

import type { NormalizedInvoice } from "@/lib/cashflow";
import { currency } from "@/lib/cashflow";
import { Card, EmptyState } from "./ui";

interface Column {
  key: string;
  label: string;
  accent: string;
  filter: (i: NormalizedInvoice) => boolean;
}

const COLUMNS: Column[] = [
  { key: "forecast", label: "Forecast (Not Due Soon)", accent: "border-t-blue-500", filter: (i) => i.outstanding > 0 && !i.isOverdue && i.daysPastDue === 0 && diffDays(i.due_date) > 7 },
  { key: "due-soon", label: "Due Soon (7 days)", accent: "border-t-orange-400", filter: (i) => i.outstanding > 0 && !i.isOverdue && diffDays(i.due_date) <= 7 && diffDays(i.due_date) >= 0 },
  { key: "overdue", label: "Overdue", accent: "border-t-red-500", filter: (i) => i.isOverdue },
  { key: "partial", label: "Partially Collected", accent: "border-t-purple-500", filter: (i) => i.status === "partial" && i.outstanding > 0 },
  { key: "paid", label: "Fully Collected", accent: "border-t-emerald-500", filter: (i) => i.status === "paid" },
];

function diffDays(dateStr: string): number {
  return Math.round((Date.parse(dateStr) - Date.now()) / 86400000);
}

export function PipelinePanel({ invoices, onCardClick }: { invoices: NormalizedInvoice[]; onCardClick?: (id: string) => void }) {
  return (
    <Card title="Collections Pipeline" subtitle="Every open, overdue, and settled invoice, grouped by where it stands.">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {COLUMNS.map((col) => {
          const items = invoices.filter(col.filter);
          const total = items.reduce((s, i) => s + (i.status === "paid" ? i.total : i.outstanding), 0);
          return (
            <div key={col.key} className={`flex flex-col rounded-xl border border-slate-200 border-t-4 bg-slate-50/60 ${col.accent}`}>
              <div className="border-b border-slate-200 bg-white p-3">
                <p className="text-xs font-semibold text-slate-700">{col.label}</p>
                <p className="text-[11px] text-slate-400">{items.length} invoice{items.length === 1 ? "" : "s"} · {currency(total)}</p>
              </div>
              <div className="flex max-h-80 flex-col gap-2 overflow-y-auto p-2">
                {items.length === 0 ? (
                  <p className="p-3 text-center text-[11px] text-slate-300">Empty</p>
                ) : (
                  items.map((inv) => (
                    <button
                      key={inv.id}
                      type="button"
                      onClick={() => onCardClick?.(inv.id)}
                      className="rounded-lg border border-slate-200 bg-white p-2.5 text-left text-xs shadow-sm hover:border-brand hover:shadow"
                    >
                      <p className="font-semibold text-slate-800">{inv.invoice_no}</p>
                      <p className="truncate text-slate-500">{inv.customer_name}</p>
                      <p className="mt-1 flex items-center justify-between">
                        <span className="font-medium text-slate-900">{currency(inv.status === "paid" ? inv.total : inv.outstanding)}</span>
                        <span className="text-[10px] text-slate-400">{inv.due_date}</span>
                      </p>
                    </button>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
      {invoices.length === 0 && <EmptyState title="No invoices to show" />}
    </Card>
  );
}
