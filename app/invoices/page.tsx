"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase, isConfigured } from "@/lib/supabase";
import type { Invoice, InvoiceStatus } from "@/lib/types";
import { DataTable, type Column } from "@/components/DataTable";
import { PageHeader } from "@/components/PageHeader";
import { NotConfigured } from "@/components/NotConfigured";
import { avatarColor } from "@/lib/avatarColor";

/* What we get back from Supabase once the customers(name) join resolves. */
type InvoiceRow = Invoice & { customers: { name: string } | null };

const money = (n: number) => `₹${Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
const formatDate = (d: string) =>
  new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

const MS_PER_DAY = 86_400_000;

/* Whole days past due, compared date-only (not time-of-day) so it doesn't flicker
   depending on what hour you load the page. 0 if paid or not yet due. */
function overdueDays(inv: Invoice): number {
  if (inv.status === "paid") return 0;
  const due = new Date(inv.due_date);
  const today = new Date();
  const diff = Math.floor(
    (Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) -
      Date.UTC(due.getFullYear(), due.getMonth(), due.getDate())) /
      MS_PER_DAY,
  );
  return diff > 0 ? diff : 0;
}

/* The stored status is set once when an invoice is created and never revisited,
   so it goes stale: an open/partial invoice whose due date has since passed is
   overdue regardless of what the status column still says. Compute it instead. */
function effectiveStatus(inv: Invoice): InvoiceStatus {
  if (inv.status === "paid") return "paid";
  return overdueDays(inv) > 0 ? "overdue" : inv.status;
}

const STATUS_LABEL: Record<InvoiceStatus, string> = {
  open: "Open",
  paid: "Paid",
  overdue: "Overdue",
  partial: "Partial",
};

const STATUS_CHIP_ACTIVE: Record<InvoiceStatus, string> = {
  open: "bg-sky-600 text-white",
  paid: "bg-emerald-600 text-white",
  overdue: "bg-rose-600 text-white",
  partial: "bg-amber-600 text-white",
};

/* Tinted even when not ticked, so the filter row reads as colour-coded at a
   glance — not just after you click something. */
const STATUS_CHIP_INACTIVE: Record<InvoiceStatus, string> = {
  open: "border border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100",
  paid: "border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100",
  overdue: "border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100",
  partial: "border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100",
};

const ALL_STATUSES: InvoiceStatus[] = ["open", "partial", "paid", "overdue"];

export default function InvoiceListPage() {
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  /* invoice id -> total minus what's been allocated against it from receipts. */
  const [outstandingByInvoice, setOutstandingByInvoice] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [statusTicks, setStatusTicks] = useState<Set<InvoiceStatus>>(new Set());

  const load = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    setLoadError(null);

    const [invoicesRes, allocationsRes] = await Promise.all([
      supabase.from("invoices").select("*, customers(name)").order("invoice_date", { ascending: false }),
      supabase.from("receipt_allocations").select("invoice_id,amount"),
    ]);

    const error = invoicesRes.error ?? allocationsRes.error;
    if (error) {
      setLoadError(error.message);
      setLoading(false);
      return;
    }

    const allocatedByInvoice = new Map<string, number>();
    for (const a of allocationsRes.data ?? []) {
      allocatedByInvoice.set(a.invoice_id, (allocatedByInvoice.get(a.invoice_id) ?? 0) + Number(a.amount));
    }

    const invoicesData = (invoicesRes.data ?? []) as InvoiceRow[];
    const outstanding: Record<string, number> = {};
    for (const inv of invoicesData) {
      outstanding[inv.id] = Number(inv.total) - (allocatedByInvoice.get(inv.id) ?? 0);
    }

    setInvoices(invoicesData);
    setOutstandingByInvoice(outstanding);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function toggleStatus(s: InvoiceStatus) {
    setStatusTicks((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return invoices.filter((inv) => {
      const matchesSearch =
        !q || inv.invoice_no.toLowerCase().includes(q) || (inv.customers?.name ?? "").toLowerCase().includes(q);
      const matchesStatus = statusTicks.size === 0 || statusTicks.has(effectiveStatus(inv));
      return matchesSearch && matchesStatus;
    });
  }, [invoices, search, statusTicks]);

  const filtersActive = search.trim() !== "" || statusTicks.size > 0;

  if (!isConfigured || !supabase) return <NotConfigured />;

  const columns: Column<InvoiceRow>[] = [
    {
      key: "invoice_no",
      header: "Invoice Number",
      render: (i) => (
        <span className="inline-flex rounded-md bg-slate-100 px-2 py-0.5 font-mono text-xs font-semibold text-slate-600">
          {i.invoice_no}
        </span>
      ),
    },
    { key: "invoice_date", header: "Invoice Date", render: (i) => formatDate(i.invoice_date) },
    { key: "due_date", header: "Due Date", render: (i) => formatDate(i.due_date) },
    {
      key: "customer",
      header: "Customer Name",
      render: (i) => {
        const name = i.customers?.name ?? "—";
        return (
          <div className="flex items-center gap-2.5">
            <span
              className={`flex h-7 w-7 flex-none items-center justify-center rounded-full text-xs font-bold ${avatarColor(name)}`}
            >
              {name.charAt(0).toUpperCase()}
            </span>
            <span className="font-medium text-slate-800">{name}</span>
          </div>
        );
      },
    },
    { key: "subtotal", header: "Subtotal", render: (i) => money(i.subtotal) },
    {
      key: "total",
      header: "Total Invoice Value",
      render: (i) => <span className="font-semibold text-slate-900">{money(i.total)}</span>,
    },
    {
      key: "overdue_days",
      header: "Overdue In Days",
      render: (i) => {
        const days = overdueDays(i);
        return days > 0 ? (
          <span className="inline-flex items-center rounded-full bg-rose-100 px-2.5 py-0.5 text-xs font-semibold text-rose-700">
            {days} {days === 1 ? "day" : "days"}
          </span>
        ) : (
          <span className="text-slate-400">—</span>
        );
      },
    },
    {
      key: "outstanding",
      header: "Outstanding Amount",
      render: (i) => {
        const out = outstandingByInvoice[i.id] ?? i.total;
        return out <= 0 ? (
          <span className="text-sm font-medium text-emerald-600">Paid in full</span>
        ) : (
          <span className={`font-semibold ${overdueDays(i) > 0 ? "text-rose-600" : "text-slate-700"}`}>
            {money(out)}
          </span>
        );
      },
    },
  ];

  return (
    <>
      <PageHeader title="Sales Invoices" subtitle="Every invoice raised, and where it stands." />

      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by invoice number or customer…"
          className="w-full flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand focus:ring-1 focus:ring-brand sm:w-auto"
        />
        <div className="flex flex-wrap items-center gap-2">
          {ALL_STATUSES.map((s) => {
            const active = statusTicks.has(s);
            return (
              <button
                key={s}
                type="button"
                onClick={() => toggleStatus(s)}
                aria-pressed={active}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  active ? STATUS_CHIP_ACTIVE[s] : STATUS_CHIP_INACTIVE[s]
                }`}
              >
                {STATUS_LABEL[s]}
              </button>
            );
          })}
        </div>
        {filtersActive && (
          <button
            type="button"
            onClick={() => {
              setSearch("");
              setStatusTicks(new Set());
            }}
            className="text-xs font-medium text-brand hover:underline"
          >
            Clear filters
          </button>
        )}
      </div>

      {loading ? (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-400">
          Loading invoices…
        </div>
      ) : loadError ? (
        <div className="rounded-xl border border-rose-300 bg-rose-50 p-6 text-rose-800">
          <p className="font-semibold">Couldn&apos;t load invoices.</p>
          <p className="mt-1 text-sm">{loadError}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-3 rounded-lg border border-rose-300 px-3 py-1 text-sm font-medium hover:bg-rose-100"
          >
            Try again
          </button>
        </div>
      ) : (
        <>
          <DataTable
            columns={columns}
            rows={filtered}
            empty={
              filtersActive ? "No invoices match your search or filters." : "No invoices yet."
            }
          />
          <p className="mt-3 text-sm text-slate-500">
            Showing {filtered.length} of {invoices.length} {invoices.length === 1 ? "invoice" : "invoices"}
          </p>
        </>
      )}
    </>
  );
}
