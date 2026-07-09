"use client";

import type { CustomerMetrics } from "@/lib/cashflow";
import { currency } from "@/lib/cashflow";
import { Badge, Card, EmptyState, riskTone } from "./ui";

export function RiskPanel({ customers }: { customers: CustomerMetrics[] }) {
  const ranked = [...customers].filter((c) => c.invoiceCount > 0).sort((a, b) => b.riskScore - a.riskScore);

  return (
    <Card
      title="Customer Risk Analysis"
      subtitle="Risk score is derived from real data: overdue ratio, historical payment delay, and credit-limit utilisation — not a stored field."
    >
      {ranked.length === 0 ? (
        <EmptyState title="No customer activity yet" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-cream-dim text-left">
                <th className="px-3 py-2 font-semibold text-slate-600">Customer</th>
                <th className="px-3 py-2 font-semibold text-slate-600">Risk</th>
                <th className="px-3 py-2 text-right font-semibold text-slate-600">Risk Score</th>
                <th className="px-3 py-2 text-right font-semibold text-slate-600">Outstanding</th>
                <th className="px-3 py-2 text-right font-semibold text-slate-600">Overdue</th>
                <th className="px-3 py-2 text-right font-semibold text-slate-600">Avg Delay</th>
                <th className="px-3 py-2 text-right font-semibold text-slate-600">On-Time %</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((c) => (
                <tr key={c.id} className="border-b border-slate-100 last:border-0 hover:bg-cream-dim">
                  <td className="px-3 py-2 font-medium text-slate-800">{c.name}</td>
                  <td className="px-3 py-2"><Badge tone={riskTone(c.riskLevel)}>{c.riskLevel}</Badge></td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className={`h-full ${c.riskLevel === "High" ? "bg-red-500" : c.riskLevel === "Medium" ? "bg-orange-400" : "bg-emerald-500"}`}
                          style={{ width: `${c.riskScore}%` }}
                        />
                      </div>
                      <span className="tabular-nums text-slate-600">{c.riskScore}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right text-slate-700">{currency(c.outstanding)}</td>
                  <td className="px-3 py-2 text-right text-slate-700">{c.overdueAmount > 0 ? currency(c.overdueAmount) : "–"}</td>
                  <td className="px-3 py-2 text-right text-slate-700">{c.avgDelayDays > 0 ? `${c.avgDelayDays.toFixed(0)}d` : "–"}</td>
                  <td className="px-3 py-2 text-right text-slate-700">{c.onTimePct.toFixed(0)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
