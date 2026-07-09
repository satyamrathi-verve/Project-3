"use client";

/*
  Self-contained on purpose: this screen doesn't import or modify any shared
  component (DataTable, KpiCard, globals.css) so it can never affect how other
  screens in this shared repo look or behave. Every helper/table/chart below
  is local to this file — including its own coral/peach visual identity,
  which intentionally departs from the rest of the app's blue/slate look
  (per explicit request to match a reference dashboard's style for this one
  screen). Colors are inline hex, not new Tailwind theme tokens, so
  tailwind.config.ts stays untouched too.

  A few requested widgets have no backing data in this Supabase schema and we
  never add columns/tables (CLAUDE.md rule: never touch the backend):
    - "Collector" (assigned analyst) — no such field on customers/invoices.
      Omitted rather than faked; would need a real column to be honest.
    - Year-over-year / month-over-month trend arrows (like the reference
      image) — we have no historical AR snapshots to compute a real trend
      from, so none are shown rather than faking one.
  Dispute Breakdown was dropped entirely (not just hidden) — same reasoning,
  no dispute-reason field exists anywhere in this schema.
  "Customer Segment" (Enterprise/SMB) and "Customers by City" ARE derived
  below from real stored fields (credit_limit, address) — not invented.
*/

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Clock,
  IndianRupee,
  Loader2,
  Mail,
  Percent,
  RefreshCw,
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

// Reference-image-inspired accent, scoped to this screen only (inline hex,
// not a shared Tailwind token).
const ACCENT = "#FF8B6E";
const ACCENT_DARK = "#FF6A4D";
const PAGE_BG = "#FDF6F2";

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

interface DonutSegment {
  label: string;
  value: number;
  color: string;
}

interface RankedItem {
  label: string;
  value: number;
}

interface MonthPoint {
  label: string;
  amount: number;
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

// Animates a number from 0 up to `target` once `active` flips true (used to
// count the KPI tiles up on load instead of just popping in).
function useCountUp(target: number, active: boolean, durationMs = 800): number {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    const start = performance.now();
    function tick(now: number) {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(target * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, active, durationMs]);
  return value;
}

// Shared "fade + rise into place" treatment for section entrances. Pass a
// staggered `delayMs` via inline style (Tailwind's JIT can't pick up a
// dynamic arbitrary-value class like `delay-[${n}ms]` from a template
// string, so the delay has to be a real style prop, not a class).
function revealClass(visible: boolean): string {
  return `transition-all duration-500 ease-out ${visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-3"}`;
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
  format,
  hint,
  tone = "default",
  icon,
  active,
}: {
  label: string;
  value: number;
  format: (n: number) => string;
  hint?: string;
  tone?: "default" | "danger" | "success";
  icon: ReactNode;
  active: boolean;
}) {
  const animated = useCountUp(value, active);
  const toneClass = tone === "danger" ? "text-red-600" : tone === "success" ? "text-emerald-600" : "text-slate-900";
  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex items-start justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
        <span className="rounded-full p-1.5" style={{ backgroundColor: `${ACCENT}1A`, color: ACCENT }}>
          {icon}
        </span>
      </div>
      <p className={`mt-2 text-[26px] font-extrabold leading-none tabular-nums ${toneClass}`}>{format(animated)}</p>
      {hint && <p className="mt-1.5 text-xs text-slate-400">{hint}</p>}
    </div>
  );
}

function AgeingBarChart({ buckets, animate }: { buckets: AgeingBucket[]; animate: boolean }) {
  const max = Math.max(1, ...buckets.map((b) => b.amount));
  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm transition-shadow duration-200 hover:shadow-md">
      <p className="mb-4 text-sm font-bold text-slate-900">AR Aging</p>
      <div className="space-y-3">
        {buckets.map((b, i) => (
          <div key={b.label} className="flex items-center gap-3">
            <span className="w-16 flex-none text-xs font-medium text-slate-500">{b.label}</span>
            <div className="h-5 flex-1 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full transition-[width] duration-700 ease-out"
                style={{
                  width: `${animate ? (b.amount / max) * 100 : 0}%`,
                  backgroundColor: b.color,
                  transitionDelay: `${i * 80}ms`,
                }}
              />
            </div>
            <span className="w-16 flex-none text-right text-xs font-bold text-slate-800">{formatCurrency(b.amount)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CashForecastChart({ points, animate }: { points: WeekPoint[]; animate: boolean }) {
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
  // Draw the lines by animating stroke-dashoffset from fully-hidden to 0 —
  // a classic SVG "line drawing itself" reveal, no extra libraries needed.
  const pathLength = width * 1.3;

  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm transition-shadow duration-200 hover:shadow-md">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-bold text-slate-900">Cash Forecast — Predicted vs Actual</p>
        <div className="flex items-center gap-4 text-xs text-slate-500">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-4 rounded" style={{ backgroundColor: ACCENT }} /> Actual
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-4 rounded border-2 border-dashed border-slate-400" /> Predicted
          </span>
        </div>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" preserveAspectRatio="none" role="img" aria-label="Weekly cash forecast">
        {actualPts.length > 1 && (
          <polyline
            points={actualPts.join(" ")}
            fill="none"
            stroke={ACCENT}
            strokeWidth={2.5}
            strokeDasharray={pathLength}
            strokeDashoffset={animate ? 0 : pathLength}
            style={{ transition: "stroke-dashoffset 900ms ease-out" }}
          />
        )}
        {predictedPts.length > 1 && (
          <polyline
            points={predictedPts.join(" ")}
            fill="none"
            stroke="#94a3b8"
            strokeWidth={2.5}
            strokeDasharray="6 4"
            style={{ opacity: animate ? 1 : 0, transition: "opacity 600ms ease-out 700ms" }}
          />
        )}
        {points.map((p, i) => (
          <g key={p.label} style={{ opacity: animate ? 1 : 0, transition: `opacity 400ms ease-out ${500 + i * 60}ms` }}>
            {p.actual !== undefined && <circle cx={i * stepX} cy={y(p.actual)} r={3} fill={ACCENT} />}
            {p.predicted !== undefined && <circle cx={i * stepX} cy={y(p.predicted)} r={3} fill="#94a3b8" />}
            <text x={i * stepX} y={height - 6} fontSize={10} textAnchor="middle" fill="#94a3b8">
              {p.label}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

function DonutChart({
  title,
  segments,
  formatValue = (v: number) => String(v),
  animate,
}: {
  title: string;
  segments: DonutSegment[];
  formatValue?: (v: number) => string;
  animate: boolean;
}) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  let cumulative = 0;
  const stops = segments
    .map((seg) => {
      const start = total > 0 ? (cumulative / total) * 360 : 0;
      cumulative += seg.value;
      const end = total > 0 ? (cumulative / total) * 360 : 0;
      return `${seg.color} ${start}deg ${end}deg`;
    })
    .join(", ");

  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm transition-shadow duration-200 hover:shadow-md">
      <p className="mb-4 text-sm font-bold text-slate-900">{title}</p>
      <div className="flex items-center gap-5">
        <div
          className="relative h-28 w-28 flex-none rounded-full transition-all duration-500 ease-out"
          style={{
            background: total > 0 ? `conic-gradient(${stops})` : "#f1f5f9",
            transform: animate ? "scale(1)" : "scale(0.6)",
            opacity: animate ? 1 : 0,
          }}
        >
          <div className="absolute inset-[10px] flex flex-col items-center justify-center rounded-full bg-white text-center">
            <p className="text-sm font-extrabold leading-tight text-slate-900">{formatValue(total)}</p>
            <p className="text-[9px] uppercase tracking-wide text-slate-400">Total</p>
          </div>
        </div>
        <div className="space-y-1.5">
          {segments.map((seg) => (
            <div key={seg.label} className="flex items-center gap-2 text-xs">
              <span className="h-2.5 w-2.5 flex-none rounded-full" style={{ backgroundColor: seg.color }} />
              <span className="text-slate-500">{seg.label}</span>
              <span className="font-bold text-slate-900">{formatValue(seg.value)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm transition-shadow duration-200 hover:shadow-md">
      <p className="mb-4 text-sm font-bold text-slate-900">{title}</p>
      {children}
    </div>
  );
}

function RankedBarList({
  items,
  formatValue,
  color,
  animate,
}: {
  items: RankedItem[];
  formatValue: (v: number) => string;
  color: string;
  animate: boolean;
}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  if (items.length === 0) return <p className="text-xs text-slate-400">No data yet.</p>;
  return (
    <div className="space-y-2.5">
      {items.map((item, i) => (
        <div key={item.label} className="flex items-center gap-3">
          <span className="w-24 flex-none truncate text-xs text-slate-500" title={item.label}>
            {item.label}
          </span>
          <div className="h-4 flex-1 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full transition-[width] duration-700 ease-out"
              style={{
                width: `${animate ? (item.value / max) * 100 : 0}%`,
                backgroundColor: color,
                transitionDelay: `${i * 70}ms`,
              }}
            />
          </div>
          <span className="w-16 flex-none text-right text-xs font-bold text-slate-800">{formatValue(item.value)}</span>
        </div>
      ))}
    </div>
  );
}

function MonthlyTrendChart({ points, animate }: { points: MonthPoint[]; animate: boolean }) {
  const max = Math.max(1, ...points.map((p) => p.amount));
  const barArea = 110;
  return (
    <div className="flex items-end gap-2" style={{ height: barArea + 44 }}>
      {points.map((p, i) => (
        <div key={p.label} className="flex flex-1 flex-col items-center justify-end gap-1.5">
          <span className="text-[10px] font-bold text-slate-700">{formatCurrency(p.amount)}</span>
          <div
            className="w-full rounded-t-lg transition-[height] duration-700 ease-out"
            style={{
              height: `${animate ? Math.max(6, (p.amount / max) * barArea) : 0}px`,
              backgroundColor: ACCENT,
              transitionDelay: `${i * 80}ms`,
            }}
          />
          <span className="text-[10px] text-slate-400">{p.label}</span>
        </div>
      ))}
    </div>
  );
}

function SkeletonPanel() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-24 rounded-2xl border border-slate-100 bg-white" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="h-56 rounded-2xl border border-slate-100 bg-white" />
        <div className="h-56 rounded-2xl border border-slate-100 bg-white" />
      </div>
      <div className="h-64 rounded-2xl border border-slate-100 bg-white" />
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
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const [search, setSearch] = useState("");
  const [riskFilter, setRiskFilter] = useState<RiskFilter>("all");
  const [daysFilter, setDaysFilter] = useState<DaysFilter>("all");
  const [segmentFilter, setSegmentFilter] = useState<SegmentFilter>("all");

  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);
  const [drawerVisible, setDrawerVisible] = useState(false);
  const [sendState, setSendState] = useState<Record<string, SendState>>({});

  // Flips true one frame after data finishes loading, so charts/KPIs animate
  // in from their zero state instead of appearing already-filled.
  const [mounted, setMounted] = useState(false);

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
    setLastUpdated(new Date());
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

  useEffect(() => {
    if (loading || error) {
      setMounted(false);
      return;
    }
    const raf = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(raf);
  }, [loading, error]);

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

  const statusDonut: DonutSegment[] = useMemo(() => {
    let open = 0,
      partial = 0,
      overdue = 0,
      paid = 0;
    for (const r of invoiceRows) {
      if (r.outstanding <= 0) paid++;
      else if (r.daysLate > 0) overdue++;
      else if (r.status === "partial") partial++;
      else open++;
    }
    return [
      { label: "Open", value: open, color: ACCENT },
      { label: "Partial", value: partial, color: "#f59e0b" },
      { label: "Overdue", value: overdue, color: "#dc2626" },
      { label: "Paid", value: paid, color: "#10b981" },
    ];
  }, [invoiceRows]);

  // Amount-based (not headcount) — a handful of large Enterprise accounts can
  // dominate exposure far more than their share of the customer count.
  const segmentDonut: DonutSegment[] = useMemo(() => {
    let enterprise = 0;
    let smb = 0;
    for (const r of openRows) {
      if (r.segment === "Enterprise") enterprise += r.outstanding;
      else smb += r.outstanding;
    }
    return [
      { label: "Enterprise", value: Math.round(enterprise), color: "#64748b" },
      { label: "SMB", value: Math.round(smb), color: ACCENT },
    ];
  }, [openRows]);

  const paymentModeDonut: DonutSegment[] = useMemo(() => {
    const MODE_LABELS: Record<string, string> = { cash: "Cash", cheque: "Cheque", upi: "UPI", neft: "NEFT" };
    const MODE_COLORS: Record<string, string> = { cash: "#f59e0b", cheque: "#64748b", upi: ACCENT, neft: "#10b981" };
    const byMode = new Map<string, number>();
    for (const r of receipts) byMode.set(r.mode, (byMode.get(r.mode) ?? 0) + r.amount);
    return Array.from(byMode.entries()).map(([mode, amount]) => ({
      label: MODE_LABELS[mode] ?? mode,
      value: Math.round(amount),
      color: MODE_COLORS[mode] ?? "#94a3b8",
    }));
  }, [receipts]);

  const monthlyTrend: MonthPoint[] = useMemo(() => {
    const byMonth = new Map<string, number>();
    for (const inv of invoices) {
      const key = inv.invoice_date.slice(0, 7);
      byMonth.set(key, (byMonth.get(key) ?? 0) + inv.total);
    }
    return Array.from(byMonth.keys())
      .sort()
      .slice(-6)
      .map((key) => ({
        label: new Date(`${key}-01T00:00:00`).toLocaleDateString("en-IN", { month: "short" }),
        amount: byMonth.get(key) ?? 0,
      }));
  }, [invoices]);

  // Real city names live directly in the address field for this seed data
  // (e.g. "Mumbai", "Ahmedabad") — grouped as-is, no parsing needed.
  const cityBreakdown: RankedItem[] = useMemo(() => {
    const byCity = new Map<string, number>();
    for (const c of customers) {
      const city = c.address?.trim() || "Unknown";
      byCity.set(city, (byCity.get(city) ?? 0) + 1);
    }
    return Array.from(byCity.entries())
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
  }, [customers]);

  const topCustomersByOutstanding: RankedItem[] = useMemo(() => {
    const byCustomer = new Map<string, number>();
    for (const r of openRows) byCustomer.set(r.customerName, (byCustomer.get(r.customerName) ?? 0) + r.outstanding);
    return Array.from(byCustomer.entries())
      .map(([label, value]) => ({ label, value: Math.round(value) }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);
  }, [openRows]);

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
    <div className="-m-8 min-h-[calc(100%+4rem)] p-8" style={{ backgroundColor: PAGE_BG }}>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl text-white shadow-sm" style={{ backgroundColor: ACCENT }}>
            <BarChart3 className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-xl font-extrabold tracking-tight text-slate-900">AR ANALYST DASHBOARD</h1>
            <p className="text-xs text-slate-500">Cash flow health, aging risk, and a worklist to chase it.</p>
          </div>
        </div>
        {lastUpdated && (
          <div className="flex items-center gap-2">
            <span className="rounded-full border border-slate-100 bg-white px-3 py-1.5 text-xs font-medium text-slate-500 shadow-sm">
              Last updated: {lastUpdated.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
            </span>
            <button
              type="button"
              onClick={fetchAll}
              className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors"
              style={{ backgroundColor: ACCENT }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = ACCENT_DARK)}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = ACCENT)}
            >
              <RefreshCw className="h-3.5 w-3.5" /> Refresh
            </button>
          </div>
        )}
      </div>

      {!isConfigured && <NotConfigured />}

      {isConfigured && error && (
        <div className="mb-6 rounded-2xl border border-red-300 bg-red-50 p-6 text-red-800">
          <p className="font-semibold">Couldn&apos;t load the dashboard.</p>
          <p className="mt-1 text-sm">{error}</p>
        </div>
      )}

      {isConfigured && loading && <SkeletonPanel />}

      {isConfigured && !loading && !error && (
        <>
          <div className={`mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5 ${revealClass(mounted)}`}>
            <StatCard
              label="Total AR Outstanding"
              value={stats.totalAR}
              format={formatFullCurrency}
              icon={<IndianRupee className="h-4 w-4" />}
              active={mounted}
            />
            <StatCard
              label="Days Sales Outstanding"
              value={stats.dso}
              format={(n) => `${n.toFixed(0)} days`}
              hint={stats.dso <= 45 ? "Within standard (≤45)" : "Above standard (45)"}
              tone={stats.dso > 45 ? "danger" : "success"}
              icon={<Clock className="h-4 w-4" />}
              active={mounted}
            />
            <StatCard
              label="Total Past Due"
              value={stats.totalPastDue}
              format={formatFullCurrency}
              tone={stats.totalPastDue > 0 ? "danger" : "default"}
              icon={<AlertTriangle className="h-4 w-4" />}
              active={mounted}
            />
            <StatCard
              label="Collection Effectiveness"
              value={stats.cei}
              format={(n) => `${n.toFixed(1)}%`}
              tone="success"
              icon={<Percent className="h-4 w-4" />}
              active={mounted}
            />
            <StatCard
              label="Open Invoices"
              value={stats.openCount}
              format={(n) => String(Math.round(n))}
              icon={<TrendingUp className="h-4 w-4" />}
              active={mounted}
            />
          </div>

          <div
            className={`mb-5 grid grid-cols-1 gap-4 lg:grid-cols-2 ${revealClass(mounted)}`}
            style={{ transitionDelay: "80ms" }}
          >
            <AgeingBarChart buckets={ageingBuckets} animate={mounted} />
            <CashForecastChart points={cashForecast} animate={mounted} />
          </div>

          <div
            className={`mb-5 grid grid-cols-1 gap-4 lg:grid-cols-3 ${revealClass(mounted)}`}
            style={{ transitionDelay: "160ms" }}
          >
            <DonutChart title="Invoices by Status" segments={statusDonut} animate={mounted} />
            <DonutChart title="Outstanding by Segment" segments={segmentDonut} formatValue={formatCurrency} animate={mounted} />
            <DonutChart title="Collections by Payment Mode" segments={paymentModeDonut} formatValue={formatCurrency} animate={mounted} />
          </div>

          <div
            className={`mb-5 grid grid-cols-1 gap-4 lg:grid-cols-3 ${revealClass(mounted)}`}
            style={{ transitionDelay: "240ms" }}
          >
            <ChartCard title="Monthly Invoiced Trend">
              <MonthlyTrendChart points={monthlyTrend} animate={mounted} />
            </ChartCard>
            <ChartCard title="Top 5 Customers by Outstanding">
              <RankedBarList items={topCustomersByOutstanding} formatValue={formatCurrency} color={ACCENT} animate={mounted} />
            </ChartCard>
            <ChartCard title="Customers by City">
              <RankedBarList items={cityBreakdown} formatValue={(v) => String(v)} color="#64748b" animate={mounted} />
            </ChartCard>
          </div>

          <div
            className={`mb-4 flex flex-wrap items-center gap-3 ${revealClass(mounted)}`}
            style={{ transitionDelay: "320ms" }}
          >
            <div className="relative min-w-[200px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search customer name…"
                className="w-full rounded-full border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm shadow-sm outline-none focus:ring-2"
                style={{ ["--tw-ring-color" as string]: `${ACCENT}55` }}
              />
            </div>
            <select
              value={riskFilter}
              onChange={(e) => setRiskFilter(e.target.value as RiskFilter)}
              className="rounded-full border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm outline-none"
            >
              <option value="all">All risk tiers</option>
              <option value="High">High risk</option>
              <option value="Medium">Medium risk</option>
              <option value="Low">Low risk</option>
            </select>
            <select
              value={daysFilter}
              onChange={(e) => setDaysFilter(e.target.value as DaysFilter)}
              className="rounded-full border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm outline-none"
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
              className="rounded-full border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm outline-none"
              title={`Derived from credit limit — Enterprise means credit limit ≥ ${formatFullCurrency(ENTERPRISE_CREDIT_LIMIT)}`}
            >
              <option value="all">All segments</option>
              <option value="Enterprise">Enterprise</option>
              <option value="SMB">SMB</option>
            </select>
          </div>

          <div
            className={`overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm ${revealClass(mounted)}`}
            style={{ transitionDelay: "380ms" }}
          >
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left">
                  <th className="w-6 px-2 py-3" />
                  <th className="px-4 py-3 text-xs font-bold uppercase tracking-wide text-slate-800">Customer</th>
                  <th className="px-4 py-3 text-xs font-bold uppercase tracking-wide text-slate-800">Invoice #</th>
                  <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wide text-slate-800">Amount Owed</th>
                  <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wide text-slate-800">Days Past Due</th>
                  <th className="px-4 py-3 text-xs font-bold uppercase tracking-wide text-slate-800">Risk Tier</th>
                  <th className="px-4 py-3 text-xs font-bold uppercase tracking-wide text-slate-800">Last Touchpoint</th>
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
                      className="cursor-pointer border-b border-slate-100 transition-colors duration-150 last:border-0 hover:bg-slate-50"
                    >
                      <td className="px-2 py-3">{row.isAlert && <AlertDot />}</td>
                      <td className="px-4 py-3 text-slate-700">{row.customerName}</td>
                      <td className="px-4 py-3 text-slate-700">{row.invoice_no}</td>
                      <td className="px-4 py-3 text-right font-bold text-slate-900">{formatFullCurrency(row.outstanding)}</td>
                      <td className="px-4 py-3 text-right text-slate-700">{row.daysLate > 0 ? row.daysLate : "—"}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${RISK_STYLES[row.riskTier]}`}>
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
            <div className="flex items-center justify-between border-b border-slate-100 p-5">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide" style={{ color: ACCENT }}>
                  Collection Reminder
                </p>
                <h2 className="text-lg font-extrabold text-slate-900">{selectedInvoice.invoice_no}</h2>
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
                  <span className={`inline-block w-fit rounded-full px-2 py-0.5 text-xs font-semibold ${RISK_STYLES[selectedInvoice.riskTier]}`}>
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

            <div className="border-t border-slate-100 p-5">
              {(() => {
                const state = sendState[selectedInvoice.id] ?? "idle";
                const disabled = !selectedInvoice.customerEmail || state === "sending" || state === "sent";
                return (
                  <>
                    <button
                      type="button"
                      onClick={handleSend}
                      disabled={disabled}
                      className="flex w-full items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                      style={{ backgroundColor: state === "sent" ? "#059669" : ACCENT }}
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
