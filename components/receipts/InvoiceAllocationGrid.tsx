"use client";

import { useMemo, useState } from "react";
import type { Invoice } from "@/lib/types";
import { ageInDays, money, todayStr } from "@/lib/format";
import { inputClass } from "@/components/FormField";
import { TableSkeleton } from "@/components/Skeleton";

export type InvoiceRow = {
  invoice: Invoice;
  outstandingExcl: number;
};

type SortKey = "invoice_no" | "invoice_date" | "due_date" | "age" | "total" | "outstanding";

function isOverdue(row: InvoiceRow) {
  return row.invoice.due_date < todayStr() && row.outstandingExcl > 0.005;
}

export function InvoiceAllocationGrid({
  rows,
  allocations,
  onChangeAllocation,
  onAllocateFull,
  onClear,
  onAutoAllocate,
  loading,
}: {
  rows: InvoiceRow[];
  allocations: Record<string, string>;
  onChangeAllocation: (invoiceId: string, value: string) => void;
  onAllocateFull: (invoiceId: string) => void;
  onClear: (invoiceId: string) => void;
  onAutoAllocate: () => void;
  loading: boolean;
}) {
  const [search, setSearch] = useState("");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("due_date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  const visibleRows = useMemo(() => {
    let list = rows;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((r) => r.invoice.invoice_no.toLowerCase().includes(q));
    }
    if (overdueOnly) list = list.filter(isOverdue);

    const dir = sortDir === "asc" ? 1 : -1;
    return [...list].sort((a, b) => {
      switch (sortKey) {
        case "invoice_no":
          return a.invoice.invoice_no.localeCompare(b.invoice.invoice_no) * dir;
        case "invoice_date":
          return a.invoice.invoice_date.localeCompare(b.invoice.invoice_date) * dir;
        case "due_date":
          return a.invoice.due_date.localeCompare(b.invoice.due_date) * dir;
        case "age":
          return (ageInDays(a.invoice.due_date) - ageInDays(b.invoice.due_date)) * dir;
        case "total":
          return (a.invoice.total - b.invoice.total) * dir;
        case "outstanding":
          return (a.outstandingExcl - b.outstandingExcl) * dir;
        default:
          return 0;
      }
    });
  }, [rows, search, overdueOnly, sortKey, sortDir]);

  function SortHeader({ label, k, className = "" }: { label: string; k: SortKey; className?: string }) {
    const active = sortKey === k;
    return (
      <th className={`px-3 py-2 font-semibold text-slate-600 ${className}`}>
        <button
          type="button"
          onClick={() => toggleSort(k)}
          className={`inline-flex items-center gap-1 hover:text-slate-800 ${active ? "text-brand" : ""}`}
        >
          {label}
          {active && <span className="text-[10px]">{sortDir === "asc" ? "▲" : "▼"}</span>}
        </button>
      </th>
    );
  }

  if (loading) return <TableSkeleton rows={3} cols={7} />;

  if (rows.length === 0) {
    return (
      <p className="rounded-lg bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
        No outstanding invoices for this customer — this receipt will be recorded as fully unapplied.
      </p>
    );
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <input
          className={`${inputClass} max-w-xs`}
          placeholder="Search invoice no…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <label className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
          <input type="checkbox" checked={overdueOnly} onChange={(e) => setOverdueOnly(e.target.checked)} />
          Overdue only
        </label>
        <div className="ml-auto">
          <button type="button" onClick={onAutoAllocate} className="text-xs font-medium text-brand hover:underline">
            Allocate automatically (oldest due first)
          </button>
        </div>
      </div>

      {visibleRows.length === 0 ? (
        <p className="rounded-lg bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">No invoices match this filter.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full min-w-[800px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left">
                <th className="px-3 py-2 font-semibold text-slate-600">Select</th>
                <SortHeader label="Invoice" k="invoice_no" />
                <SortHeader label="Invoice Date" k="invoice_date" />
                <SortHeader label="Due Date" k="due_date" />
                <SortHeader label="Age" k="age" className="text-right" />
                <SortHeader label="Amount" k="total" className="text-right" />
                <SortHeader label="Outstanding" k="outstanding" className="text-right" />
                <th className="px-3 py-2 text-right font-semibold text-slate-600">Amount Applied</th>
                <th className="px-3 py-2 text-right font-semibold text-slate-600">Balance</th>
                <th className="px-3 py-2 font-semibold text-slate-600" />
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => {
                const allocValue = allocations[row.invoice.id] ?? "";
                const allocNum = Number(allocValue) || 0;
                const exceeds = allocNum > row.outstandingExcl + 0.005;
                const balance = Math.max(row.outstandingExcl - allocNum, 0);
                const overdue = isOverdue(row);
                const age = ageInDays(row.invoice.due_date);

                return (
                  <tr
                    key={row.invoice.id}
                    className={`border-b border-slate-100 last:border-0 ${overdue ? "bg-red-50/60" : ""}`}
                  >
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={allocNum > 0.005}
                        onChange={(e) => (e.target.checked ? onAllocateFull(row.invoice.id) : onClear(row.invoice.id))}
                        aria-label={`Select ${row.invoice.invoice_no}`}
                      />
                    </td>
                    <td className="px-3 py-2 font-medium text-slate-700">{row.invoice.invoice_no}</td>
                    <td className="px-3 py-2 text-slate-500">{row.invoice.invoice_date}</td>
                    <td className="px-3 py-2 text-slate-500">{row.invoice.due_date}</td>
                    <td className={`px-3 py-2 text-right ${overdue ? "font-semibold text-red-600" : "text-slate-500"}`}>
                      {overdue ? `${age}d` : "—"}
                    </td>
                    <td className="px-3 py-2 text-right text-slate-700">{money(row.invoice.total)}</td>
                    <td className="px-3 py-2 text-right text-slate-700">{money(row.outstandingExcl)}</td>
                    <td className="px-3 py-2 text-right">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        className={`${inputClass} w-28 text-right ${exceeds ? "border-red-400 text-red-600" : ""}`}
                        value={allocValue}
                        onChange={(e) => onChangeAllocation(row.invoice.id, e.target.value)}
                        aria-invalid={exceeds}
                      />
                    </td>
                    <td className={`px-3 py-2 text-right ${balance <= 0.005 ? "font-medium text-emerald-600" : "text-slate-700"}`}>
                      {money(balance)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => onClear(row.invoice.id)}
                        className="text-xs font-medium text-slate-400 hover:text-slate-600"
                      >
                        Clear
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
