"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isConfigured, supabase } from "@/lib/supabase";
import { NotConfigured } from "@/components/NotConfigured";
import { KpiCard } from "@/components/KpiCard";
import type { Customer, Invoice, Receipt, ReceiptAllocation } from "@/lib/types";

type FollowUp = "urgent" | "watch" | "ok";

interface CustomerAgeing {
  id: string;
  code: string;
  name: string;
  notDue: number;
  d0_15: number;
  d15_30: number;
  d30_45: number;
  d45plus: number;
  total: number;
  lastPayment: string | null;
  overdueAmount: number;
  weightedDaysSum: number;
  followUp: FollowUp;
}

type SortKey =
  | "customer"
  | "total"
  | "notDue"
  | "d0_15"
  | "d15_30"
  | "d30_45"
  | "d45plus"
  | "lastPayment"
  | "followUp";

type StatusFilter = "all" | FollowUp;

const EMPTY_BUCKETS = { notDue: 0, d0_15: 0, d15_30: 0, d30_45: 0, d45plus: 0, total: 0 };
const FOLLOWUP_RANK: Record<FollowUp, number> = { ok: 0, watch: 1, urgent: 2 };
const FOLLOWUP_LABEL: Record<FollowUp, string> = { urgent: "Urgent", watch: "Watch", ok: "OK" };
const FOLLOWUP_BADGE: Record<FollowUp, string> = {
  urgent: "bg-red-100 text-red-700",
  watch: "bg-amber-100 text-amber-700",
  ok: "bg-gray-100 text-gray-600",
};

function deriveFollowUp(r: Omit<CustomerAgeing, "followUp">): FollowUp {
  if (r.d45plus > 0) return "urgent";
  if (r.d30_45 > 0 || r.d15_30 > 0) return "watch";
  return "ok";
}

function computeAgeing(
  customers: Customer[],
  invoices: Invoice[],
  allocations: ReceiptAllocation[],
  receipts: Receipt[],
  asOnISO: string
): CustomerAgeing[] {
  const asOn = new Date(`${asOnISO}T00:00:00`);

  const allocatedByInvoice = new Map<string, number>();
  for (const a of allocations) {
    allocatedByInvoice.set(a.invoice_id, (allocatedByInvoice.get(a.invoice_id) ?? 0) + a.amount);
  }

  const lastPaymentByCustomer = new Map<string, string>();
  for (const r of receipts) {
    const prev = lastPaymentByCustomer.get(r.customer_id);
    if (!prev || r.receipt_date > prev) lastPaymentByCustomer.set(r.customer_id, r.receipt_date);
  }

  const byCustomer = new Map<string, Omit<CustomerAgeing, "followUp">>();
  for (const c of customers) {
    byCustomer.set(c.id, {
      id: c.id,
      code: c.code,
      name: c.name,
      ...EMPTY_BUCKETS,
      lastPayment: lastPaymentByCustomer.get(c.id) ?? null,
      overdueAmount: 0,
      weightedDaysSum: 0,
    });
  }

  for (const inv of invoices) {
    const outstanding = inv.total - (allocatedByInvoice.get(inv.id) ?? 0);
    if (outstanding <= 0.005) continue;

    const row = byCustomer.get(inv.customer_id);
    if (!row) continue;

    const due = new Date(`${inv.due_date}T00:00:00`);
    const daysOverdue = Math.floor((asOn.getTime() - due.getTime()) / 86400000);
    const bucket =
      daysOverdue <= 0 ? "notDue" : daysOverdue <= 15 ? "d0_15" : daysOverdue <= 30 ? "d15_30" : daysOverdue <= 45 ? "d30_45" : "d45plus";

    row[bucket] += outstanding;
    row.total += outstanding;
    if (daysOverdue > 0) {
      row.overdueAmount += outstanding;
      row.weightedDaysSum += outstanding * daysOverdue;
    }
  }

  return Array.from(byCustomer.values()).map((r) => ({ ...r, followUp: deriveFollowUp(r) }));
}

function reduceTotals(rows: CustomerAgeing[]) {
  return rows.reduce(
    (acc, r) => ({
      notDue: acc.notDue + r.notDue,
      d0_15: acc.d0_15 + r.d0_15,
      d15_30: acc.d15_30 + r.d15_30,
      d30_45: acc.d30_45 + r.d30_45,
      d45plus: acc.d45plus + r.d45plus,
      total: acc.total + r.total,
    }),
    { ...EMPTY_BUCKETS }
  );
}

function compareRows(a: CustomerAgeing, b: CustomerAgeing, key: SortKey, dir: "asc" | "desc") {
  let cmp = 0;
  if (key === "customer") cmp = a.name.localeCompare(b.name);
  else if (key === "lastPayment") cmp = (a.lastPayment ?? "").localeCompare(b.lastPayment ?? "");
  else if (key === "followUp") cmp = FOLLOWUP_RANK[a.followUp] - FOLLOWUP_RANK[b.followUp];
  else cmp = (a[key] as number) - (b[key] as number);
  return dir === "asc" ? cmp : -cmp;
}

function money(n: number) {
  return n === 0 ? "—" : `₹${Math.round(n).toLocaleString("en-IN")}`;
}

function formatDate(iso: string) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function exportCsv(rows: CustomerAgeing[], totals: ReturnType<typeof reduceTotals>, asOnDate: string) {
  const escape = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const headers = [
    "Customer",
    "Code",
    "Total Outstanding",
    "Not Due",
    "0-15 Days",
    "15-30 Days",
    "30-45 Days",
    "45+ Days",
    "Last Payment",
    "Follow-up",
  ];
  const lines = [headers.join(",")];
  for (const r of rows) {
    lines.push(
      [r.name, r.code, r.total, r.notDue, r.d0_15, r.d15_30, r.d30_45, r.d45plus, r.lastPayment ?? "", FOLLOWUP_LABEL[r.followUp]]
        .map(escape)
        .join(",")
    );
  }
  lines.push(
    ["Totals", "", totals.total, totals.notDue, totals.d0_15, totals.d15_30, totals.d30_45, totals.d45plus, "", ""]
      .map(escape)
      .join(",")
  );
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `ar-ageing-${asOnDate}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function FollowUpBadge({ status }: { status: FollowUp }) {
  return (
    <span className={`inline-block rounded-full px-2.5 py-1 text-xs font-medium ${FOLLOWUP_BADGE[status]}`}>
      {FOLLOWUP_LABEL[status]}
    </span>
  );
}

function BucketCell({ value, tone }: { value: number; tone: "notDue" | "d0_15" | "d15_30" | "d30_45" | "d45plus" }) {
  if (tone === "d45plus") {
    return (
      <td className={`px-4 py-3 text-right tabular-nums ${value > 0 ? "bg-red-100 font-bold text-red-700" : "bg-red-50 text-red-300"}`}>
        <span className="inline-flex items-center justify-end gap-1">
          {value > 0 && (
            <span aria-hidden title="Needs urgent follow-up">
              ⚠
            </span>
          )}
          {money(value)}
        </span>
      </td>
    );
  }
  const bg = { notDue: "bg-blue-50/60", d0_15: "bg-green-50", d15_30: "bg-yellow-50", d30_45: "bg-orange-50" }[tone];
  return <td className={`px-4 py-3 text-right tabular-nums ${bg}`}>{money(value)}</td>;
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-slate-300" aria-hidden>
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M3 7.5 12 3l9 4.5M3 7.5v9L12 21m-9-4.5L12 21m0 0 9-4.5m-9 4.5v-9m9 4.5v-9M3 7.5 12 12m9-4.5L12 12"
        />
      </svg>
      <p className="text-sm font-medium text-slate-500">{message}</p>
    </div>
  );
}

function SkeletonPanel() {
  return (
    <div className="animate-pulse divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-4">
          <div className="h-4 w-36 rounded bg-slate-200" />
          <div className="ml-auto h-4 w-16 rounded bg-slate-200" />
          <div className="h-4 w-16 rounded bg-slate-200" />
          <div className="h-4 w-16 rounded bg-slate-200" />
          <div className="h-4 w-16 rounded bg-slate-200" />
          <div className="h-4 w-16 rounded bg-slate-200" />
        </div>
      ))}
    </div>
  );
}

export default function AgeingReportPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [allocations, setAllocations] = useState<ReceiptAllocation[]>([]);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [asOnDate, setAsOnDate] = useState<string>(() => todayISO());
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("total");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const fetchAll = useCallback(async (initial: boolean) => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    if (initial) setLoading(true);
    else setRefreshing(true);
    setError(null);

    const [
      { data: customerData, error: e1 },
      { data: invoiceData, error: e2 },
      { data: allocationData, error: e3 },
      { data: receiptData, error: e4 },
    ] = await Promise.all([
      supabase.from("customers").select("*").order("code"),
      supabase.from("invoices").select("*"),
      supabase.from("receipt_allocations").select("*"),
      supabase.from("receipts").select("*"),
    ]);

    const err = e1 ?? e2 ?? e3 ?? e4;
    if (err) {
      setError(err.message);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    setCustomers((customerData ?? []) as Customer[]);
    setInvoices((invoiceData ?? []) as Invoice[]);
    setAllocations((allocationData ?? []) as ReceiptAllocation[]);
    setReceipts((receiptData ?? []) as Receipt[]);
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    fetchAll(true);
  }, [fetchAll]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "/") return;
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      e.preventDefault();
      searchRef.current?.focus();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const ageingRows = useMemo(
    () => computeAgeing(customers, invoices, allocations, receipts, asOnDate),
    [customers, invoices, allocations, receipts, asOnDate]
  );

  const worstOffenderIds = useMemo(() => {
    const worst = ageingRows
      .filter((r) => r.d45plus > 0)
      .sort((a, b) => b.d45plus - a.d45plus)
      .slice(0, 10);
    return new Set(worst.map((r) => r.id));
  }, [ageingRows]);

  const displayRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = ageingRows.filter((r) => {
      if (q && !r.name.toLowerCase().includes(q) && !r.code.toLowerCase().includes(q)) return false;
      if (statusFilter !== "all" && r.followUp !== statusFilter) return false;
      return true;
    });
    return [...filtered].sort((a, b) => compareRows(a, b, sortKey, sortDir));
  }, [ageingRows, search, statusFilter, sortKey, sortDir]);

  const globalTotals = useMemo(() => reduceTotals(ageingRows), [ageingRows]);
  const tableTotals = useMemo(() => reduceTotals(displayRows), [displayRows]);

  const collectionPct = useMemo(() => {
    const totalInvoiced = invoices.reduce((s, i) => s + i.total, 0);
    const totalCollected = receipts.reduce((s, r) => s + r.amount, 0);
    return totalInvoiced > 0 ? (totalCollected / totalInvoiced) * 100 : 0;
  }, [invoices, receipts]);

  const avgAge = useMemo(() => {
    const totalOverdue = ageingRows.reduce((s, r) => s + r.overdueAmount, 0);
    const weighted = ageingRows.reduce((s, r) => s + r.weightedDaysSum, 0);
    return totalOverdue > 0 ? weighted / totalOverdue : 0;
  }, [ageingRows]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "customer" ? "asc" : "desc");
    }
  }

  function copyName(row: CustomerAgeing) {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(row.name).catch(() => {});
    }
    setCopiedId(row.id);
    window.setTimeout(() => setCopiedId((id) => (id === row.id ? null : id)), 1200);
  }

  function SortableTh({
    label,
    sortKeyName,
    tooltip,
    align = "right",
    stickyLeft = false,
  }: {
    label: string;
    sortKeyName: SortKey;
    tooltip: string;
    align?: "left" | "right";
    stickyLeft?: boolean;
  }) {
    const active = sortKey === sortKeyName;
    return (
      <th
        scope="col"
        aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
        className={`bg-blue-50 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-600 ${
          align === "right" ? "text-right" : "text-left"
        } ${stickyLeft ? "sticky left-0 z-30" : ""}`}
      >
        <button
          type="button"
          onClick={() => toggleSort(sortKeyName)}
          title={tooltip}
          className={`inline-flex items-center gap-1 hover:text-brand ${align === "right" ? "flex-row-reverse" : ""}`}
        >
          {label}
          <span className={`text-[10px] ${active ? "text-brand" : "text-slate-300"}`} aria-hidden>
            {active && sortDir === "asc" ? "▲" : "▼"}
          </span>
        </button>
      </th>
    );
  }

  const emptyMessage = search || statusFilter !== "all" ? "No customers match your filters." : "No customers found.";

  return (
    <div className="font-sans">
      <div className="mb-6">
        <h1 className="text-[28px] font-bold leading-tight text-slate-900">Accounts Receivable Ageing Report</h1>
        <p className="mt-1 text-sm text-slate-500">
          One row per customer, sorted so the ones who need a call today rise to the top.
        </p>
      </div>

      {!isConfigured && (
        <div className="mb-6">
          <NotConfigured />
        </div>
      )}

      {isConfigured && (
        <>
          <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <KpiCard label="Outstanding" value={money(globalTotals.total)} />
            <KpiCard label="Customers" value={String(ageingRows.length)} />
            <KpiCard label="Report Date" value={formatDate(asOnDate)} />
          </div>

          <div className="no-print mb-6 flex flex-wrap items-end gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="min-w-[220px] flex-1">
              <label className="block text-xs font-medium text-slate-500" htmlFor="ar-search">
                Search customer
              </label>
              <input
                id="ar-search"
                ref={searchRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Name or code… (press / to focus)"
                className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500" htmlFor="ar-status">
                Status
              </label>
              <select
                id="ar-status"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
                className="mt-1 rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
              >
                <option value="all">All</option>
                <option value="urgent">Urgent (45+)</option>
                <option value="watch">Watch (15–45)</option>
                <option value="ok">OK</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500" htmlFor="ar-as-on">
                As on date
              </label>
              <input
                id="ar-as-on"
                type="date"
                value={asOnDate}
                onChange={(e) => setAsOnDate(e.target.value)}
                className="mt-1 rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
              />
            </div>
            <button
              type="button"
              onClick={() => fetchAll(false)}
              disabled={refreshing}
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              {refreshing ? "Refreshing…" : "Refresh"}
            </button>
            <div className="ml-auto flex gap-2">
              <button
                type="button"
                onClick={() => exportCsv(displayRows, tableTotals, asOnDate)}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Export Excel
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark"
              >
                Print
              </button>
            </div>
          </div>

          {isConfigured && error && (
            <div className="mb-6 rounded-xl border border-red-300 bg-red-50 p-6 text-red-800">
              <p className="font-semibold">Couldn&apos;t load the ageing report.</p>
              <p className="mt-1 text-sm">{error}</p>
            </div>
          )}

          {!error && (
            <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
              <KpiCard label="Outstanding" value={money(globalTotals.total)} />
              <KpiCard label="Not Due" value={money(globalTotals.notDue)} />
              <KpiCard label="Current" value={money(globalTotals.notDue + globalTotals.d0_15)} />
              <KpiCard label="Over 30 Days" value={money(globalTotals.d30_45 + globalTotals.d45plus)} tone="danger" />
              <KpiCard label="Over 45 Days" value={money(globalTotals.d45plus)} tone="danger" />
              <KpiCard label="Collection %" value={`${collectionPct.toFixed(1)}%`} tone="success" />
              <KpiCard label="Average Age" value={avgAge > 0 ? `${Math.round(avgAge)} days` : "—"} />
            </div>
          )}

          {loading && <SkeletonPanel />}

          {!loading && !error && (
            <>
              {/* Desktop / tablet table */}
              <div className="hidden md:block">
                <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
                  <div className="print-scroll max-h-[65vh] overflow-y-auto">
                    <table className="w-full border-collapse text-sm">
                      <thead className="sticky top-0 z-20">
                        <tr>
                          <SortableTh label="Customer" sortKeyName="customer" tooltip="Click to sort by name" align="left" stickyLeft />
                          <SortableTh label="Total Outstanding" sortKeyName="total" tooltip="Invoice total minus all receipts applied" />
                          <SortableTh label="Not Due" sortKeyName="notDue" tooltip="Due date hasn't arrived yet" />
                          <SortableTh label="0–15 Days" sortKeyName="d0_15" tooltip="1–15 days past the due date" />
                          <SortableTh label="15–30 Days" sortKeyName="d15_30" tooltip="16–30 days past the due date" />
                          <SortableTh label="30–45 Days" sortKeyName="d30_45" tooltip="31–45 days past the due date" />
                          <SortableTh label="45+ Days" sortKeyName="d45plus" tooltip="Over 45 days late — needs urgent follow-up" />
                          <SortableTh label="Last Payment" sortKeyName="lastPayment" tooltip="Date of this customer's most recent receipt" />
                          <SortableTh label="Follow-up" sortKeyName="followUp" tooltip="Derived from how overdue the balance is" align="left" />
                        </tr>
                      </thead>
                      <tbody>
                        {displayRows.length === 0 ? (
                          <tr>
                            <td colSpan={9}>
                              <EmptyState message={emptyMessage} />
                            </td>
                          </tr>
                        ) : (
                          displayRows.map((r, idx) => {
                            const zebra = idx % 2 === 1 ? "bg-slate-50/60" : "bg-white";
                            const isWorst = worstOffenderIds.has(r.id);
                            return (
                              <tr
                                key={r.id}
                                className={`group border-b border-gray-100 last:border-0 hover:bg-blue-50/40 ${zebra} ${
                                  isWorst ? "border-l-4 border-l-red-500" : ""
                                }`}
                              >
                                <td className={`sticky left-0 z-10 whitespace-nowrap px-4 py-3 font-semibold text-slate-900 ${zebra} group-hover:bg-blue-50/40`}>
                                  <button
                                    type="button"
                                    onClick={() => copyName(r)}
                                    title="Click to copy customer name"
                                    className="inline-flex items-center gap-1.5 text-left hover:underline"
                                  >
                                    {isWorst && <span className="h-1.5 w-1.5 flex-none rounded-full bg-red-500" aria-hidden />}
                                    {r.name}
                                  </button>
                                  {copiedId === r.id && <span className="ml-2 text-xs text-emerald-600">Copied</span>}
                                </td>
                                <td className="px-4 py-3 text-right font-semibold tabular-nums text-slate-900">{money(r.total)}</td>
                                <BucketCell value={r.notDue} tone="notDue" />
                                <BucketCell value={r.d0_15} tone="d0_15" />
                                <BucketCell value={r.d15_30} tone="d15_30" />
                                <BucketCell value={r.d30_45} tone="d30_45" />
                                <BucketCell value={r.d45plus} tone="d45plus" />
                                <td className="px-4 py-3 text-right text-slate-600">
                                  {r.lastPayment ? formatDate(r.lastPayment) : "—"}
                                </td>
                                <td className="px-4 py-3">
                                  <FollowUpBadge status={r.followUp} />
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                      {displayRows.length > 0 && (
                        <tfoot className="sticky bottom-0 z-20 bg-blue-100 font-semibold text-slate-900">
                          <tr>
                            <td className="sticky left-0 z-30 whitespace-nowrap bg-blue-100 px-4 py-3">
                              Totals ({displayRows.length})
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums">{money(tableTotals.total)}</td>
                            <td className="px-4 py-3 text-right tabular-nums">{money(tableTotals.notDue)}</td>
                            <td className="px-4 py-3 text-right tabular-nums">{money(tableTotals.d0_15)}</td>
                            <td className="px-4 py-3 text-right tabular-nums">{money(tableTotals.d15_30)}</td>
                            <td className="px-4 py-3 text-right tabular-nums">{money(tableTotals.d30_45)}</td>
                            <td className="px-4 py-3 text-right tabular-nums text-red-700">{money(tableTotals.d45plus)}</td>
                            <td colSpan={2} className="px-4 py-3" />
                          </tr>
                        </tfoot>
                      )}
                    </table>
                  </div>
                </div>
              </div>

              {/* Mobile card layout */}
              <div className="grid gap-3 md:hidden">
                {displayRows.length === 0 ? (
                  <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
                    <EmptyState message={emptyMessage} />
                  </div>
                ) : (
                  <>
                    {displayRows.map((r) => {
                      const isWorst = worstOffenderIds.has(r.id);
                      return (
                        <div
                          key={r.id}
                          className={`rounded-xl border border-gray-200 bg-white p-4 shadow-sm ${isWorst ? "border-l-4 border-l-red-500" : ""}`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <button
                              type="button"
                              onClick={() => copyName(r)}
                              className="inline-flex items-center gap-1.5 text-left font-semibold text-slate-900"
                            >
                              {isWorst && <span className="h-1.5 w-1.5 flex-none rounded-full bg-red-500" aria-hidden />}
                              {r.name}
                            </button>
                            <FollowUpBadge status={r.followUp} />
                          </div>
                          <p className="mt-1 text-xs text-slate-400">
                            {r.code} · Last payment {r.lastPayment ? formatDate(r.lastPayment) : "—"}
                            {copiedId === r.id && <span className="ml-2 text-emerald-600">Copied</span>}
                          </p>
                          <div className="mt-3 flex items-baseline justify-between border-t border-gray-100 pt-3">
                            <span className="text-xs text-slate-500">Outstanding</span>
                            <span className="text-lg font-semibold tabular-nums text-slate-900">{money(r.total)}</span>
                          </div>
                          <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                            <div className="rounded-lg bg-blue-50/60 px-2 py-1.5">
                              <p className="text-slate-500">Not due</p>
                              <p className="font-medium tabular-nums text-slate-800">{money(r.notDue)}</p>
                            </div>
                            <div className="rounded-lg bg-green-50 px-2 py-1.5">
                              <p className="text-slate-500">0–15d</p>
                              <p className="font-medium tabular-nums text-slate-800">{money(r.d0_15)}</p>
                            </div>
                            <div className="rounded-lg bg-yellow-50 px-2 py-1.5">
                              <p className="text-slate-500">15–30d</p>
                              <p className="font-medium tabular-nums text-slate-800">{money(r.d15_30)}</p>
                            </div>
                            <div className="rounded-lg bg-orange-50 px-2 py-1.5">
                              <p className="text-slate-500">30–45d</p>
                              <p className="font-medium tabular-nums text-slate-800">{money(r.d30_45)}</p>
                            </div>
                            <div
                              className={`col-span-2 rounded-lg px-2 py-1.5 ${
                                r.d45plus > 0 ? "bg-red-100 font-bold text-red-700" : "bg-red-50 text-red-300"
                              }`}
                            >
                              <p className="text-slate-500">45+ days</p>
                              <p className="tabular-nums">{money(r.d45plus)}</p>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    <div className="rounded-xl border border-gray-200 bg-blue-100 p-4 font-semibold text-slate-900 shadow-sm">
                      <div className="flex items-center justify-between">
                        <span>Totals ({displayRows.length})</span>
                        <span className="tabular-nums">{money(tableTotals.total)}</span>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
