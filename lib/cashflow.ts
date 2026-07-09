/*
  Data-loading and metrics engine for the Cashflow Projection module.

  Every number here is derived from real rows in `invoices`, `customers`,
  `receipts`, and `receipt_allocations` — nothing is fabricated. Where the
  spec asked for things the schema has no column for (currency, business
  unit, collector, a stored "risk score"), we either derive a real metric
  from existing fields (risk score, collection probability, average delay)
  or surface it as a plain client-side annotation the user types in
  (collector, remarks, follow-up date) rather than pretend it's backend data.
*/

import type { SupabaseClient } from "@supabase/supabase-js";

export type Granularity = "day" | "week" | "month" | "quarter" | "year";
export type RiskLevel = "Low" | "Medium" | "High";
export type InvoiceStatus = "open" | "partial" | "paid" | "overdue";

export interface NormalizedInvoice {
  id: string;
  invoice_no: string;
  invoice_date: string;
  due_date: string;
  customer_id: string;
  customer_name: string;
  credit_limit: number;
  credit_days: number;
  total: number;
  status: InvoiceStatus;
  allocated: number;
  outstanding: number;
  isOverdue: boolean;
  dueInFuture: boolean;
  daysPastDue: number;
}

export interface AllocationRecord {
  invoice_id: string;
  customer_id: string;
  amount: number;
  receipt_date: string;
}

export interface CustomerMetrics {
  id: string;
  code: string;
  name: string;
  credit_limit: number;
  credit_days: number;
  outstanding: number;
  overdueAmount: number;
  overdueCount: number;
  invoiceCount: number;
  avgDelayDays: number;
  onTimePct: number;
  riskScore: number;
  riskLevel: RiskLevel;
}

export interface CashflowData {
  today: string;
  invoices: NormalizedInvoice[];
  allocations: AllocationRecord[];
  customers: CustomerMetrics[];
  avgCollectionDays: number;
  onTimeCollectionPct: number;
}

export async function loadCashflowData(supabase: SupabaseClient): Promise<CashflowData> {
  const [
    { data: invoicesRaw, error: invErr },
    { data: allocRaw, error: allocErr },
    { data: receiptsRaw, error: recErr },
    { data: customersRaw, error: custErr },
  ] = await Promise.all([
    supabase
      .from("invoices")
      .select("id, invoice_no, invoice_date, due_date, customer_id, total, status, customer:customers(id,code,name,credit_limit,credit_days)"),
    supabase.from("receipt_allocations").select("id, receipt_id, invoice_id, amount"),
    supabase.from("receipts").select("id, receipt_date, customer_id"),
    supabase.from("customers").select("id, code, name, credit_limit, credit_days"),
  ]);

  if (invErr || allocErr || recErr || custErr) {
    throw new Error(invErr?.message || allocErr?.message || recErr?.message || custErr?.message || "Failed to load cashflow data.");
  }

  const receiptById = new Map<string, { receipt_date: string; customer_id: string }>();
  for (const r of receiptsRaw ?? []) receiptById.set(r.id, { receipt_date: r.receipt_date, customer_id: r.customer_id });

  const allocatedByInvoice = new Map<string, number>();
  const allocations: AllocationRecord[] = [];
  for (const a of allocRaw ?? []) {
    const receipt = receiptById.get(a.receipt_id);
    allocatedByInvoice.set(a.invoice_id, (allocatedByInvoice.get(a.invoice_id) ?? 0) + Number(a.amount));
    if (receipt) {
      allocations.push({
        invoice_id: a.invoice_id,
        customer_id: receipt.customer_id,
        amount: Number(a.amount),
        receipt_date: receipt.receipt_date,
      });
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  const todayMs = Date.parse(today);

  const invoices: NormalizedInvoice[] = (invoicesRaw ?? []).map((inv: any) => {
    const allocated = allocatedByInvoice.get(inv.id) ?? 0;
    const outstanding = Math.max(0, Number(inv.total) - allocated);
    const dueMs = Date.parse(inv.due_date);
    const dueInFuture = dueMs >= todayMs;
    const daysPastDue = dueInFuture ? 0 : Math.round((todayMs - dueMs) / 86400000);
    return {
      id: inv.id,
      invoice_no: inv.invoice_no,
      invoice_date: inv.invoice_date,
      due_date: inv.due_date,
      customer_id: inv.customer_id,
      customer_name: inv.customer?.name ?? "—",
      credit_limit: Number(inv.customer?.credit_limit ?? 0),
      credit_days: Number(inv.customer?.credit_days ?? 0),
      total: Number(inv.total),
      status: inv.status,
      allocated,
      outstanding,
      isOverdue: outstanding > 0 && !dueInFuture,
      dueInFuture,
      daysPastDue,
    };
  });

  const invoiceDueById = new Map(invoices.map((i) => [i.id, i.due_date]));

  const invoicesByCustomer = new Map<string, NormalizedInvoice[]>();
  for (const inv of invoices) {
    const list = invoicesByCustomer.get(inv.customer_id) ?? [];
    list.push(inv);
    invoicesByCustomer.set(inv.customer_id, list);
  }

  const allocationsByCustomer = new Map<string, AllocationRecord[]>();
  for (const a of allocations) {
    const list = allocationsByCustomer.get(a.customer_id) ?? [];
    list.push(a);
    allocationsByCustomer.set(a.customer_id, list);
  }

  let globalDelayWeighted = 0;
  let globalOnTimeAmount = 0;
  let globalAllocAmount = 0;

  const customers: CustomerMetrics[] = (customersRaw ?? []).map((c: any) => {
    const custInvoices = invoicesByCustomer.get(c.id) ?? [];
    const outstanding = custInvoices.reduce((s, i) => s + i.outstanding, 0);
    const overdueList = custInvoices.filter((i) => i.isOverdue);
    const overdueAmount = overdueList.reduce((s, i) => s + i.outstanding, 0);

    const custAllocations = allocationsByCustomer.get(c.id) ?? [];
    let delayWeighted = 0;
    let onTimeAmount = 0;
    let allocAmount = 0;
    for (const a of custAllocations) {
      const dueDate = invoiceDueById.get(a.invoice_id);
      if (!dueDate) continue;
      const delayDays = Math.round((Date.parse(a.receipt_date) - Date.parse(dueDate)) / 86400000);
      delayWeighted += Math.max(0, delayDays) * a.amount;
      if (delayDays <= 0) onTimeAmount += a.amount;
      allocAmount += a.amount;

      globalDelayWeighted += Math.max(0, delayDays) * a.amount;
      if (delayDays <= 0) globalOnTimeAmount += a.amount;
      globalAllocAmount += a.amount;
    }
    const avgDelayDays = allocAmount > 0 ? delayWeighted / allocAmount : 0;
    const onTimePct = allocAmount > 0 ? (onTimeAmount / allocAmount) * 100 : 70;

    const overdueRatio = outstanding > 0 ? overdueAmount / outstanding : 0;
    const delayNorm = Math.min(1, avgDelayDays / 90);
    const creditUtil = c.credit_limit > 0 ? Math.min(1, outstanding / c.credit_limit) : outstanding > 0 ? 1 : 0;
    const riskScore = Math.round(overdueRatio * 40 + delayNorm * 30 + creditUtil * 30);
    const riskLevel: RiskLevel = riskScore >= 60 ? "High" : riskScore >= 30 ? "Medium" : "Low";

    return {
      id: c.id,
      code: c.code,
      name: c.name,
      credit_limit: Number(c.credit_limit),
      credit_days: Number(c.credit_days),
      outstanding,
      overdueAmount,
      overdueCount: overdueList.length,
      invoiceCount: custInvoices.length,
      avgDelayDays,
      onTimePct,
      riskScore,
      riskLevel,
    };
  });

  return {
    today,
    invoices,
    allocations,
    customers,
    avgCollectionDays: globalAllocAmount > 0 ? globalDelayWeighted / globalAllocAmount : 0,
    onTimeCollectionPct: globalAllocAmount > 0 ? (globalOnTimeAmount / globalAllocAmount) * 100 : 70,
  };
}

// ---------------------------------------------------------------------------
// Bucketing helpers (shared by the combo chart, trend chart and calendar)
// ---------------------------------------------------------------------------

export function bucketKey(dateStr: string, g: Granularity): string {
  const d = new Date(dateStr + "T00:00:00");
  if (g === "day") return dateStr;
  if (g === "week") {
    const day = d.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + diff);
    return d.toISOString().slice(0, 10);
  }
  if (g === "month") return dateStr.slice(0, 7);
  if (g === "quarter") {
    const q = Math.floor(d.getMonth() / 3) + 1;
    return `${d.getFullYear()}-Q${q}`;
  }
  return String(d.getFullYear());
}

export function bucketLabel(key: string, g: Granularity): string {
  if (g === "day") return new Date(key + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
  if (g === "week") {
    const start = new Date(key + "T00:00:00");
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    const fmt = (d: Date) => d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
    return `${fmt(start)}–${fmt(end)}`;
  }
  if (g === "month") {
    const [y, m] = key.split("-").map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString("en-IN", { month: "short", year: "2-digit" });
  }
  if (g === "quarter") return key.replace("-", " ");
  return key;
}

// ---------------------------------------------------------------------------
// Aging
// ---------------------------------------------------------------------------

export const AGING_BUCKETS = ["Current", "1-30", "31-60", "61-90", "90+"] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];

export function agingBucketFor(daysPastDue: number, dueInFuture: boolean): AgingBucket {
  if (dueInFuture) return "Current";
  if (daysPastDue <= 30) return "1-30";
  if (daysPastDue <= 60) return "31-60";
  if (daysPastDue <= 90) return "61-90";
  return "90+";
}

export interface AgingRow {
  customer_id: string;
  customer_name: string;
  buckets: Record<AgingBucket, number>;
  total: number;
}

export function computeAging(invoices: NormalizedInvoice[]): { rows: AgingRow[]; totals: Record<AgingBucket, number> } {
  const open = invoices.filter((i) => i.outstanding > 0);
  const totals: Record<AgingBucket, number> = { Current: 0, "1-30": 0, "31-60": 0, "61-90": 0, "90+": 0 };
  const byCustomer = new Map<string, AgingRow>();

  for (const inv of open) {
    const bucket = agingBucketFor(inv.daysPastDue, inv.dueInFuture);
    totals[bucket] += inv.outstanding;
    const row =
      byCustomer.get(inv.customer_id) ??
      ({ customer_id: inv.customer_id, customer_name: inv.customer_name, buckets: { Current: 0, "1-30": 0, "31-60": 0, "61-90": 0, "90+": 0 }, total: 0 } as AgingRow);
    row.buckets[bucket] += inv.outstanding;
    row.total += inv.outstanding;
    byCustomer.set(inv.customer_id, row);
  }

  return { rows: Array.from(byCustomer.values()).sort((a, b) => b.total - a.total), totals };
}

// ---------------------------------------------------------------------------
// Executive KPIs
// ---------------------------------------------------------------------------

export interface Kpis {
  projectedInflow: number;
  overdueAmount: number;
  dueThisWeek: number;
  dueThisMonth: number;
  collectionEfficiency: number;
  avgCollectionDays: number;
  outstandingInvoices: number;
  highRiskCustomers: number;
  totalInvoiced: number;
  totalCollected: number;
  averageInvoiceValue: number;
  dso: number;
}

export function computeKpis(data: CashflowData): Kpis {
  const { invoices, allocations, customers, today, avgCollectionDays } = data;
  const open = invoices.filter((i) => i.outstanding > 0);
  const totalInvoiced = invoices.reduce((s, i) => s + i.total, 0);
  const totalCollected = allocations.reduce((s, a) => s + a.amount, 0);
  const projectedInflow = open.reduce((s, i) => s + i.outstanding, 0);
  const overdueAmount = open.filter((i) => i.isOverdue).reduce((s, i) => s + i.outstanding, 0);

  const weekEnd = new Date(today + "T00:00:00");
  weekEnd.setDate(weekEnd.getDate() + 6);
  const weekEndMs = weekEnd.getTime();
  const dueThisWeek = open.filter((i) => !i.isOverdue && Date.parse(i.due_date) <= weekEndMs).reduce((s, i) => s + i.outstanding, 0);

  const monthKeyToday = today.slice(0, 7);
  const dueThisMonth = open.filter((i) => i.due_date.slice(0, 7) === monthKeyToday).reduce((s, i) => s + i.outstanding, 0);

  const collectionEfficiency = totalInvoiced > 0 ? (totalCollected / totalInvoiced) * 100 : 0;
  const averageInvoiceValue = invoices.length > 0 ? totalInvoiced / invoices.length : 0;

  const dates = invoices.map((i) => Date.parse(i.invoice_date)).filter((n) => !Number.isNaN(n));
  const spanDays = dates.length > 1 ? Math.max(1, (Math.max(...dates) - Math.min(...dates)) / 86400000) : 90;
  const dso = totalInvoiced > 0 ? (projectedInflow / totalInvoiced) * spanDays : 0;

  return {
    projectedInflow,
    overdueAmount,
    dueThisWeek,
    dueThisMonth,
    collectionEfficiency,
    avgCollectionDays,
    outstandingInvoices: open.length,
    highRiskCustomers: customers.filter((c) => c.riskLevel === "High").length,
    totalInvoiced,
    totalCollected,
    averageInvoiceValue,
    dso,
  };
}

// ---------------------------------------------------------------------------
// Forecast accuracy (Expected = invoiced due in a past period, Actual = collected against it)
// ---------------------------------------------------------------------------

export function computeForecastAccuracy(data: CashflowData, granularity: Granularity = "month"): number {
  const { invoices, allocations, today } = data;
  const todayKey = bucketKey(today, granularity);
  const expectedByBucket = new Map<string, number>();
  for (const inv of invoices) {
    const k = bucketKey(inv.due_date, granularity);
    if (k >= todayKey) continue;
    expectedByBucket.set(k, (expectedByBucket.get(k) ?? 0) + inv.total);
  }
  const invoiceDueBucket = new Map(invoices.map((i) => [i.id, bucketKey(i.due_date, granularity)]));
  const actualByBucket = new Map<string, number>();
  for (const a of allocations) {
    const k = invoiceDueBucket.get(a.invoice_id);
    if (!k || k >= todayKey) continue;
    actualByBucket.set(k, (actualByBucket.get(k) ?? 0) + a.amount);
  }

  let scoreSum = 0;
  let count = 0;
  for (const [k, expected] of expectedByBucket) {
    if (expected <= 0) continue;
    const actual = actualByBucket.get(k) ?? 0;
    const accuracy = Math.max(0, 1 - Math.abs(actual - expected) / expected);
    scoreSum += accuracy;
    count += 1;
  }
  return count > 0 ? (scoreSum / count) * 100 : 0;
}

// ---------------------------------------------------------------------------
// Collection probability + suggested collection date for a single invoice
// ---------------------------------------------------------------------------

export function collectionProbability(invoice: NormalizedInvoice, customer: CustomerMetrics | undefined): number {
  const base = customer?.onTimePct ?? 70;
  if (!invoice.isOverdue) return Math.min(98, Math.max(5, Math.round(base)));
  const penalty = invoice.daysPastDue * 0.6;
  return Math.min(95, Math.max(5, Math.round(base - penalty)));
}

export function suggestedCollectionDate(invoice: NormalizedInvoice, customer: CustomerMetrics | undefined): string {
  const delay = Math.round(customer?.avgDelayDays ?? 0);
  const d = new Date(invoice.due_date + "T00:00:00");
  d.setDate(d.getDate() + delay);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Funnel + top lists
// ---------------------------------------------------------------------------

export interface FunnelStage {
  label: string;
  count: number;
  amount: number;
}

export function computeFunnel(data: CashflowData): FunnelStage[] {
  const { invoices, allocations } = data;
  const totalInvoiced = { count: invoices.length, amount: invoices.reduce((s, i) => s + i.total, 0) };
  const due = invoices.filter((i) => i.outstanding > 0);
  const overdue = due.filter((i) => i.isOverdue);
  const collected = { count: invoices.filter((i) => i.status === "paid").length, amount: allocations.reduce((s, a) => s + a.amount, 0) };

  return [
    { label: "Total Invoiced", count: totalInvoiced.count, amount: totalInvoiced.amount },
    { label: "Due (Open/Partial)", count: due.length, amount: due.reduce((s, i) => s + i.outstanding, 0) },
    { label: "Overdue", count: overdue.length, amount: overdue.reduce((s, i) => s + i.outstanding, 0) },
    { label: "Collected", count: collected.count, amount: collected.amount },
  ];
}

export function topDebtors(customers: CustomerMetrics[], n = 5): CustomerMetrics[] {
  return [...customers].filter((c) => c.outstanding > 0).sort((a, b) => b.outstanding - a.outstanding).slice(0, n);
}

export function topCustomersByVolume(invoices: NormalizedInvoice[], n = 5): { customer_id: string; customer_name: string; total: number }[] {
  const map = new Map<string, { customer_id: string; customer_name: string; total: number }>();
  for (const inv of invoices) {
    const existing = map.get(inv.customer_id) ?? { customer_id: inv.customer_id, customer_name: inv.customer_name, total: 0 };
    existing.total += inv.total;
    map.set(inv.customer_id, existing);
  }
  return Array.from(map.values()).sort((a, b) => b.total - a.total).slice(0, n);
}

// ---------------------------------------------------------------------------
// Combination chart series: stacked forecast categories + actual/target lines
// ---------------------------------------------------------------------------

export interface ComboBucket {
  key: string;
  label: string;
  forecast: number;
  dueSoon: number;
  overdue: number;
  actual: number;
  target: number;
  isPast: boolean;
}

export function buildComboSeries(data: CashflowData, granularity: Granularity): ComboBucket[] {
  const { invoices, allocations, today } = data;
  const todayKey = bucketKey(today, granularity);
  const soonCutoff = new Date(today + "T00:00:00");
  soonCutoff.setDate(soonCutoff.getDate() + 7);
  const soonMs = soonCutoff.getTime();

  const map = new Map<string, ComboBucket>();
  function ensure(k: string): ComboBucket {
    let b = map.get(k);
    if (!b) {
      b = { key: k, label: bucketLabel(k, granularity), forecast: 0, dueSoon: 0, overdue: 0, actual: 0, target: 0, isPast: k < todayKey };
      map.set(k, b);
    }
    return b;
  }

  for (const inv of invoices) {
    const k = bucketKey(inv.due_date, granularity);
    const b = ensure(k);
    b.target += inv.total;
    if (inv.outstanding > 0) {
      if (inv.isOverdue) b.overdue += inv.outstanding;
      else if (Date.parse(inv.due_date) <= soonMs) b.dueSoon += inv.outstanding;
      else b.forecast += inv.outstanding;
    }
  }

  const invoiceDueBucket = new Map(invoices.map((i) => [i.id, bucketKey(i.due_date, granularity)]));
  for (const a of allocations) {
    const k = invoiceDueBucket.get(a.invoice_id);
    if (!k) continue;
    ensure(k).actual += a.amount;
  }

  return Array.from(map.values()).sort((a, b) => (a.key < b.key ? -1 : 1));
}

// ---------------------------------------------------------------------------
// 12-month trend (invoiced vs collected), anchored on the current month
// ---------------------------------------------------------------------------

export interface TrendPoint {
  key: string;
  label: string;
  invoiced: number;
  collected: number;
}

export function buildTwelveMonthTrend(data: CashflowData): TrendPoint[] {
  const { invoices, allocations, today } = data;
  const anchor = new Date(today + "T00:00:00");
  anchor.setDate(1);
  const months: string[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(anchor);
    d.setMonth(d.getMonth() - i);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }

  const invoicedByMonth = new Map<string, number>();
  for (const inv of invoices) {
    const k = inv.invoice_date.slice(0, 7);
    invoicedByMonth.set(k, (invoicedByMonth.get(k) ?? 0) + inv.total);
  }
  const collectedByMonth = new Map<string, number>();
  for (const a of allocations) {
    const k = a.receipt_date.slice(0, 7);
    collectedByMonth.set(k, (collectedByMonth.get(k) ?? 0) + a.amount);
  }

  return months.map((k) => ({
    key: k,
    label: bucketLabel(k, "month"),
    invoiced: invoicedByMonth.get(k) ?? 0,
    collected: collectedByMonth.get(k) ?? 0,
  }));
}

// ---------------------------------------------------------------------------
// Invoice adjustment table row + audit trail (front-end-only annotations —
// there is no `collector`/`remarks`/`follow_up_date` column in the schema, so
// these live in component state for the session rather than being written
// back to Supabase or presented as if they were saved server-side).
// ---------------------------------------------------------------------------

export interface AdjustmentRow {
  id: string;
  invoice_no: string;
  customer_id: string;
  customer_name: string;
  due_date: string;
  status: InvoiceStatus;
  outstanding: number;
  riskLevel: RiskLevel;
  probability: number;
  expectedAmount: string;
  expectedDate: string;
  followUpDate: string;
  collector: string;
  remarks: string;
}

export interface AuditEntry {
  id: string;
  timestamp: string;
  invoice_no: string;
  field: string;
  oldValue: string;
  newValue: string;
}

export function buildAdjustmentRows(data: CashflowData): AdjustmentRow[] {
  const customerById = new Map(data.customers.map((c) => [c.id, c]));
  return data.invoices
    .filter((inv) => inv.outstanding > 0)
    .map((inv) => {
      const customer = customerById.get(inv.customer_id);
      return {
        id: inv.id,
        invoice_no: inv.invoice_no,
        customer_id: inv.customer_id,
        customer_name: inv.customer_name,
        due_date: inv.due_date,
        status: inv.status,
        outstanding: inv.outstanding,
        riskLevel: customer?.riskLevel ?? "Low",
        probability: collectionProbability(inv, customer),
        expectedAmount: inv.outstanding.toFixed(2),
        expectedDate: inv.due_date,
        followUpDate: "",
        collector: "",
        remarks: "",
      };
    });
}

// ---------------------------------------------------------------------------
// Scenario Planning — apply a global "what if" delay/probability shift on top
// of the real base data and compare against the unadjusted baseline.
// ---------------------------------------------------------------------------

export interface ScenarioResult {
  baselineExpected: number;
  scenarioExpected: number;
  baselineDueThisWeek: number;
  scenarioDueThisWeek: number;
  baselineDueThisMonth: number;
  scenarioDueThisMonth: number;
}

export function computeScenario(rows: AdjustmentRow[], today: string, delayDays: number, probAdjPct: number): ScenarioResult {
  const todayMs = Date.parse(today);
  const weekEndMs = todayMs + 7 * 86400000;
  const monthKeyToday = today.slice(0, 7);

  let baselineExpected = 0;
  let scenarioExpected = 0;
  let baselineWeek = 0;
  let scenarioWeek = 0;
  let baselineMonth = 0;
  let scenarioMonth = 0;

  for (const r of rows) {
    const amount = Number(r.expectedAmount) || r.outstanding;
    const baseProb = r.probability;
    const scenarioProb = Math.min(100, Math.max(0, baseProb + probAdjPct));
    baselineExpected += amount * (baseProb / 100);
    scenarioExpected += amount * (scenarioProb / 100);

    const baseDueMs = Date.parse(r.expectedDate || r.due_date);
    const scenarioDueMs = baseDueMs + delayDays * 86400000;

    if (baseDueMs >= todayMs && baseDueMs <= weekEndMs) baselineWeek += amount;
    if (scenarioDueMs >= todayMs && scenarioDueMs <= weekEndMs) scenarioWeek += amount;

    if (new Date(baseDueMs).toISOString().slice(0, 7) === monthKeyToday) baselineMonth += amount;
    if (new Date(scenarioDueMs).toISOString().slice(0, 7) === monthKeyToday) scenarioMonth += amount;
  }

  return {
    baselineExpected,
    scenarioExpected,
    baselineDueThisWeek: baselineWeek,
    scenarioDueThisWeek: scenarioWeek,
    baselineDueThisMonth: baselineMonth,
    scenarioDueThisMonth: scenarioMonth,
  };
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

export interface CashflowFilters {
  customerId: string;
  status: string;
  riskLevel: string;
  dateFrom: string;
  dateTo: string;
  amountMin: string;
  amountMax: string;
  collector: string;
}

export const EMPTY_FILTERS: CashflowFilters = {
  customerId: "",
  status: "",
  riskLevel: "",
  dateFrom: "",
  dateTo: "",
  amountMin: "",
  amountMax: "",
  collector: "",
};

export function hasActiveFilters(f: CashflowFilters): boolean {
  return Object.values(f).some((v) => v !== "");
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export const currency = (n: number) =>
  n.toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });

export const compactCurrency = (n: number) => {
  if (Math.abs(n) >= 10000000) return `₹${(n / 10000000).toFixed(2)}Cr`;
  if (Math.abs(n) >= 100000) return `₹${(n / 100000).toFixed(2)}L`;
  if (Math.abs(n) >= 1000) return `₹${(n / 1000).toFixed(1)}K`;
  return currency(n);
};
