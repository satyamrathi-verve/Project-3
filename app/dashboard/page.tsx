"use client";

/*
  Self-contained on purpose: this screen doesn't import or modify any shared
  component (DataTable, KpiCard, globals.css) so it can never affect how other
  screens in this shared repo look or behave. Every helper/table/chart below
  is local to this file.

  A few requested widgets have no backing data in this Supabase schema and we
  never add columns/tables (CLAUDE.md rule: never touch the backend):
    - "Collector" (assigned analyst) — no such field on customers/invoices.
      Omitted rather than faked; would need a real column to be honest.
    - "Dispute reason" breakdown — no dispute/reason field anywhere. Shown as
      an explicit "not tracked yet" card instead of invented percentages.
  "Customer Segment" (Enterprise/SMB) IS derived below from credit_limit,
  which is a real stored field — documented at ENTERPRISE_CREDIT_LIMIT.
*/

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
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
  TrendingUp,
  X,
} from "lucide-react";
import { isConfigured, supabase } from "@/lib/supabase";
import { NotConfigured } from "@/components/NotConfigured";
import type { Customer, Invoice, ReceiptAllocation, Receipt, ReminderLog, ReminderTemplate } from "@/lib/types";

type RiskTier = "High" | "Medium" | "Low";
type Segment = "Enterprise" | "SMB";
type RiskFilter = "all" | RiskTier;
type DaysFilter = "all" | "1-30" | "31-60" | "61-90" | "91+";
type SegmentFilter = "all" | Segment;
type SendState = "idle" | "sending" | "sent" | "error";

// A customer with credit_limit at/above this is treated as "Enterprise" for
// the segment filter — a derived heuristic, not a stored field.
const ENTERPRISE_CREDIT_LIMIT = 500000;
// Threshold-alert rule: flag any account owing more than this AND more than
// this many days late (mirrors the classic "big + old" collections risk).
const ALERT_AMOUNT = 50000;
const ALERT_DAYS = 60;

interface InvoiceRow extends Invoice {
  customerName: string;
  customerEmail: string | null;
  creditLimit: number;
  segment: Segment;
  outstanding: number;
  daysLate: number;
  riskTier: RiskTier;
  isAlert: boolean;
  lastTouchpoint: string | null;
}

interface AgeingBucket {
  label: string;
  amount: number;
  color: string;
}

interface WeekPoint {
  label: string;
  actual?: number;
  predicted?: number;
}

const RISK_STYLES: Record<RiskTier, string> = {
  High: "bg-red-50 text-red-700",
  Medium: "bg-amber-50 text-amber-700",
  Low: "bg-emerald-50 text-emerald-700",
};

const DEFAULT_TEMPLATE = {
  subject: "Payment Reminder — Invoice {invoice_no}",
  body: "Dear {customer},\n\nOur records show invoice {invoice_no} for {amount} is now {days_overdue} day(s) past its due date. Please arrange payment at your earliest convenience.\n\nThank you,\nVerve Advisory Pvt Ltd",
};

function formatCurrency(amount: number): string {
  if (Math.abs(amount) >= 100000) return `₹${(amount / 100000).toFixed(2)}L`;
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount);
}

function formatFullCurrency(amount: number): string {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function daysLateFor(dueDateISO: string, asOnISO: string): number {
  const due = new Date(`${dueDateISO}T00:00:00`);
  const asOn = new Date(`${asOnISO}T00:00:00`);
  return Math.floor((asOn.getTime() - due.getTime()) / 86400000);
}

function startOfWeek(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  const diffToMonday = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - diffToMonday);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function shortLabel(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

function riskTierFor(daysLate: number, outstanding: number): RiskTier {
  if (daysLate > 60 || outstanding > 100000) return "High";
  if (daysLate > 15 || outstanding > 25000) return "Medium";
  return "Low";
}

function fillTemplate(text: string, vars: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (_, key: string) => vars[key] ?? `{${key}}`);
}

function AlertDot() {
  return (
    <span
      title={`Over ${formatFullCurrency(ALERT_AMOUNT)} and more than ${ALERT_DAYS} days late`}
      className="inline-block h-2 w-2 flex-none rounded-full bg-red-600"
      aria-label="Threshold alert"
    />
  );
}

function StatCard({
  label,
  value,
  hint,
  tone = "default",
  icon,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "danger" | "success";
  icon: ReactNode;
}) {
  const toneClass = tone === "danger" ? "text-red-700" : tone === "success" ? "text-emerald-700" : "text-slate-900";
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
        <span className="text-slate-300">{icon}</span>
      </div>
      <p className={`mt-1 text-2xl font-bold leading-tight tabular-nums ${toneClass}`}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-400">{hint}</p>}
    </div>
  );
}

function AgeingBarChart({ buckets }: { buckets: AgeingBucket[] }) {
  const max = Math.max(1, ...buckets.map((b) => b.amount));
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <p className="mb-4 text-sm font-semibold text-slate-700">AR Aging</p>
      <div className="space-y-3">
        {buckets.map((b) => (
          <div key={b.label} className="flex items-center gap-3">
            <span className="w-20 flex-none text-xs text-slate-500">{b.label}</span>
            <div className="h-5 flex-1 overflow-hidden rounded bg-slate-100">
              <div
                className="h-full rounded"
                style={{ width: `${(b.amount / max) * 100}%`, backgroundColor: b.color }}
              />
            </div>
            <span className="w-20 flex-none text-right text-xs font-semibold text-slate-700">
              {formatCurrency(b.amount)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CashForecastChart({ points }: { points: WeekPoint[] }) {
  const width = 600;
  const height = 200;
  const padTop = 16;
  const padBottom = 28;
  const max = Math.max(1, ...points.map((p) => Math.max(p.actual ?? 0, p.predicted ?? 0)));
  const stepX = width / (points.length - 1);
  const y = (v: number) => padTop + (1 - v / max) * (height - padTop - padBottom);

  const actualPts = points.map((p, i) => (p.actual !== undefined ? `${i * stepX},${y(p.actual)}` : null)).filter(Boolean);
  const predictedPts = points
    .map((p, i) => (p.predicted !== undefined ? `${i * stepX},${y(p.predicted)}` : null))
    .filter(Boolean);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-700">Cash Forecast — Predicted vs Actual</p>
        <div className="flex items-center gap-4 text-xs text-slate-500">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-4 rounded bg-brand" /> Actual
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-4 rounded border-2 border-dashed border-amber-500" /> Predicted
          </span>
        </div>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" preserveAspectRatio="none" role="img" aria-label="Weekly cash forecast">
        {actualPts.length > 1 && (
          <polyline points={actualPts.join(" ")} fill="none" stroke="#2f6bff" strokeWidth={2.5} />
        )}
        {predictedPts.length > 1 && (
          <polyline points={predictedPts.join(" ")} fill="none" stroke="#f59e0b" strokeWidth={2.5} strokeDasharray="6 4" />
        )}
        {points.map((p, i) => (
          <g key={p.label}>
            {p.actual !== undefined && <circle cx={i * stepX} cy={y(p.actual)} r={3} fill="#2f6bff" />}
            {p.predicted !== undefined && <circle cx={i * stepX} cy={y(p.predicted)} r={3} fill="#f59e0b" />}
            <text x={i * stepX} y={height - 6} fontSize={10} textAnchor="middle" fill="#94a3b8">
              {p.label}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

function DisputeBreakdownPlaceholder() {
  return (
    <div className="flex h-full flex-col rounded-xl border border-dashed border-slate-300 bg-slate-50 p-5">
      <p className="text-sm font-semibold text-slate-700">Dispute Breakdown</p>
      <p className="mt-2 flex-1 text-xs text-slate-500">
        Not tracked yet — there&apos;s no dispute-reason field on invoices in this database, so this can&apos;t show
        real numbers. Ask the team if invoices should carry a reason (pricing, missing PO, damaged goods) before
        building this out; adding it means altering the schema, which this app never does on its own.
      </p>
    </div>
  );
}

function SkeletonPanel() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-24 rounded-xl border border-slate-200 bg-white" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="h-56 rounded-xl border border-slate-200 bg-white" />
        <div className="h-56 rounded-xl border border-slate-200 bg-white" />
      </div>
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

  const [search, setSearch] = useState("");
  const [riskFilter, setRiskFilter] = useState<RiskFilter>("all");
  const [daysFilter, setDaysFilter] = useState<DaysFilter>("all");
  const [segmentFilter, setSegmentFilter] = useState<SegmentFilter>("all");

  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);
  const [drawerVisible, setDrawerVisible] = useState(false);
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

  useEffect(() => {
    if (selectedInvoiceId) {
      const raf = requestAnimationFrame(() => setDrawerVisible(true));
      return () => cancelAnimationFrame(raf);
    }
    setDrawerVisible(false);
  }, [selectedInvoiceId]);

  const customerById = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers]);

  const invoiceRows: InvoiceRow[] = useMemo(() => {
    const today = todayISO();
    const allocatedByInvoice = new Map<string, number>();
    for (const a of allocations) {
      allocatedByInvoice.set(a.invoice_id, (allocatedByInvoice.get(a.invoice_id) ?? 0) + a.amount);
    }
    const lastTouchByInvoice = new Map<string, string>();
    for (const l of reminderLogs) {
      if (!l.invoice_id) continue;
      const prev = lastTouchByInvoice.get(l.invoice_id);
      if (!prev || l.sent_at > prev) lastTouchByInvoice.set(l.invoice_id, l.sent_at);
    }

    return invoices.map((inv) => {
      const customer = customerById.get(inv.customer_id);
      const outstanding = Math.max(0, inv.total - (allocatedByInvoice.get(inv.id) ?? 0));
      const rawDaysLate = daysLateFor(inv.due_date, today);
      const daysLate = outstanding > 0 ? Math.max(0, rawDaysLate) : 0;
      const creditLimit = customer?.credit_limit ?? 0;
      const lastTouch = lastTouchByInvoice.get(inv.id) ?? null;

      return {
        ...inv,
        customerName: customer?.name ?? "Unknown customer",
        customerEmail: customer?.email ?? null,
        creditLimit,
        segment: creditLimit >= ENTERPRISE_CREDIT_LIMIT ? "Enterprise" : "SMB",
        outstanding,
        daysLate,
        riskTier: riskTierFor(daysLate, outstanding),
        isAlert: outstanding > ALERT_AMOUNT && daysLate > ALERT_DAYS,
        lastTouchpoint: lastTouch ? `Reminder emailed ${formatDate(lastTouch)}` : null,
      };
    });
  }, [invoices, allocations, customerById, reminderLogs]);

  const openRows = useMemo(() => invoiceRows.filter((r) => r.outstanding > 0), [invoiceRows]);

  const stats = useMemo(() => {
    const today = todayISO();
    const totalAR = openRows.reduce((s, r) => s + r.outstanding, 0);
    const totalPastDue = openRows.reduce((s, r) => (r.daysLate > 0 ? s + r.outstanding : s), 0);
    const totalCollected = receipts.reduce((s, r) => s + r.amount, 0);
    const totalInvoiced = invoices.reduce((s, i) => s + i.total, 0);
    const cei = totalInvoiced > 0 ? (totalCollected / totalInvoiced) * 100 : 0;

    // DSO (count-back approximation): AR ÷ credit sales in a trailing window × window length.
    const DSO_WINDOW_DAYS = 90;
    const windowStart = addDays(today, -DSO_WINDOW_DAYS);
    const salesInWindow = invoices.filter((i) => i.invoice_date >= windowStart).reduce((s, i) => s + i.total, 0);
    const dso = salesInWindow > 0 ? (totalAR / salesInWindow) * DSO_WINDOW_DAYS : 0;

    return { totalAR, totalPastDue, cei, dso, openCount: openRows.length };
  }, [openRows, receipts, invoices]);

  const ageingBuckets: AgeingBucket[] = useMemo(() => {
    const b = { current: 0, b1_30: 0, b31_60: 0, b61_90: 0, b91: 0 };
    for (const r of openRows) {
      if (r.daysLate <= 0) b.current += r.outstanding;
      else if (r.daysLate <= 30) b.b1_30 += r.outstanding;
      else if (r.daysLate <= 60) b.b31_60 += r.outstanding;
      else if (r.daysLate <= 90) b.b61_90 += r.outstanding;
      else b.b91 += r.outstanding;
    }
    return [
      { label: "Current", amount: b.current, color: "#34d399" },
      { label: "1–30", amount: b.b1_30, color: "#fbbf24" },
      { label: "31–60", amount: b.b31_60, color: "#f59e0b" },
      { label: "61–90", amount: b.b61_90, color: "#f97316" },
      { label: "91+", amount: b.b91, color: "#dc2626" },
    ];
  }, [openRows]);

  const cashForecast: WeekPoint[] = useMemo(() => {
    const today = todayISO();
    const currentWeekStart = startOfWeek(today);
    const points: WeekPoint[] = [];

    for (let i = 3; i >= 0; i--) {
      const weekStart = addDays(currentWeekStart, -7 * i);
      const weekEnd = addDays(weekStart, 6);
      const actual = receipts
        .filter((r) => r.receipt_date >= weekStart && r.receipt_date <= weekEnd)
        .reduce((s, r) => s + r.amount, 0);
      points.push({ label: shortLabel(weekStart), actual });
    }
    for (let i = 1; i <= 4; i++) {
      const weekStart = addDays(currentWeekStart, 7 * i);
      const weekEnd = addDays(weekStart, 6);
      const predicted = openRows
        .filter((r) => r.due_date >= weekStart && r.due_date <= weekEnd)
        .reduce((s, r) => s + r.outstanding, 0);
      points.push({ label: shortLabel(weekStart), predicted });
    }
    return points;
  }, [receipts, openRows]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = openRows.filter((r) => {
      if (q && !r.customerName.toLowerCase().includes(q)) return false;
      if (riskFilter !== "all" && r.riskTier !== riskFilter) return false;
      if (segmentFilter !== "all" && r.segment !== segmentFilter) return false;
      if (daysFilter === "1-30" && !(r.daysLate >= 1 && r.daysLate <= 30)) return false;
      if (daysFilter === "31-60" && !(r.daysLate >= 31 && r.daysLate <= 60)) return false;
      if (daysFilter === "61-90" && !(r.daysLate >= 61 && r.daysLate <= 90)) return false;
      if (daysFilter === "91+" && !(r.daysLate >= 91)) return false;
      return true;
    });
    return [...filtered].sort((a, b) => b.daysLate - a.daysLate || b.outstanding - a.outstanding);
  }, [openRows, search, riskFilter, segmentFilter, daysFilter]);

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

  function closeDrawer() {
    setDrawerVisible(false);
    window.setTimeout(() => setSelectedInvoiceId(null), 200);
  }

  async function handleSend() {
    if (!supabase || !selectedInvoice || !selectedInvoice.customerEmail) return;
    const vars = {
      customer: selectedInvoice.customerName,
      amount: formatFullCurrency(selectedInvoice.outstanding),
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

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">AR Analyst Dashboard</h1>
        <p className="mt-1 text-sm text-slate-500">Cash flow health, aging risk, and a worklist to chase it.</p>
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
          <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <StatCard label="Total AR Outstanding" value={formatFullCurrency(stats.totalAR)} icon={<IndianRupee className="h-4 w-4" />} />
            <StatCard
              label="Days Sales Outstanding"
              value={`${stats.dso.toFixed(0)} days`}
              hint={stats.dso <= 45 ? "Within standard (≤45)" : "Above standard (45)"}
              tone={stats.dso > 45 ? "danger" : "success"}
              icon={<Clock className="h-4 w-4" />}
            />
            <StatCard
              label="Total Past Due"
              value={formatFullCurrency(stats.totalPastDue)}
              tone={stats.totalPastDue > 0 ? "danger" : "default"}
              icon={<AlertTriangle className="h-4 w-4" />}
            />
            <StatCard label="Collection Effectiveness (CEI)" value={`${stats.cei.toFixed(1)}%`} tone="success" icon={<Percent className="h-4 w-4" />} />
            <StatCard label="Open Invoices" value={String(stats.openCount)} icon={<TrendingUp className="h-4 w-4" />} />
          </div>

          <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <AgeingBarChart buckets={ageingBuckets} />
            <CashForecastChart points={cashForecast} />
          </div>

          <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2 rounded-xl border border-slate-200 bg-white p-5">
              <p className="mb-1 text-sm font-semibold text-slate-700">Reading the aging chart</p>
              <p className="text-xs text-slate-500">
                {formatFullCurrency(ageingBuckets[4].amount)} sits in the 91+ day bucket — that&apos;s the collection-risk
                money. Rows flagged <AlertDot /> below cross both size ({formatFullCurrency(ALERT_AMOUNT)}+) and age (
                {ALERT_DAYS}+ days) thresholds and need attention first.
              </p>
            </div>
            <DisputeBreakdownPlaceholder />
          </div>

          <div className="mb-4 flex flex-wrap items-center gap-3">
            <div className="relative min-w-[200px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search customer name…"
                className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
              />
            </div>
            <select
              value={riskFilter}
              onChange={(e) => setRiskFilter(e.target.value as RiskFilter)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
            >
              <option value="all">All risk tiers</option>
              <option value="High">High risk</option>
              <option value="Medium">Medium risk</option>
              <option value="Low">Low risk</option>
            </select>
            <select
              value={daysFilter}
              onChange={(e) => setDaysFilter(e.target.value as DaysFilter)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
            >
              <option value="all">Any days past due</option>
              <option value="1-30">1–30 days</option>
              <option value="31-60">31–60 days</option>
              <option value="61-90">61–90 days</option>
              <option value="91+">91+ days</option>
            </select>
            <select
              value={segmentFilter}
              onChange={(e) => setSegmentFilter(e.target.value as SegmentFilter)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
              title={`Derived from credit limit — Enterprise means credit limit ≥ ${formatFullCurrency(ENTERPRISE_CREDIT_LIMIT)}`}
            >
              <option value="all">All segments</option>
              <option value="Enterprise">Enterprise</option>
              <option value="SMB">SMB</option>
            </select>
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left">
                  <th className="w-6 px-2 py-3" />
                  <th className="px-4 py-3 font-semibold text-slate-600">Customer</th>
                  <th className="px-4 py-3 font-semibold text-slate-600">Invoice #</th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-600">Amount Owed</th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-600">Days Past Due</th>
                  <th className="px-4 py-3 font-semibold text-slate-600">Risk Tier</th>
                  <th className="px-4 py-3 font-semibold text-slate-600">Last Touchpoint</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-slate-400">
                      No invoices match your filters.
                    </td>
                  </tr>
                ) : (
                  filteredRows.map((row) => (
                    <tr
                      key={row.id}
                      onClick={() => setSelectedInvoiceId(row.id)}
                      className="cursor-pointer border-b border-slate-100 last:border-0 hover:bg-slate-50"
                    >
                      <td className="px-2 py-3">{row.isAlert && <AlertDot />}</td>
                      <td className="px-4 py-3 text-slate-700">{row.customerName}</td>
                      <td className="px-4 py-3 text-slate-700">{row.invoice_no}</td>
                      <td className="px-4 py-3 text-right font-medium text-slate-900">{formatFullCurrency(row.outstanding)}</td>
                      <td className="px-4 py-3 text-right text-slate-700">{row.daysLate > 0 ? row.daysLate : "—"}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${RISK_STYLES[row.riskTier]}`}>
                          {row.riskTier}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500">{row.lastTouchpoint ?? "No contact yet"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-slate-400">Click any row to draft and send a collection reminder.</p>
        </>
      )}

      {selectedInvoice && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div
            className={`absolute inset-0 bg-slate-900/40 transition-opacity duration-200 ${drawerVisible ? "opacity-100" : "opacity-0"}`}
            onClick={closeDrawer}
            aria-hidden="true"
          />
          <div
            className={`relative flex h-full w-full max-w-md flex-col bg-white shadow-2xl transition-transform duration-300 ease-out ${
              drawerVisible ? "translate-x-0" : "translate-x-full"
            }`}
          >
            <div className="flex items-center justify-between border-b border-slate-200 p-5">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-brand">Collection Reminder</p>
                <h2 className="text-lg font-bold text-slate-900">{selectedInvoice.invoice_no}</h2>
              </div>
              <button type="button" onClick={closeDrawer} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="Close">
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
                  <p className="font-medium text-slate-900">{formatFullCurrency(selectedInvoice.outstanding)}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Days Overdue</p>
                  <p className="font-medium text-red-600">{selectedInvoice.daysLate} days</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Risk Tier</p>
                  <span className={`inline-block w-fit rounded-full px-2 py-0.5 text-xs font-medium ${RISK_STYLES[selectedInvoice.riskTier]}`}>
                    {selectedInvoice.riskTier}
                  </span>
                </div>
                <div className="col-span-2">
                  <p className="text-xs text-slate-500">Last Reminder</p>
                  <p className="font-medium text-slate-900">{lastSentForSelected ? formatDate(lastSentForSelected.sent_at) : "Never sent"}</p>
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
                      amount: formatFullCurrency(selectedInvoice.outstanding),
                      days_overdue: String(selectedInvoice.daysLate),
                      invoice_no: selectedInvoice.invoice_no,
                    })}
                  </p>
                  <p className="whitespace-pre-wrap text-slate-700">
                    {fillTemplate(template?.body ?? DEFAULT_TEMPLATE.body, {
                      customer: selectedInvoice.customerName,
                      amount: formatFullCurrency(selectedInvoice.outstanding),
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
                    {state === "error" && <p className="mt-2 text-center text-xs text-red-600">Couldn&apos;t send. Try again.</p>}
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
