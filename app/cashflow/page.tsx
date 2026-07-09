"use client";

import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { NotConfigured } from "@/components/NotConfigured";
import { isConfigured, supabase } from "@/lib/supabase";
import {
  loadCashflowData,
  computeKpis,
  buildComboSeries,
  buildTwelveMonthTrend,
  computeAging,
  computeForecastAccuracy,
  computeFunnel,
  topDebtors,
  topCustomersByVolume,
  buildAdjustmentRows,
  EMPTY_FILTERS,
  currency,
  compactCurrency,
  type CashflowData,
  type Granularity,
  type AdjustmentRow,
  type AuditEntry,
  type NormalizedInvoice,
  type CashflowFilters,
} from "@/lib/cashflow";

import { KpiCard, LoadingGrid } from "@/components/cashflow/ui";
import { Tabs, type TabKey } from "@/components/cashflow/Tabs";
import { ComboChart } from "@/components/cashflow/ComboChart";
import { TrendChart } from "@/components/cashflow/TrendChart";
import { AgingPanel } from "@/components/cashflow/AgingPanel";
import { ReceivablesSummary } from "@/components/cashflow/ReceivablesSummary";
import { RiskPanel } from "@/components/cashflow/RiskPanel";
import { CashPositionPanel, CashDeficitNote } from "@/components/cashflow/CashPositionPanel";
import { CalendarPanel } from "@/components/cashflow/CalendarPanel";
import { PipelinePanel } from "@/components/cashflow/PipelinePanel";
import { FunnelPanel } from "@/components/cashflow/FunnelPanel";
import { TopListPanel } from "@/components/cashflow/TopListPanel";
import { FiltersBar } from "@/components/cashflow/FiltersBar";
import { AdjustmentTable } from "@/components/cashflow/AdjustmentTable";
import { ScenarioPanel } from "@/components/cashflow/ScenarioPanel";
import { ExportMenu } from "@/components/cashflow/ExportMenu";

const FIELD_LABELS: Partial<Record<keyof AdjustmentRow, string>> = {
  expectedAmount: "Expected Amount",
  expectedDate: "Expected Date",
  followUpDate: "Follow-up Date",
  collector: "Collector",
  remarks: "Remarks",
};

export default function CashflowPage() {
  const [data, setData] = useState<CashflowData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [tab, setTab] = useState<TabKey>("dashboard");
  const [granularity, setGranularity] = useState<Granularity>("month");
  const [filters, setFilters] = useState<CashflowFilters>(EMPTY_FILTERS);
  const [rows, setRows] = useState<AdjustmentRow[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);

  async function load() {
    if (!supabase) return;
    setLoading(true);
    setError(null);
    try {
      const result = await loadCashflowData(supabase);
      setData(result);
      setRows(buildAdjustmentRows(result));
      setAudit([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load cashflow data.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const customerRiskMap = useMemo(() => new Map((data?.customers ?? []).map((c) => [c.id, c.riskLevel])), [data]);
  const collectorByInvoice = useMemo(() => new Map(rows.map((r) => [r.id, r.collector])), [rows]);
  const invoiceById = useMemo(() => new Map((data?.invoices ?? []).map((i) => [i.id, i])), [data]);

  function matchesFilters(inv: NormalizedInvoice): boolean {
    if (filters.customerId && inv.customer_id !== filters.customerId) return false;
    if (filters.status && inv.status !== filters.status) return false;
    if (filters.riskLevel && customerRiskMap.get(inv.customer_id) !== filters.riskLevel) return false;
    if (filters.dateFrom && inv.due_date < filters.dateFrom) return false;
    if (filters.dateTo && inv.due_date > filters.dateTo) return false;
    if (filters.amountMin && inv.outstanding < Number(filters.amountMin)) return false;
    if (filters.amountMax && inv.outstanding > Number(filters.amountMax)) return false;
    if (filters.collector) {
      const c = collectorByInvoice.get(inv.id) ?? "";
      if (!c.toLowerCase().includes(filters.collector.toLowerCase())) return false;
    }
    return true;
  }

  const filteredInvoices = useMemo(
    () => (data ? data.invoices.filter(matchesFilters) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, filters, customerRiskMap, collectorByInvoice]
  );

  const filteredRows = useMemo(
    () => rows.filter((r) => { const inv = invoiceById.get(r.id); return inv ? matchesFilters(inv) : false; }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, filters, invoiceById, customerRiskMap, collectorByInvoice]
  );

  const filteredCustomers = useMemo(
    () =>
      (data?.customers ?? []).filter(
        (c) => (!filters.customerId || c.id === filters.customerId) && (!filters.riskLevel || c.riskLevel === filters.riskLevel)
      ),
    [data, filters.customerId, filters.riskLevel]
  );

  const collectorOptions = useMemo(
    () => Array.from(new Set(rows.map((r) => r.collector).filter(Boolean))),
    [rows]
  );

  function handleFieldChange(id: string, field: keyof AdjustmentRow, value: string) {
    const current = rows.find((r) => r.id === id);
    if (!current) return;
    const oldValue = String(current[field] ?? "");
    if (oldValue === value) return;
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
    setAudit((prev) => [
      ...prev,
      {
        id: `audit-${prev.length}-${Math.random().toString(36).slice(2, 8)}`,
        timestamp: new Date().toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }),
        invoice_no: current.invoice_no,
        field: FIELD_LABELS[field] ?? String(field),
        oldValue: oldValue || "(empty)",
        newValue: value || "(empty)",
      },
    ]);
  }

  function resetSession() {
    if (!data) return;
    setRows(buildAdjustmentRows(data));
    setAudit([]);
    localStorage.removeItem("cashflow-scheduled-report");
  }

  if (!isConfigured || !supabase) {
    return <NotConfigured />;
  }

  return (
    <div>
      <PageHeader
        title="Cash Flow Projection"
        subtitle="Executive-grade view of expected collections, receivables health, and customer risk — built entirely on real Supabase data."
      />

      <Tabs active={tab} onChange={setTab} />

      {loading && <LoadingGrid />}
      {error && <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</p>}

      {!loading && !error && data && (
        <>
          {tab === "dashboard" && <DashboardTab data={data} />}
          {tab === "forecast" && <ForecastTab data={data} granularity={granularity} setGranularity={setGranularity} rows={rows} />}
          {tab === "receivables" && (
            <ReceivablesTab
              data={data}
              filters={filters}
              setFilters={setFilters}
              filteredInvoices={filteredInvoices}
              filteredRows={filteredRows}
              onFieldChange={handleFieldChange}
              audit={audit}
              customers={data.customers.map((c) => ({ id: c.id, name: c.name }))}
              collectorOptions={collectorOptions}
            />
          )}
          {tab === "collections" && (
            <CollectionsTab
              data={data}
              filters={filters}
              setFilters={setFilters}
              filteredInvoices={filteredInvoices}
              customers={data.customers.map((c) => ({ id: c.id, name: c.name }))}
              collectorOptions={collectorOptions}
            />
          )}
          {tab === "customers" && (
            <CustomersTab
              filters={filters}
              setFilters={setFilters}
              filteredCustomers={filteredCustomers}
              filteredInvoices={filteredInvoices}
              customers={data.customers.map((c) => ({ id: c.id, name: c.name }))}
              collectorOptions={collectorOptions}
            />
          )}
          {tab === "calendar" && <CalendarPanel invoices={data.invoices} />}
          {tab === "scenario" && <ScenarioPanel rows={rows} today={data.today} />}
          {tab === "reports" && <ExportMenu rows={filteredRows} />}
          {tab === "settings" && <SettingsTab onReset={resetSession} />}
        </>
      )}
    </div>
  );
}

function DashboardTab({ data }: { data: CashflowData }) {
  const kpis = computeKpis(data);
  const trend = buildTwelveMonthTrend(data);
  const funnel = computeFunnel(data);
  const debtors = topDebtors(data.customers, 5).map((c) => ({ id: c.id, name: c.name, amount: c.outstanding, meta: `${c.overdueCount} overdue invoice(s)` }));
  const byVolume = topCustomersByVolume(data.invoices, 5).map((c) => ({ id: c.customer_id, name: c.customer_name, amount: c.total }));

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <KpiCard label="Projected Cash Inflow" value={compactCurrency(kpis.projectedInflow)} tone="blue" />
        <KpiCard label="Overdue Amount" value={compactCurrency(kpis.overdueAmount)} tone="red" />
        <KpiCard label="Due This Week" value={compactCurrency(kpis.dueThisWeek)} tone="orange" />
        <KpiCard label="Due This Month" value={compactCurrency(kpis.dueThisMonth)} tone="orange" />
        <KpiCard label="Collection Efficiency" value={`${kpis.collectionEfficiency.toFixed(0)}%`} tone="green" />
        <KpiCard label="Avg Collection Days" value={`${kpis.avgCollectionDays.toFixed(0)}d`} tone="slate" />
        <KpiCard label="Outstanding Invoices" value={String(kpis.outstandingInvoices)} tone="blue" />
        <KpiCard label="High-Risk Customers" value={String(kpis.highRiskCustomers)} tone="red" />
        <KpiCard label="Projected Cash Balance" value={compactCurrency(kpis.projectedInflow)} tone="purple" />
      </div>

      <TrendChart points={trend} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <FunnelPanel stages={funnel} />
        <TopListPanel title="Top Debtors" subtitle="Highest real outstanding balances." rows={debtors} />
        <TopListPanel title="Top Customers by Volume" subtitle="Largest customers by total invoiced." rows={byVolume} />
      </div>
    </div>
  );
}

function ForecastTab({
  data,
  granularity,
  setGranularity,
  rows,
}: {
  data: CashflowData;
  granularity: Granularity;
  setGranularity: (g: Granularity) => void;
  rows: AdjustmentRow[];
}) {
  const buckets = buildComboSeries(data, granularity);
  const accuracy = computeForecastAccuracy(data, "month");
  const avgProbability = rows.length > 0 ? rows.reduce((s, r) => s + r.probability, 0) / rows.length : 0;
  const totalExpected = rows.reduce((s, r) => s + (Number(r.expectedAmount) || 0), 0);
  const totalActualToDate = data.allocations.reduce((s, a) => s + a.amount, 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <KpiCard label="Forecast Accuracy" value={`${accuracy.toFixed(0)}%`} hint="Past periods: expected vs. actually collected" tone="purple" />
        <KpiCard label="Avg Collection Probability" value={`${avgProbability.toFixed(0)}%`} tone="blue" />
        <KpiCard label="Expected Collections" value={currency(totalExpected)} tone="blue" />
        <KpiCard label="Actual Collected (All-Time)" value={currency(totalActualToDate)} tone="green" />
      </div>
      <ComboChart buckets={buckets} granularity={granularity} onGranularityChange={setGranularity} />
      <CashPositionPanel projectedInflow={computeKpis(data).projectedInflow} />
      <CashDeficitNote />
    </div>
  );
}

function ReceivablesTab({
  data,
  filters,
  setFilters,
  filteredInvoices,
  filteredRows,
  onFieldChange,
  audit,
  customers,
  collectorOptions,
}: {
  data: CashflowData;
  filters: CashflowFilters;
  setFilters: (f: CashflowFilters) => void;
  filteredInvoices: NormalizedInvoice[];
  filteredRows: AdjustmentRow[];
  onFieldChange: (id: string, field: keyof AdjustmentRow, value: string) => void;
  audit: AuditEntry[];
  customers: { id: string; name: string }[];
  collectorOptions: string[];
}) {
  const aging = computeAging(filteredInvoices);
  const kpis = computeKpis(data);

  return (
    <div className="flex flex-col gap-6">
      <FiltersBar value={filters} onChange={setFilters} customers={customers} collectorOptions={collectorOptions} />
      <ReceivablesSummary
        averageInvoiceValue={kpis.averageInvoiceValue}
        dso={kpis.dso}
        outstandingInvoices={filteredRows.length}
        totalOutstanding={filteredRows.reduce((s, r) => s + r.outstanding, 0)}
      />
      <AgingPanel rows={aging.rows} totals={aging.totals} />
      <AdjustmentTable rows={filteredRows} onFieldChange={onFieldChange} audit={audit} />
    </div>
  );
}

function CollectionsTab({
  data,
  filters,
  setFilters,
  filteredInvoices,
  customers,
  collectorOptions,
}: {
  data: CashflowData;
  filters: CashflowFilters;
  setFilters: (f: CashflowFilters) => void;
  filteredInvoices: NormalizedInvoice[];
  customers: { id: string; name: string }[];
  collectorOptions: string[];
}) {
  const funnel = computeFunnel({ ...data, invoices: filteredInvoices });
  return (
    <div className="flex flex-col gap-6">
      <FiltersBar value={filters} onChange={setFilters} customers={customers} collectorOptions={collectorOptions} />
      <PipelinePanel invoices={filteredInvoices} />
      <FunnelPanel stages={funnel} />
    </div>
  );
}

function CustomersTab({
  filters,
  setFilters,
  filteredCustomers,
  filteredInvoices,
  customers,
  collectorOptions,
}: {
  filters: CashflowFilters;
  setFilters: (f: CashflowFilters) => void;
  filteredCustomers: CashflowData["customers"];
  filteredInvoices: NormalizedInvoice[];
  customers: { id: string; name: string }[];
  collectorOptions: string[];
}) {
  const debtors = topDebtors(filteredCustomers, 5).map((c) => ({ id: c.id, name: c.name, amount: c.outstanding, meta: `Risk: ${c.riskLevel}` }));
  const byVolume = topCustomersByVolume(filteredInvoices, 5).map((c) => ({ id: c.customer_id, name: c.customer_name, amount: c.total }));

  return (
    <div className="flex flex-col gap-6">
      <FiltersBar value={filters} onChange={setFilters} customers={customers} collectorOptions={collectorOptions} />
      <RiskPanel customers={filteredCustomers} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <TopListPanel title="Top Debtors" rows={debtors} />
        <TopListPanel title="Top Customers by Volume" rows={byVolume} />
      </div>
    </div>
  );
}

function SettingsTab({ onReset }: { onReset: () => void }) {
  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold text-slate-900">Scope & Assumptions</h3>
        <ul className="list-disc space-y-2 pl-5 text-sm text-slate-600">
          <li>Every chart and KPI is computed live from <code className="rounded bg-slate-100 px-1">invoices</code>, <code className="rounded bg-slate-100 px-1">receipts</code>, <code className="rounded bg-slate-100 px-1">receipt_allocations</code> and <code className="rounded bg-slate-100 px-1">customers</code> — nothing is hard-coded sample data.</li>
          <li><strong>Risk score</strong> is derived (overdue ratio 40% + historical payment delay 30% + credit-limit utilisation 30%), not a stored column.</li>
          <li><strong>Collection probability</strong> comes from each customer&apos;s historical on-time payment rate, penalised by days overdue.</li>
          <li><strong>DSO</strong> is a simplified estimate (outstanding ÷ total invoiced × dataset span in days) — not a rolling 12-month calculation.</li>
          <li><strong>Cash Position</strong> only reflects inflows: this schema has no bank balance or expense/payable data, so Opening Cash and Outflows are shown as ₹0 rather than guessed.</li>
          <li>Currency, business unit, company and salesperson filters are omitted — the dataset is single-currency, single-company, and has no such columns.</li>
          <li>Collector, remarks, and follow-up date are session-only notes typed into the Receivables table — they are not written back to Supabase.</li>
        </ul>
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="mb-2 text-sm font-semibold text-slate-900">Reset Session</h3>
        <p className="mb-3 text-sm text-slate-500">Clears every expected-amount/date edit, follow-up, collector, remark, the audit log, and the saved export schedule for this browser.</p>
        <button type="button" onClick={onReset} className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-100">
          Reset all session adjustments
        </button>
      </div>
    </div>
  );
}
