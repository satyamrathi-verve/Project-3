"use client";

import { useMemo, useState } from "react";
import { inputClass } from "@/components/FormField";
import type { AdjustmentRow, AuditEntry } from "@/lib/cashflow";
import { currency } from "@/lib/cashflow";
import { Badge, Card, EmptyState, riskTone, statusTone } from "./ui";

type SortKey = "due_date" | "outstanding" | "probability" | "customer_name";

const PAGE_SIZE = 10;

export function AdjustmentTable({
  rows,
  onFieldChange,
  audit,
}: {
  rows: AdjustmentRow[];
  onFieldChange: (id: string, field: keyof AdjustmentRow, value: string) => void;
  audit: AuditEntry[];
}) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("due_date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(0);
  const [showAudit, setShowAudit] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q ? rows.filter((r) => r.invoice_no.toLowerCase().includes(q) || r.customer_name.toLowerCase().includes(q)) : rows;
    const sorted = [...list].sort((a, b) => {
      const dir = sortDir === "asc" ? 1 : -1;
      if (sortKey === "customer_name") return a.customer_name.localeCompare(b.customer_name) * dir;
      return (a[sortKey] > b[sortKey] ? 1 : a[sortKey] < b[sortKey] ? -1 : 0) * dir;
    });
    return sorted;
  }, [rows, search, sortKey, sortDir]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const clampedPage = Math.min(page, pageCount - 1);
  const pageRows = filtered.slice(clampedPage * PAGE_SIZE, clampedPage * PAGE_SIZE + PAGE_SIZE);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  function Th({ label, sortableKey }: { label: string; sortableKey?: SortKey }) {
    const active = sortableKey && sortKey === sortableKey;
    return (
      <th
        className={`px-3 py-2 font-semibold text-slate-600 ${sortableKey ? "cursor-pointer select-none hover:text-slate-900" : ""}`}
        onClick={() => sortableKey && toggleSort(sortableKey)}
      >
        {label}
        {active && (sortDir === "asc" ? " ▲" : " ▼")}
      </th>
    );
  }

  return (
    <Card
      title="Invoice Adjustments"
      subtitle="Every open invoice. Expected amount/date feed the forecast; follow-up, collector and remarks are session notes (not saved to the database)."
      action={
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="Search invoice or customer…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
            className={`${inputClass} w-56 py-1.5 text-xs`}
          />
          <button type="button" onClick={() => setShowAudit((v) => !v)} className="whitespace-nowrap rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-cream-dim">
            {showAudit ? "Hide" : "Show"} Audit Log ({audit.length})
          </button>
        </div>
      }
    >
      {showAudit && (
        <div className="mb-4 max-h-40 overflow-y-auto rounded-lg border border-slate-200 bg-cream-dim p-3 text-xs">
          {audit.length === 0 ? (
            <p className="text-slate-400">No edits made this session yet.</p>
          ) : (
            <ul className="space-y-1">
              {[...audit].reverse().map((a) => (
                <li key={a.id} className="text-slate-600">
                  <span className="font-medium text-slate-800">{a.invoice_no}</span> — {a.field} changed from{" "}
                  <span className="text-slate-500">&quot;{a.oldValue}&quot;</span> to <span className="text-slate-700">&quot;{a.newValue}&quot;</span>
                  <span className="ml-2 text-slate-400">{a.timestamp}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {rows.length === 0 ? (
        <EmptyState title="No open invoices" note="Everything is fully collected." />
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-cream-dim text-left">
                  <Th label="Invoice" />
                  <Th label="Customer" sortableKey="customer_name" />
                  <th className="px-3 py-2 font-semibold text-slate-600">Status</th>
                  <th className="px-3 py-2 font-semibold text-slate-600">Risk</th>
                  <Th label="Due Date" sortableKey="due_date" />
                  <Th label="Outstanding" sortableKey="outstanding" />
                  <Th label="Probability" sortableKey="probability" />
                  <th className="px-3 py-2 font-semibold text-slate-600">Expected Amount</th>
                  <th className="px-3 py-2 font-semibold text-slate-600">Expected Date</th>
                  <th className="px-3 py-2 font-semibold text-slate-600">Follow-up</th>
                  <th className="px-3 py-2 font-semibold text-slate-600">Collector</th>
                  <th className="px-3 py-2 font-semibold text-slate-600">Remarks</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r) => (
                  <tr key={r.id} className="border-b border-slate-100 last:border-0 hover:bg-cream-dim">
                    <td className="px-3 py-2 font-medium text-slate-800">{r.invoice_no}</td>
                    <td className="px-3 py-2 text-slate-700">{r.customer_name}</td>
                    <td className="px-3 py-2"><Badge tone={statusTone(r.status)}>{r.status}</Badge></td>
                    <td className="px-3 py-2"><Badge tone={riskTone(r.riskLevel)}>{r.riskLevel}</Badge></td>
                    <td className="px-3 py-2 text-slate-600">{r.due_date}</td>
                    <td className="px-3 py-2 font-medium text-slate-900">{currency(r.outstanding)}</td>
                    <td className="px-3 py-2">
                      <span className={`font-semibold ${r.probability >= 70 ? "text-emerald-600" : r.probability >= 40 ? "text-orange-500" : "text-red-600"}`}>
                        {r.probability}%
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        value={r.expectedAmount}
                        onChange={(e) => onFieldChange(r.id, "expectedAmount", e.target.value)}
                        className={`${inputClass} w-24 py-1 text-xs`}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="date"
                        value={r.expectedDate}
                        onChange={(e) => onFieldChange(r.id, "expectedDate", e.target.value)}
                        className={`${inputClass} w-36 py-1 text-xs`}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="date"
                        value={r.followUpDate}
                        onChange={(e) => onFieldChange(r.id, "followUpDate", e.target.value)}
                        className={`${inputClass} w-36 py-1 text-xs`}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="text"
                        placeholder="Unassigned"
                        value={r.collector}
                        onChange={(e) => onFieldChange(r.id, "collector", e.target.value)}
                        className={`${inputClass} w-28 py-1 text-xs`}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="text"
                        placeholder="—"
                        value={r.remarks}
                        onChange={(e) => onFieldChange(r.id, "remarks", e.target.value)}
                        className={`${inputClass} w-32 py-1 text-xs`}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
            <span>
              Showing {pageRows.length === 0 ? 0 : clampedPage * PAGE_SIZE + 1}–{clampedPage * PAGE_SIZE + pageRows.length} of {filtered.length}
            </span>
            <div className="flex gap-1">
              <button type="button" disabled={clampedPage === 0} onClick={() => setPage((p) => p - 1)} className="rounded-md border border-slate-200 px-2 py-1 disabled:opacity-40">
                Prev
              </button>
              <span className="px-2 py-1">{clampedPage + 1} / {pageCount}</span>
              <button type="button" disabled={clampedPage >= pageCount - 1} onClick={() => setPage((p) => p + 1)} className="rounded-md border border-slate-200 px-2 py-1 disabled:opacity-40">
                Next
              </button>
            </div>
          </div>
        </>
      )}
    </Card>
  );
}
