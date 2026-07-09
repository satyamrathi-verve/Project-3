"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  IndianRupee,
  Loader2,
  Mail,
  Percent,
  Search,
  Send,
  ShieldAlert,
  X,
} from "lucide-react";
import { isConfigured, supabase } from "@/lib/supabase";
import { NotConfigured } from "@/components/NotConfigured";
import { KpiCard } from "@/components/KpiCard";
import { DataTable, type Column } from "@/components/DataTable";
import { formatCurrency, formatDate } from "@/lib/format";
import type { Customer, Invoice, ReceiptAllocation, Receipt, ReminderLog, ReminderTemplate } from "@/lib/types";

type EffectiveStatus = "open" | "partial" | "overdue" | "paid";
type StatusFilter = "all" | "open" | "partial" | "overdue";
type Tab = "invoices" | "customers";
type SendState = "idle" | "sending" | "sent" | "error";

interface InvoiceRow extends Invoice {
  customerName: string;
  customerEmail: string | null;
  outstanding: number;
  daysLate: number;
  effectiveStatus: EffectiveStatus;
}

interface CustomerSummaryRow {
  id: string;
  name: string;
  code: string;
  creditLimit: number;
  outstanding: number;
  invoiceCount: number;
  worstDaysLate: number;
  overLimit: boolean;
}

interface AgeingBucket {
  label: string;
  amount: number;
  color: string;
}

const STATUS_STYLES: Record<EffectiveStatus, string> = {
  open: "bg-blue-50 text-blue-700",
  partial: "bg-amber-50 text-amber-700",
  paid: "bg-emerald-50 text-emerald-700",
  overdue: "bg-red-50 text-red-700",
};

const DEFAULT_TEMPLATE = {
  subject: "Payment Reminder — Invoice {invoice_no}",
  body: "Dear {customer},\n\nOur records show invoice {invoice_no} for {amount} is now {days_overdue} day(s) past its due date. Please arrange payment at your earliest convenience.\n\nThank you,\nVerve Advisory Pvt Ltd",
};

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function daysLateFor(dueDateISO: string, asOnISO: string): number {
  const due = new Date(`${dueDateISO}T00:00:00`);
  const asOn = new Date(`${asOnISO}T00:00:00`);
  return Math.floor((asOn.getTime() - due.getTime()) / 86400000);
}

function fillTemplate(text: string, vars: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (_, key: string) => vars[key] ?? `{${key}}`);
}

function RiskBadge() {
  return (
    <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-700">
      <ShieldAlert className="h-3 w-3" /> Over limit
    </span>
  );
}

function AgeingBar({ buckets, total }: { buckets: AgeingBucket[]; total: number }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <p className="mb-3 text-sm font-semibold text-slate-700">Aging Summary</p>
      <div className="flex h-4 w-full overflow-hidden rounded-full bg-slate-100">
        {buckets.map((b) => {
          const pct = total > 0 ? (b.amount / total) * 100 : 0;
          if (pct <= 0) return null;
          return (
            <div
              key={b.label}
              style={{ width: `${pct}%`, backgroundColor: b.color }}
              title={`${b.label}: ${formatCurrency(b.amount)}`}
            />
          );
        })}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {buckets.map((b) => (
          <div key={b.label} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 flex-none rounded-full" style={{ backgroundColor: b.color }} />
            <div>
              <p className="text-xs text-slate-500">{b.label}</p>
              <p className="text-sm font-semibold text-slate-900">{formatCurrency(b.amount)}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SkeletonPanel() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 rounded-xl border border-slate-200 bg-white" />
        ))}
      </div>
      <div className="h-24 rounded-xl border border-slate-200 bg-white" />
      <div className="h-64 rounded-xl border border-slate-200 bg-white" />
    </div>
  );
}

export default function DashboardPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [allocations, setAllocations] = useState<ReceiptAllocation[]>([]);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [templates, setTemplates] = useState<ReminderTemplate[]>([]);
  const [reminderLogs, setReminderLogs] = useState<ReminderLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [tab, setTab] = useState<Tab>("invoices");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);
  const [sendState, setSendState] = useState<Record<string, SendState>>({});

  const fetchAll = useCallback(async () => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);

    const [
      { data: customerData, error: e1 },
      { data: invoiceData, error: e2 },
      { data: allocationData, error: e3 },
      { data: receiptData, error: e4 },
      { data: templateData, error: e5 },
      { data: logData, error: e6 },
    ] = await Promise.all([
      supabase.from("customers").select("*").order("name"),
      supabase.from("invoices").select("*"),
      supabase.from("receipt_allocations").select("*"),
      supabase.from("receipts").select("*"),
      supabase.from("reminder_templates").select("*"),
      supabase.from("reminder_log").select("*"),
    ]);

    const err = e1 ?? e2 ?? e3 ?? e4 ?? e5 ?? e6;
    if (err) {
      setError(err.message);
      setLoading(false);
      return;
    }

    setCustomers((customerData ?? []) as Customer[]);
    setInvoices((invoiceData ?? []) as Invoice[]);
    setAllocations((allocationData ?? []) as ReceiptAllocation[]);
    setReceipts((receiptData ?? []) as Receipt[]);
    setTemplates((templateData ?? []) as ReminderTemplate[]);
    setReminderLogs((logData ?? []) as ReminderLog[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const customerById = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers]);

  const invoiceRows: InvoiceRow[] = useMemo(() => {
    const today = todayISO();
    const allocatedByInvoice = new Map<string, number>();
    for (const a of allocations) {
      allocatedByInvoice.set(a.invoice_id, (allocatedByInvoice.get(a.invoice_id) ?? 0) + a.amount);
    }

    return invoices.map((inv) => {
      const customer = customerById.get(inv.customer_id);
      const outstanding = Math.max(0, inv.total - (allocatedByInvoice.get(inv.id) ?? 0));
      const rawDaysLate = daysLateFor(inv.due_date, today);
      const daysLate = outstanding > 0 ? Math.max(0, rawDaysLate) : 0;

      let effectiveStatus: EffectiveStatus;
      if (outstanding <= 0.005) effectiveStatus = "paid";
      else if (rawDaysLate > 0) effectiveStatus = "overdue";
      else if (inv.status === "partial") effectiveStatus = "partial";
      else effectiveStatus = "open";

      return {
        ...inv,
        customerName: customer?.name ?? "Unknown customer",
        customerEmail: customer?.email ?? null,
        outstanding,
        daysLate,
        effectiveStatus,
      };
    });
  }, [invoices, allocations, customerById]);

  const stats = useMemo(() => {
    const totalAR = invoiceRows.reduce((s, r) => (r.outstanding > 0 ? s + r.outstanding : s), 0);
    const overdueRows = invoiceRows.filter((r) => r.effectiveStatus === "overdue");
    const totalOverdue = overdueRows.reduce((s, r) => s + r.outstanding, 0);
    const totalInvoiced = invoices.reduce((s, i) => s + i.total, 0);
    const totalCollected = receipts.reduce((s, r) => s + r.amount, 0);
    // Simplified CEI proxy (no period-boundary data to compute the textbook
    // formula): share of everything invoiced that's actually been collected.
    const cei = totalInvoiced > 0 ? (totalCollected / totalInvoiced) * 100 : 0;
    const avgDaysLate = overdueRows.length > 0 ? overdueRows.reduce((s, r) => s + r.daysLate, 0) / overdueRows.length : 0;
    return { totalAR, totalOverdue, cei, avgDaysLate };
  }, [invoiceRows, invoices, receipts]);

  const ageingBuckets: AgeingBucket[] = useMemo(() => {
    const buckets = { current: 0, b1_30: 0, b31_60: 0, b61_90: 0, b91: 0 };
    for (const r of invoiceRows) {
      if (r.outstanding <= 0) continue;
      if (r.daysLate <= 0) buckets.current += r.outstanding;
      else if (r.daysLate <= 30) buckets.b1_30 += r.outstanding;
      else if (r.daysLate <= 60) buckets.b31_60 += r.outstanding;
      else if (r.daysLate <= 90) buckets.b61_90 += r.outstanding;
      else buckets.b91 += r.outstanding;
    }
    return [
      { label: "Current", amount: buckets.current, color: "#34d399" },
      { label: "1–30 Days", amount: buckets.b1_30, color: "#fbbf24" },
      { label: "31–60 Days", amount: buckets.b31_60, color: "#f59e0b" },
      { label: "61–90 Days", amount: buckets.b61_90, color: "#f97316" },
      { label: "91+ Days", amount: buckets.b91, color: "#dc2626" },
    ];
  }, [invoiceRows]);

  const customerSummaryRows: CustomerSummaryRow[] = useMemo(() => {
    const byCustomer = new Map<string, CustomerSummaryRow>();
    for (const c of customers) {
      byCustomer.set(c.id, {
        id: c.id,
        name: c.name,
        code: c.code,
        creditLimit: c.credit_limit,
        outstanding: 0,
        invoiceCount: 0,
        worstDaysLate: 0,
        overLimit: false,
      });
    }
    for (const r of invoiceRows) {
      if (r.outstanding <= 0) continue;
      const row = byCustomer.get(r.customer_id);
      if (!row) continue;
      row.outstanding += r.outstanding;
      row.invoiceCount += 1;
      row.worstDaysLate = Math.max(row.worstDaysLate, r.daysLate);
    }
    for (const row of byCustomer.values()) {
      row.overLimit = row.creditLimit > 0 && row.outstanding > row.creditLimit;
    }
    return Array.from(byCustomer.values());
  }, [customers, invoiceRows]);

  const overLimitCustomerIds = useMemo(
    () => new Set(customerSummaryRows.filter((r) => r.overLimit).map((r) => r.id)),
    [customerSummaryRows]
  );

  const filteredInvoiceRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = invoiceRows.filter((r) => {
      if (q && !r.customerName.toLowerCase().includes(q)) return false;
      if (statusFilter !== "all" && r.effectiveStatus !== statusFilter) return false;
      return true;
    });
    return [...filtered].sort((a, b) => b.daysLate - a.daysLate || b.invoice_date.localeCompare(a.invoice_date));
  }, [invoiceRows, search, statusFilter]);

  const filteredCustomerRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = customerSummaryRows.filter((r) => !q || r.name.toLowerCase().includes(q));
    return [...filtered].sort((a, b) => b.outstanding - a.outstanding);
  }, [customerSummaryRows, search]);

  const selectedInvoice = useMemo(
    () => invoiceRows.find((r) => r.id === selectedInvoiceId) ?? null,
    [invoiceRows, selectedInvoiceId]
  );

  const template = templates[0] ?? null;

  const lastSentForSelected = useMemo(() => {
    if (!selectedInvoice) return null;
    const logs = reminderLogs
      .filter((l) => l.invoice_id === selectedInvoice.id)
      .sort((a, b) => b.sent_at.localeCompare(a.sent_at));
    return logs[0] ?? null;
  }, [reminderLogs, selectedInvoice]);

  async function handleSend() {
    if (!supabase || !selectedInvoice) return;
    if (!selectedInvoice.customerEmail) return;

    const vars = {
      customer: selectedInvoice.customerName,
      amount: formatCurrency(selectedInvoice.outstanding),
      days_overdue: String(selectedInvoice.daysLate),
      invoice_no: selectedInvoice.invoice_no,
    };
    const subject = fillTemplate(template?.subject ?? DEFAULT_TEMPLATE.subject, vars);
    const body = fillTemplate(template?.body ?? DEFAULT_TEMPLATE.body, vars);

    setSendState((s) => ({ ...s, [selectedInvoice.id]: "sending" }));

    const { data, error: sendError } = await supabase
      .from("reminder_log")
      .insert({
        invoice_id: selectedInvoice.id,
        to_email: selectedInvoice.customerEmail,
        subject,
        body,
        status: "sent",
        sent_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (sendError) {
      setSendState((s) => ({ ...s, [selectedInvoice.id]: "error" }));
      return;
    }

    setReminderLogs((logs) => [...logs, data as ReminderLog]);
    setSendState((s) => ({ ...s, [selectedInvoice.id]: "sent" }));
  }

  const invoiceColumns: Column<InvoiceRow>[] = [
    { key: "invoice_no", header: "Invoice #" },
    {
      key: "customerName",
      header: "Customer",
      render: (row) => (
        <span className="inline-flex items-center">
          {row.customerName}
          {overLimitCustomerIds.has(row.customer_id) && <RiskBadge />}
        </span>
      ),
    },
    { key: "due_date", header: "Due Date", render: (row) => formatDate(row.due_date) },
    { key: "total", header: "Amount", className: "text-right", render: (row) => formatCurrency(row.total) },
    {
      key: "outstanding",
      header: "Outstanding",
      className: "text-right",
      render: (row) => formatCurrency(row.outstanding),
    },
    {
      key: "daysLate",
      header: "Days Late",
      className: "text-right",
      render: (row) => (row.daysLate > 0 ? row.daysLate : "—"),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => (
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_STYLES[row.effectiveStatus]}`}>
          {row.effectiveStatus}
        </span>
      ),
    },
  ];

  const customerColumns: Column<CustomerSummaryRow>[] = [
    {
      key: "name",
      header: "Customer",
      render: (row) => (
        <span className="inline-flex items-center">
          {row.name}
          {row.overLimit && <RiskBadge />}
        </span>
      ),
    },
    { key: "creditLimit", header: "Credit Limit", className: "text-right", render: (row) => formatCurrency(row.creditLimit) },
    { key: "outstanding", header: "Outstanding", className: "text-right", render: (row) => formatCurrency(row.outstanding) },
    { key: "invoiceCount", header: "Invoices", className: "text-right" },
    {
      key: "worstDaysLate",
      header: "Worst Days Late",
      className: "text-right",
      render: (row) => (row.worstDaysLate > 0 ? row.worstDaysLate : "—"),
    },
  ];

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">AR Analyst Dashboard</h1>
        <p className="mt-1 text-sm text-slate-500">
          Who owes us money, how late it is, and one click to chase it.
        </p>
      </div>

      {!isConfigured && <NotConfigured />}

      {isConfigured && error && (
        <div className="mb-6 rounded-xl border border-red-300 bg-red-50 p-6 text-red-800">
          <p className="font-semibold">Couldn&apos;t load the dashboard.</p>
          <p className="mt-1 text-sm">{error}</p>
        </div>
      )}

      {isConfigured && loading && <SkeletonPanel />}

      {isConfigured && !loading && !error && (
        <>
          <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              label="Total AR"
              value={formatCurrency(stats.totalAR)}
              icon={<IndianRupee className="h-4 w-4" />}
            />
            <KpiCard
              label="Total Overdue"
              value={formatCurrency(stats.totalOverdue)}
              tone={stats.totalOverdue > 0 ? "danger" : "default"}
              icon={<AlertTriangle className="h-4 w-4" />}
            />
            <KpiCard
              label="Collection Efficiency (CEI)"
              value={`${stats.cei.toFixed(1)}%`}
              tone="success"
              icon={<Percent className="h-4 w-4" />}
            />
            <KpiCard
              label="Average Days Late"
              value={stats.avgDaysLate > 0 ? `${Math.round(stats.avgDaysLate)} days` : "—"}
              icon={<Clock className="h-4 w-4" />}
            />
          </div>

          <div className="mb-6">
            <AgeingBar buckets={ageingBuckets} total={stats.totalAR} />
          </div>

          <div className="mb-4 flex flex-wrap items-center gap-3">
            <div className="inline-flex rounded-lg bg-slate-100 p-1 text-sm font-medium">
              {(["invoices", "customers"] as Tab[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  aria-pressed={tab === t}
                  onClick={() => setTab(t)}
                  className={`rounded-md px-3 py-1.5 transition-colors ${
                    tab === t ? "bg-white text-brand shadow-sm" : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  {t === "invoices" ? "All Invoices" : "Customer Summary"}
                </button>
              ))}
            </div>

            <div className="relative min-w-[200px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search customer name…"
                className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
              />
            </div>

            {tab === "invoices" && (
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
              >
                <option value="all">All statuses</option>
                <option value="open">Open</option>
                <option value="partial">Partial</option>
                <option value="overdue">Overdue</option>
              </select>
            )}
          </div>

          {tab === "invoices" ? (
            <DataTable
              columns={invoiceColumns}
              rows={filteredInvoiceRows}
              empty="No invoices match your search/filter."
              onRowClick={(row) => (row.effectiveStatus === "overdue" ? setSelectedInvoiceId(row.id) : undefined)}
              rowClassName={(row) => (row.effectiveStatus === "overdue" ? "" : "cursor-default")}
            />
          ) : (
            <DataTable columns={customerColumns} rows={filteredCustomerRows} empty="No customers match your search." />
          )}
          {tab === "invoices" && (
            <p className="mt-2 text-xs text-slate-400">Click an overdue row to draft a collection reminder.</p>
          )}
        </>
      )}

      {selectedInvoice && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setSelectedInvoiceId(null)} aria-hidden="true" />
          <div className="animate-slide-in-right relative flex h-full w-full max-w-md flex-col bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 p-5">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-brand">Collection Reminder</p>
                <h2 className="text-lg font-bold text-slate-900">{selectedInvoice.invoice_no}</h2>
              </div>
              <button
                type="button"
                onClick={() => setSelectedInvoiceId(null)}
                className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5">
              <div className="mb-4 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-xs text-slate-500">Customer</p>
                  <p className="font-medium text-slate-900">{selectedInvoice.customerName}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Outstanding</p>
                  <p className="font-medium text-slate-900">{formatCurrency(selectedInvoice.outstanding)}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Days Overdue</p>
                  <p className="font-medium text-red-600">{selectedInvoice.daysLate} days</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Last Reminder</p>
                  <p className="font-medium text-slate-900">
                    {lastSentForSelected ? formatDate(lastSentForSelected.sent_at) : "Never sent"}
                  </p>
                </div>
              </div>

              {!selectedInvoice.customerEmail ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                  No email on file for this customer — add one in Customer Master before sending.
                </div>
              ) : (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm">
                  <div className="mb-2 flex items-center gap-2 text-xs text-slate-500">
                    <Mail className="h-3.5 w-3.5" /> To: {selectedInvoice.customerEmail}
                  </div>
                  <p className="mb-2 font-semibold text-slate-900">
                    {fillTemplate(template?.subject ?? DEFAULT_TEMPLATE.subject, {
                      customer: selectedInvoice.customerName,
                      amount: formatCurrency(selectedInvoice.outstanding),
                      days_overdue: String(selectedInvoice.daysLate),
                      invoice_no: selectedInvoice.invoice_no,
                    })}
                  </p>
                  <p className="whitespace-pre-wrap text-slate-700">
                    {fillTemplate(template?.body ?? DEFAULT_TEMPLATE.body, {
                      customer: selectedInvoice.customerName,
                      amount: formatCurrency(selectedInvoice.outstanding),
                      days_overdue: String(selectedInvoice.daysLate),
                      invoice_no: selectedInvoice.invoice_no,
                    })}
                  </p>
                </div>
              )}
            </div>

            <div className="border-t border-slate-200 p-5">
              {(() => {
                const state = sendState[selectedInvoice.id] ?? "idle";
                const disabled = !selectedInvoice.customerEmail || state === "sending" || state === "sent";
                return (
                  <>
                    <button
                      type="button"
                      onClick={handleSend}
                      disabled={disabled}
                      className={`flex w-full items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-semibold text-white transition-colors disabled:cursor-not-allowed ${
                        state === "sent" ? "bg-emerald-600" : "bg-brand hover:bg-brand-dark disabled:opacity-40"
                      }`}
                    >
                      {state === "sending" && <Loader2 className="h-4 w-4 animate-spin" />}
                      {state === "sent" && <CheckCircle2 className="h-4 w-4" />}
                      {(state === "idle" || state === "error") && <Send className="h-4 w-4" />}
                      {state === "sending" ? "Sending…" : state === "sent" ? "Sent" : "Send Reminder"}
                    </button>
                    {state === "error" && (
                      <p className="mt-2 text-center text-xs text-red-600">Couldn&apos;t send. Try again.</p>
                    )}
                  </>
                );
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
