"use client";

import { AGING_BUCKETS, type AgingRow, type AgingBucket } from "@/lib/cashflow";
import { currency, compactCurrency } from "@/lib/cashflow";
import { Card } from "./ui";

const BUCKET_COLOR: Record<AgingBucket, string> = {
  Current: "bg-blue-500",
  "1-30": "bg-orange-400",
  "31-60": "bg-orange-500",
  "61-90": "bg-red-400",
  "90+": "bg-red-600",
};

export function AgingPanel({
  rows,
  totals,
  onCustomerClick,
}: {
  rows: AgingRow[];
  totals: Record<AgingBucket, number>;
  onCustomerClick?: (customerId: string) => void;
}) {
  const grandTotal = AGING_BUCKETS.reduce((s, b) => s + totals[b], 0);

  return (
    <Card title="Accounts Receivable Aging" subtitle="Outstanding balances bucketed by how overdue they are, per customer.">
      <div className="mb-5 flex h-8 w-full overflow-hidden rounded-lg">
        {AGING_BUCKETS.map((b) =>
          totals[b] > 0 ? (
            <div
              key={b}
              className={`${BUCKET_COLOR[b]} flex items-center justify-center text-[10px] font-semibold text-white`}
              style={{ width: `${(totals[b] / Math.max(1, grandTotal)) * 100}%` }}
              title={`${b}: ${currency(totals[b])}`}
            >
              {totals[b] / grandTotal > 0.08 ? compactCurrency(totals[b]) : ""}
            </div>
          ) : null
        )}
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {AGING_BUCKETS.map((b) => (
          <div key={b} className="rounded-xl border border-slate-200 p-3 text-center">
            <span className={`mx-auto mb-1.5 block h-1.5 w-8 rounded-full ${BUCKET_COLOR[b]}`} />
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{b}</p>
            <p className="mt-1 text-sm font-bold text-slate-900">{compactCurrency(totals[b])}</p>
          </div>
        ))}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left">
              <th className="px-3 py-2 font-semibold text-slate-600">Customer</th>
              {AGING_BUCKETS.map((b) => (
                <th key={b} className="px-3 py-2 text-right font-semibold text-slate-600">{b}</th>
              ))}
              <th className="px-3 py-2 text-right font-semibold text-slate-600">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={AGING_BUCKETS.length + 2} className="px-3 py-8 text-center text-slate-400">
                  No outstanding receivables.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr
                  key={r.customer_id}
                  onClick={() => onCustomerClick?.(r.customer_id)}
                  className={`border-b border-slate-100 last:border-0 ${onCustomerClick ? "cursor-pointer hover:bg-slate-50" : ""}`}
                >
                  <td className="px-3 py-2 font-medium text-slate-800">{r.customer_name}</td>
                  {AGING_BUCKETS.map((b) => (
                    <td key={b} className="px-3 py-2 text-right text-slate-600">
                      {r.buckets[b] > 0 ? currency(r.buckets[b]) : "–"}
                    </td>
                  ))}
                  <td className="px-3 py-2 text-right font-semibold text-slate-900">{currency(r.total)}</td>
                </tr>
              ))
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="bg-slate-50">
                <td className="px-3 py-2 font-semibold text-slate-900">Grand Total</td>
                {AGING_BUCKETS.map((b) => (
                  <td key={b} className="px-3 py-2 text-right font-semibold text-slate-900">{currency(totals[b])}</td>
                ))}
                <td className="px-3 py-2 text-right font-semibold text-slate-900">{currency(grandTotal)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </Card>
  );
}
