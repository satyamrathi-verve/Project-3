"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase, isConfigured } from "@/lib/supabase";
import { PageHeader } from "@/components/PageHeader";
import { NotConfigured } from "@/components/NotConfigured";
import {
  fillPlaceholders,
  formatDate,
  daysOverdue,
  formatCurrency,
  ageingBucket,
  AGEING_BUCKET_STYLES,
  templateForDays,
  type AgeingBucket,
} from "@/lib/reminderUtils";
import type { ReminderTemplate } from "@/lib/types";

const STATEMENT_LAST_RUN_KEY = "ar-manager-statement-last-run";
const RECENT_CHASE_DAYS = 3;

interface InvoiceLine {
  id: string;
  invoice_no: string;
  invoice_date: string;
  due_date: string;
  outstanding: number;
}

interface DueInvoice extends InvoiceLine {
  customer_id: string;
  customer_name: string;
  customer_email: string | null;
}

interface CustomerGroup {
  customer_id: string;
  customer_name: string;
  customer_email: string | null;
  invoices: InvoiceLine[];
  totalOutstanding: number;
  oldestDueDate: string;
  earliestInvoiceDate: string;
  oldestDaysOverdue: number;
  lastChasedAt: string | null;
  chaseCountOnLastDate: number;
}

interface HistoryRow {
  id: string;
  sent_at: string;
  customer_name: string;
  invoice_no: string;
  to_email: string | null;
  subject: string;
  status: string;
}

function wasChasedRecently(g: CustomerGroup) {
  if (!g.lastChasedAt) return false;
  return Date.now() - new Date(g.lastChasedAt).getTime() <= RECENT_CHASE_DAYS * 24 * 60 * 60 * 1000;
}

type SortKey = "customer" | "email" | "invoices" | "oldest" | "lastChased" | "outstanding";
type SortDir = "asc" | "desc";

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: "customer", label: "Customer" },
  { key: "email", label: "Email" },
  { key: "invoices", label: "Invoices" },
  { key: "oldest", label: "Oldest Overdue" },
  { key: "lastChased", label: "Last Chased" },
  { key: "outstanding", label: "Outstanding" },
];

function sortValue(g: CustomerGroup, key: SortKey): string | number {
  switch (key) {
    case "customer":
      return g.customer_name;
    case "email":
      return g.customer_email ?? "";
    case "invoices":
      return g.invoices.length;
    case "oldest":
      return g.oldestDaysOverdue;
    case "lastChased":
      return g.lastChasedAt ?? "";
    case "outstanding":
      return g.totalOutstanding;
  }
}

function filterText(g: CustomerGroup, key: SortKey): string {
  switch (key) {
    case "customer":
      return g.customer_name;
    case "email":
      return g.customer_email ?? "";
    case "invoices":
      return String(g.invoices.length);
    case "oldest":
      return String(g.oldestDaysOverdue);
    case "lastChased":
      return g.lastChasedAt ? formatDate(g.lastChasedAt) : "never";
    case "outstanding":
      return String(g.totalOutstanding);
  }
}

const AGE_RANGES: { label: string; test: (days: number) => boolean }[] = [
  { label: "Less than 15 days", test: (d) => d < 15 },
  { label: "15–30 days", test: (d) => d >= 15 && d < 30 },
  { label: "30–45 days", test: (d) => d >= 30 && d < 45 },
  { label: "45–60 days", test: (d) => d >= 45 && d < 60 },
  { label: "60–90 days", test: (d) => d >= 60 && d < 90 },
  { label: "Only 90+ days", test: (d) => d >= 90 },
];

function downloadCustomerCsv(g: CustomerGroup) {
  const header = "Invoice No,Invoice Date,Due Date,Outstanding\n";
  const rows = g.invoices
    .map((i) => `${i.invoice_no},${formatDate(i.invoice_date)},${formatDate(i.due_date)},${i.outstanding}`)
    .join("\n");
  const blob = new Blob([header + rows], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${g.customer_name.replace(/\s+/g, "_")}_overdue_invoices.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  return (
    <svg
      className={`h-3 w-3 ${active ? "text-brand" : "text-slate-400 dark:text-slate-500"}`}
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
    >
      {(!active || dir === "asc") && <path d="M10 5l4 5H6l4-5z" opacity={active && dir === "asc" ? 1 : 0.5} />}
      {(!active || dir === "desc") && (
        <path d="M10 15l-4-5h8l-4 5z" opacity={active && dir === "desc" ? 1 : 0.5} />
      )}
    </svg>
  );
}

function FilterIcon({ active }: { active: boolean }) {
  return (
    <svg
      className={`h-3 w-3 ${active ? "text-brand" : "text-slate-400 dark:text-slate-500"}`}
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M3 4a1 1 0 011-1h12a1 1 0 01.8 1.6l-4.8 6.13V16a1 1 0 01-1.45.9l-2-1A1 1 0 018 15v-4.27L3.2 4.6A1 1 0 013 4z" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path d="M10 3.5c-4.4 0-7.7 3.1-9 6.5 1.3 3.4 4.6 6.5 9 6.5s7.7-3.1 9-6.5c-1.3-3.4-4.6-6.5-9-6.5zm0 10.8a4.3 4.3 0 110-8.6 4.3 4.3 0 010 8.6zm0-1.6a2.7 2.7 0 100-5.4 2.7 2.7 0 000 5.4z" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path d="M10 3a1 1 0 011 1v7.59l2.3-2.3a1 1 0 111.4 1.42l-4 4a1 1 0 01-1.4 0l-4-4a1 1 0 111.4-1.42l2.3 2.3V4a1 1 0 011-1zM4 15a1 1 0 011 1v1h10v-1a1 1 0 112 0v1a2 2 0 01-2 2H5a2 2 0 01-2-2v-1a1 1 0 011-1z" />
    </svg>
  );
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg className={className ?? "h-4 w-4"} viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden="true">
      <circle cx="8.5" cy="8.5" r="5.5" strokeWidth="1.5" />
      <path d="M17 17l-4-4" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden="true">
      <path d="M5 5l10 10M15 5L5 15" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}

export default function AutoEmailShootPage() {
  const [loading, setLoading] = useState(true);
  const [templates, setTemplates] = useState<ReminderTemplate[]>([]);
  const [companyName, setCompanyName] = useState("Verve Advisory");
  const [customerGroups, setCustomerGroups] = useState<CustomerGroup[]>([]);
  const [allDueInvoices, setAllDueInvoices] = useState<DueInvoice[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sentMessage, setSentMessage] = useState<string | null>(null);
  const [runningStatement, setRunningStatement] = useState(false);
  const [statementLastRun, setStatementLastRun] = useState<string | null>(null);

  const [view, setView] = useState<"chase" | "history">("chase");
  const [historyRows, setHistoryRows] = useState<HistoryRow[]>([]);
  const [historyCustomerFilter, setHistoryCustomerFilter] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [columnFilters, setColumnFilters] = useState<Partial<Record<SortKey, Set<string>>>>({});
  const [openFilterColumn, setOpenFilterColumn] = useState<SortKey | null>(null);
  const [filterSearch, setFilterSearch] = useState("");

  async function loadData() {
    if (!isConfigured || !supabase) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const todayIso = new Date().toISOString().slice(0, 10);

    const [{ data: fetchedTemplates }, { data: company }, { data: rawInvoices }] = await Promise.all([
      supabase.from("reminder_templates").select("*").order("name"),
      supabase.from("company").select("name").limit(1).maybeSingle(),
      supabase
        .from("invoices")
        .select("id, invoice_no, invoice_date, due_date, total, customer_id, customers(name, email)")
        .neq("status", "paid")
        .order("due_date"),
    ]);

    const tmpls = (fetchedTemplates as ReminderTemplate[] | null) ?? [];
    setTemplates(tmpls);
    if (company?.name) setCompanyName(company.name);

    const invoiceRows = rawInvoices ?? [];
    const ids = invoiceRows.map((inv: any) => inv.id);

    const [{ data: allocations }, { data: logs }] = await Promise.all([
      ids.length
        ? supabase.from("receipt_allocations").select("invoice_id, amount").in("invoice_id", ids)
        : Promise.resolve({ data: [] as { invoice_id: string; amount: number }[] }),
      ids.length
        ? supabase.from("reminder_log").select("invoice_id, sent_at").in("invoice_id", ids)
        : Promise.resolve({ data: [] as { invoice_id: string; sent_at: string }[] }),
    ]);

    const allocatedByInvoice = new Map<string, number>();
    for (const a of allocations ?? []) {
      allocatedByInvoice.set(a.invoice_id, (allocatedByInvoice.get(a.invoice_id) ?? 0) + Number(a.amount));
    }

    const allDue: DueInvoice[] = invoiceRows
      .map((inv: any) => ({
        id: inv.id,
        invoice_no: inv.invoice_no,
        invoice_date: inv.invoice_date,
        due_date: inv.due_date,
        outstanding: Number(inv.total) - (allocatedByInvoice.get(inv.id) ?? 0),
        customer_id: inv.customer_id,
        customer_name: inv.customers?.name ?? "Unknown customer",
        customer_email: inv.customers?.email ?? null,
      }))
      .filter((inv) => inv.outstanding > 0);

    setAllDueInvoices(allDue);

    const overdue = allDue.filter((inv) => inv.due_date < todayIso);

    const invoiceToCustomer = new Map(overdue.map((inv) => [inv.id, inv.customer_id]));
    const logsByCustomer = new Map<string, string[]>();
    for (const l of logs ?? []) {
      const custId = invoiceToCustomer.get(l.invoice_id);
      if (!custId) continue;
      if (!logsByCustomer.has(custId)) logsByCustomer.set(custId, []);
      logsByCustomer.get(custId)!.push(l.sent_at);
    }

    const groupsMap = new Map<string, CustomerGroup>();
    for (const inv of overdue) {
      let g = groupsMap.get(inv.customer_id);
      if (!g) {
        g = {
          customer_id: inv.customer_id,
          customer_name: inv.customer_name,
          customer_email: inv.customer_email,
          invoices: [],
          totalOutstanding: 0,
          oldestDueDate: inv.due_date,
          earliestInvoiceDate: inv.invoice_date,
          oldestDaysOverdue: 0,
          lastChasedAt: null,
          chaseCountOnLastDate: 0,
        };
        groupsMap.set(inv.customer_id, g);
      }
      g.invoices.push({
        id: inv.id,
        invoice_no: inv.invoice_no,
        invoice_date: inv.invoice_date,
        due_date: inv.due_date,
        outstanding: inv.outstanding,
      });
      g.totalOutstanding += inv.outstanding;
      if (inv.due_date < g.oldestDueDate) g.oldestDueDate = inv.due_date;
      if (inv.invoice_date < g.earliestInvoiceDate) g.earliestInvoiceDate = inv.invoice_date;
    }

    const groups: CustomerGroup[] = Array.from(groupsMap.values())
      .map((g) => {
        const timestamps = logsByCustomer.get(g.customer_id) ?? [];
        let lastChasedAt: string | null = null;
        for (const t of timestamps) if (!lastChasedAt || t > lastChasedAt) lastChasedAt = t;
        const chaseCountOnLastDate = lastChasedAt
          ? timestamps.filter((t) => t.slice(0, 10) === lastChasedAt!.slice(0, 10)).length
          : 0;
        return { ...g, oldestDaysOverdue: daysOverdue(g.oldestDueDate), lastChasedAt, chaseCountOnLastDate };
      })
      .sort((a, b) => b.oldestDaysOverdue - a.oldestDaysOverdue);

    setCustomerGroups(groups);
    setSelectedIds(
      new Set(groups.filter((g) => g.customer_email && !wasChasedRecently(g)).map((g) => g.customer_id))
    );
    setLoading(false);
  }

  useEffect(() => {
    loadData();
    setStatementLastRun(localStorage.getItem(STATEMENT_LAST_RUN_KEY));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadHistory() {
    if (!supabase) return;
    setHistoryLoading(true);
    const { data } = await supabase
      .from("reminder_log")
      .select("id, to_email, subject, status, sent_at, invoices(invoice_no, customers(name))")
      .order("sent_at", { ascending: false })
      .limit(200);
    setHistoryRows(
      (data ?? []).map((r: any) => ({
        id: r.id,
        sent_at: r.sent_at,
        customer_name: r.invoices?.customers?.name ?? "Unknown customer",
        invoice_no: r.invoices?.invoice_no ?? "Unknown invoice",
        to_email: r.to_email,
        subject: r.subject,
        status: r.status,
      }))
    );
    setHistoryLoading(false);
  }

  function openHistory() {
    setHistoryCustomerFilter(null);
    setView("history");
    loadHistory();
  }

  function openHistoryForCustomer(name: string) {
    setHistoryCustomerFilter(name);
    setView("history");
    loadHistory();
  }

  const visibleHistoryRows = historyCustomerFilter
    ? historyRows.filter((r) => r.customer_name === historyCustomerFilter)
    : historyRows;

  function toggleOne(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllSendable() {
    setSelectedIds(new Set(customerGroups.filter((g) => g.customer_email).map((g) => g.customer_id)));
  }
  function selectByAgeRange(label: string) {
    const range = AGE_RANGES.find((r) => r.label === label);
    if (!range) return;
    setSelectedIds(
      new Set(
        customerGroups.filter((g) => g.customer_email && range.test(g.oldestDaysOverdue)).map((g) => g.customer_id)
      )
    );
  }
  function selectOnlyNeverChased() {
    setSelectedIds(
      new Set(customerGroups.filter((g) => g.customer_email && !g.lastChasedAt).map((g) => g.customer_id))
    );
  }
  function clearSelection() {
    setSelectedIds(new Set());
  }

  const totalOutstanding = useMemo(
    () => customerGroups.reduce((sum, g) => sum + g.totalOutstanding, 0),
    [customerGroups]
  );
  const totalInvoices = useMemo(
    () => customerGroups.reduce((sum, g) => sum + g.invoices.length, 0),
    [customerGroups]
  );
  const selectedOutstanding = useMemo(
    () =>
      customerGroups
        .filter((g) => selectedIds.has(g.customer_id))
        .reduce((sum, g) => sum + g.totalOutstanding, 0),
    [customerGroups, selectedIds]
  );
  const recentlyChasedCount = useMemo(
    () => customerGroups.filter((g) => wasChasedRecently(g)).length,
    [customerGroups]
  );
  const customersWithDuesCount = useMemo(
    () => new Set(allDueInvoices.filter((inv) => inv.customer_email).map((inv) => inv.customer_id)).size,
    [allDueInvoices]
  );

  function toggleSort(key: SortKey) {
    if (sortKey !== key) {
      setSortKey(key);
      setSortDir("asc");
    } else if (sortDir === "asc") {
      setSortDir("desc");
    } else {
      setSortKey(null);
    }
  }

  function uniqueValuesFor(key: SortKey): string[] {
    return Array.from(new Set(customerGroups.map((g) => filterText(g, key)))).sort();
  }

  function toggleFilterValue(key: SortKey, value: string) {
    setColumnFilters((prev) => {
      const current = prev[key] ?? new Set(uniqueValuesFor(key));
      const next = new Set(current);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return { ...prev, [key]: next };
    });
  }

  function selectAllForColumn(key: SortKey) {
    setColumnFilters((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  function clearColumnFilter(key: SortKey) {
    setColumnFilters((prev) => ({ ...prev, [key]: new Set() }));
  }

  const visibleGroups = useMemo(() => {
    let rows = customerGroups.filter((g) =>
      COLUMNS.every((c) => {
        const selected = columnFilters[c.key];
        if (!selected) return true;
        return selected.has(filterText(g, c.key));
      })
    );
    if (sortKey) {
      rows = [...rows].sort((a, b) => {
        const av = sortValue(a, sortKey);
        const bv = sortValue(b, sortKey);
        const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
        return sortDir === "asc" ? cmp : -cmp;
      });
    }
    return rows;
  }, [customerGroups, columnFilters, sortKey, sortDir]);

  function buildCustomerSample(g: CustomerGroup) {
    return {
      customer: g.customer_name,
      amount: formatCurrency(g.totalOutstanding),
      days_overdue: String(g.oldestDaysOverdue),
      invoice_no: g.invoices.map((i) => i.invoice_no).join(", "),
      invoice_date: formatDate(g.earliestInvoiceDate),
      due_date: formatDate(g.oldestDueDate),
      company_name: companyName,
      payment_link: `https://pay.example.com/${g.invoices[0].invoice_no.toLowerCase()}`,
    };
  }

  function templateFor(g: CustomerGroup) {
    return templateForDays(templates, g.oldestDaysOverdue);
  }

  function previewFor(g: CustomerGroup) {
    const tmpl = templateFor(g);
    if (!tmpl) return { subject: "", body: "" };
    const sample = buildCustomerSample(g);
    return {
      subject: fillPlaceholders(tmpl.subject, sample),
      body: fillPlaceholders(tmpl.body, sample),
    };
  }

  async function handleSendAll() {
    if (!supabase || templates.length === 0) return;
    const toSend = customerGroups.filter((g) => selectedIds.has(g.customer_id) && g.customer_email);
    if (toSend.length === 0) return;

    setSending(true);
    setSentMessage(null);
    const nowIso = new Date().toISOString();
    const rows: any[] = [];
    for (const g of toSend) {
      const { subject, body } = previewFor(g);
      for (const inv of g.invoices) {
        rows.push({
          invoice_id: inv.id,
          to_email: g.customer_email as string,
          subject,
          body,
          status: "sent",
          sent_at: nowIso,
        });
      }
    }

    const { error } = await supabase.from("reminder_log").insert(rows);
    setSending(false);
    if (!error) {
      setSentMessage(
        `Sent ${toSend.length} email${toSend.length === 1 ? "" : "s"} covering ${rows.length} invoice${
          rows.length === 1 ? "" : "s"
        }.`
      );
      loadData();
    }
  }

  async function handleRunStatementShoot() {
    if (!supabase) return;
    const byCustomer = new Map<string, DueInvoice[]>();
    for (const inv of allDueInvoices) {
      if (!inv.customer_email) continue;
      if (!byCustomer.has(inv.customer_id)) byCustomer.set(inv.customer_id, []);
      byCustomer.get(inv.customer_id)!.push(inv);
    }
    if (byCustomer.size === 0) return;

    setRunningStatement(true);
    const nowIso = new Date().toISOString();
    const monthLabel = new Date().toLocaleDateString("en-IN", { month: "long", year: "numeric" });
    const rows: any[] = [];
    for (const invs of byCustomer.values()) {
      const total = invs.reduce((s, i) => s + i.outstanding, 0);
      const subject = `Your account statement — ${monthLabel}`;
      const body = `Dear ${invs[0].customer_name},\n\nHere is a summary of your account with ${companyName} as of today:\n\nOutstanding invoices: ${invs
        .map((i) => i.invoice_no)
        .join(", ")}\nTotal outstanding: ${formatCurrency(total)}\n\nRegards,\n${companyName}`;
      for (const inv of invs) {
        rows.push({ invoice_id: inv.id, to_email: inv.customer_email, subject, body, status: "sent", sent_at: nowIso });
      }
    }

    const { error } = await supabase.from("reminder_log").insert(rows);
    setRunningStatement(false);
    if (!error) {
      localStorage.setItem(STATEMENT_LAST_RUN_KEY, nowIso);
      setStatementLastRun(nowIso);
      setSentMessage(`Statement shoot sent to ${byCustomer.size} customer${byCustomer.size === 1 ? "" : "s"}.`);
      loadData();
    }
  }

  if (!isConfigured) {
    return (
      <>
        <PageHeader title="Auto Email Shoot" subtitle="Chase everyone who's overdue, in one go." />
        <NotConfigured />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Auto Email Shoot"
        subtitle={
          view === "chase"
            ? "One email per overdue customer, covering all their overdue invoices. Click a row to view invoices."
            : historyCustomerFilter
              ? `Every reminder sent to ${historyCustomerFilter}, newest first.`
              : "Every reminder ever logged, newest first."
        }
        action={
          view === "chase" ? (
            <div className="flex gap-2">
              <button
                onClick={openHistory}
                className="rounded-lg border border-slate-300 bg-cream px-4 py-2 text-sm font-medium text-slate-700 hover:bg-cream-dim dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                Sent history
              </button>
              <button
                onClick={handleSendAll}
                disabled={sending || selectedIds.size === 0 || templates.length === 0}
                className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50"
              >
                {sending
                  ? "Sending…"
                  : `Send ${selectedIds.size} email${selectedIds.size === 1 ? "" : "s"}`}
              </button>
            </div>
          ) : (
            <button
              onClick={() => setView("chase")}
              className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark"
            >
              ← Back
            </button>
          )
        }
      />

      {view === "history" ? (
        historyLoading ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">Loading sent history…</p>
        ) : (
          <>
            {historyCustomerFilter && (
              <p className="mb-4 flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                Filtered to{" "}
                <span className="font-semibold text-slate-900 dark:text-white">
                  {historyCustomerFilter}
                </span>
                <button
                  type="button"
                  onClick={() => setHistoryCustomerFilter(null)}
                  className="font-medium text-brand hover:underline"
                >
                  Show all customers
                </button>
              </p>
            )}
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-cream dark:border-slate-800 dark:bg-slate-900">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-cream-dim text-left dark:border-slate-800 dark:bg-slate-800">
                  <th className="px-4 py-3 font-semibold text-slate-600 dark:text-slate-300">Sent</th>
                  <th className="px-4 py-3 font-semibold text-slate-600 dark:text-slate-300">Customer</th>
                  <th className="px-4 py-3 font-semibold text-slate-600 dark:text-slate-300">Invoice</th>
                  <th className="px-4 py-3 font-semibold text-slate-600 dark:text-slate-300">Email</th>
                  <th className="px-4 py-3 font-semibold text-slate-600 dark:text-slate-300">Subject</th>
                  <th className="px-4 py-3 font-semibold text-slate-600 dark:text-slate-300">Status</th>
                </tr>
              </thead>
              <tbody>
                {visibleHistoryRows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-slate-400 dark:text-slate-600">
                      {historyCustomerFilter ? "Nothing sent to this customer yet." : "Nothing sent yet."}
                    </td>
                  </tr>
                ) : (
                  visibleHistoryRows.map((r) => (
                    <tr
                      key={r.id}
                      className="border-b border-slate-100 last:border-0 hover:bg-cream-dim dark:border-slate-800 dark:hover:bg-slate-800"
                    >
                      <td className="px-4 py-3 text-slate-500 dark:text-slate-400">
                        {new Date(r.sent_at).toLocaleString("en-IN")}
                      </td>
                      <td className="px-4 py-3 font-medium text-slate-800 dark:text-slate-100">
                        {r.customer_name}
                      </td>
                      <td className="px-4 py-3 text-slate-700 dark:text-slate-300">{r.invoice_no}</td>
                      <td className="px-4 py-3 text-slate-700 dark:text-slate-300">{r.to_email ?? "—"}</td>
                      <td className="px-4 py-3 text-slate-700 dark:text-slate-300">{r.subject}</td>
                      <td className="px-4 py-3">
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                          {r.status}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            </div>
          </>
        )
      ) : loading ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">Loading overdue invoices…</p>
      ) : templates.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          No reminder templates found —{" "}
          <Link href="/reminders" className="text-brand hover:underline">
            build the Reminder Template screen first
          </Link>
          .
        </p>
      ) : (
        <>
          <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
            Each customer gets the reminder tuned to how overdue they are — mild at 0–30 days,
            escalating up to a final notice past 90 —{" "}
            <Link href="/reminders" className="font-medium text-brand hover:underline">
              edit those templates here
            </Link>
            .
          </p>

          <div className="mb-4 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-cream p-4 dark:border-slate-800 dark:bg-slate-900">
            <div>
              <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                Monthly statement shoot
              </h3>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Every customer with dues gets their account statement automatically on the first
                visit each month.{" "}
                <span className="text-slate-400 dark:text-slate-500">
                  Last ran:{" "}
                  {statementLastRun
                    ? new Date(statementLastRun).toLocaleDateString("en-IN", {
                        month: "long",
                        year: "numeric",
                      })
                    : "Never"}{" "}
                  · {customersWithDuesCount} customer{customersWithDuesCount === 1 ? "" : "s"} with
                  dues right now
                </span>
              </p>
            </div>
            <button
              onClick={handleRunStatementShoot}
              disabled={runningStatement || customersWithDuesCount === 0}
              className="flex-none rounded-lg border border-brand bg-brand/10 px-4 py-2 text-sm font-medium text-brand-dark hover:bg-brand/20 disabled:opacity-50 dark:border-brand dark:bg-brand/20 dark:text-blue-300"
            >
              {runningStatement ? "Running…" : "Run now"}
            </button>
          </div>

          {sentMessage && (
            <p className="mb-4 text-sm text-emerald-600 dark:text-emerald-400">{sentMessage}</p>
          )}

          {customerGroups.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-cream p-6 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
              Nothing overdue right now — every invoice is either paid or not yet due.
            </div>
          ) : (
            <>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-cream p-4 dark:border-slate-800 dark:bg-slate-900">
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  <span className="font-semibold text-slate-900 dark:text-white">
                    {customerGroups.length}
                  </span>{" "}
                  customer{customerGroups.length === 1 ? "" : "s"} ·{" "}
                  <span className="font-semibold text-slate-900 dark:text-white">{totalInvoices}</span>{" "}
                  overdue invoice{totalInvoices === 1 ? "" : "s"} ·{" "}
                  <span className="font-semibold text-slate-900 dark:text-white">
                    {formatCurrency(totalOutstanding)}
                  </span>{" "}
                  total outstanding ·{" "}
                  <span className="font-semibold text-slate-900 dark:text-white">
                    {selectedIds.size}
                  </span>{" "}
                  selected · {formatCurrency(selectedOutstanding)}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
                    Quick select:
                  </span>
                  <button
                    onClick={selectAllSendable}
                    className="rounded-lg border border-slate-300 bg-cream px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-cream-dim dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                  >
                    Select all
                  </button>
                  <select
                    value=""
                    onChange={(e) => {
                      if (e.target.value) selectByAgeRange(e.target.value);
                      e.target.value = "";
                    }}
                    className="rounded-lg border border-slate-300 bg-cream px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-cream-dim dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                  >
                    <option value="" disabled>
                      By age range…
                    </option>
                    {AGE_RANGES.map((r) => (
                      <option key={r.label} value={r.label}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={selectOnlyNeverChased}
                    className="rounded-lg border border-slate-300 bg-cream px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-cream-dim dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                  >
                    Only never chased
                  </button>
                  <button
                    onClick={clearSelection}
                    className="rounded-lg border border-slate-300 bg-cream px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-cream-dim dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                  >
                    Clear
                  </button>
                </div>
              </div>

              <div className="mb-4 flex flex-wrap items-center gap-4 text-xs text-slate-500 dark:text-slate-400">
                <span className="font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
                  Ageing:
                </span>
                {(Object.keys(AGEING_BUCKET_STYLES) as AgeingBucket[]).map((bucket) => (
                  <span key={bucket} className="flex items-center gap-1.5">
                    <span className={`h-2.5 w-2.5 rounded-full ${AGEING_BUCKET_STYLES[bucket].dot}`} />
                    {AGEING_BUCKET_STYLES[bucket].label}
                  </span>
                ))}
              </div>

              {recentlyChasedCount > 0 && (
                <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
                  {recentlyChasedCount} customer{recentlyChasedCount === 1 ? " was" : "s were"} chased in
                  the last {RECENT_CHASE_DAYS} days, so {recentlyChasedCount === 1 ? "it's" : "they're"}{" "}
                  left unticked to avoid spamming. Use <span className="font-medium">Select all</span> to
                  include {recentlyChasedCount === 1 ? "it" : "them"} anyway.
                </p>
              )}

              <div className="overflow-x-auto rounded-xl border border-slate-200 bg-cream shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b-2 border-brand/30 bg-brand/10 text-left dark:border-brand/40 dark:bg-brand/20">
                      <th className="w-10 px-4 py-3" />
                      {COLUMNS.map((c) => (
                        <th key={c.key} className="relative whitespace-nowrap px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => toggleSort(c.key)}
                              className="flex items-center gap-1 text-xs font-bold uppercase tracking-wide text-brand-dark hover:underline dark:text-blue-300"
                            >
                              {c.label}
                              <SortIcon active={sortKey === c.key} dir={sortDir} />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setFilterSearch("");
                                setOpenFilterColumn(openFilterColumn === c.key ? null : c.key);
                              }}
                              title={`Filter ${c.label}`}
                            >
                              <FilterIcon
                                active={Boolean(
                                  columnFilters[c.key] && columnFilters[c.key]!.size < uniqueValuesFor(c.key).length
                                )}
                              />
                            </button>
                          </div>
                          {openFilterColumn === c.key &&
                            (() => {
                              const allValues = uniqueValuesFor(c.key);
                              const selected = columnFilters[c.key] ?? new Set(allValues);
                              const q = filterSearch.trim().toLowerCase();
                              const shownValues = q
                                ? allValues.filter((v) => v.toLowerCase().includes(q))
                                : allValues;
                              return (
                                <div
                                  onClick={(e) => e.stopPropagation()}
                                  className="absolute left-0 z-20 mt-2 w-64 rounded-lg border border-slate-200 bg-cream p-3 normal-case shadow-lg dark:border-slate-700 dark:bg-slate-800"
                                >
                                  <div className="flex items-center justify-between">
                                    <div className="relative flex-1">
                                      <input
                                        autoFocus
                                        value={filterSearch}
                                        onChange={(e) => setFilterSearch(e.target.value)}
                                        placeholder="Search…"
                                        className="w-full rounded border border-slate-300 py-1.5 pl-2 pr-7 text-xs font-normal text-slate-700 outline-none focus:border-brand dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
                                      />
                                      <SearchIcon className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() => setOpenFilterColumn(null)}
                                      title="Close"
                                      className="ml-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                                    >
                                      <CloseIcon />
                                    </button>
                                  </div>
                                  <div className="mt-2 flex items-center justify-between text-xs">
                                    <div className="flex gap-2">
                                      <button
                                        type="button"
                                        onClick={() => selectAllForColumn(c.key)}
                                        className="font-medium text-brand hover:underline"
                                      >
                                        Select all {allValues.length}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => clearColumnFilter(c.key)}
                                        className="font-medium text-slate-500 hover:underline dark:text-slate-400"
                                      >
                                        Clear
                                      </button>
                                    </div>
                                    <span className="text-slate-400 dark:text-slate-500">
                                      Displaying {visibleGroups.length}
                                    </span>
                                  </div>
                                  <div className="mt-2 max-h-48 overflow-y-auto">
                                    {shownValues.length === 0 ? (
                                      <p className="px-1 py-2 text-xs text-slate-400 dark:text-slate-500">
                                        No matches.
                                      </p>
                                    ) : (
                                      shownValues.map((v) => (
                                        <label
                                          key={v}
                                          className="flex cursor-pointer items-center gap-2 rounded px-1 py-1.5 text-xs font-normal text-slate-700 hover:bg-cream-dim dark:text-slate-200 dark:hover:bg-slate-700"
                                        >
                                          <input
                                            type="checkbox"
                                            checked={selected.has(v)}
                                            onChange={() => toggleFilterValue(c.key, v)}
                                            className="h-3.5 w-3.5 accent-brand"
                                          />
                                          {v || <span className="italic text-slate-400">(empty)</span>}
                                        </label>
                                      ))
                                    )}
                                  </div>
                                </div>
                              );
                            })()}
                        </th>
                      ))}
                      <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wide text-brand-dark dark:text-blue-300">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleGroups.length === 0 ? (
                      <tr>
                        <td colSpan={COLUMNS.length + 2} className="px-4 py-10 text-center text-slate-400 dark:text-slate-600">
                          No customers match these filters.
                        </td>
                      </tr>
                    ) : (
                      visibleGroups.map((g, i) => {
                        const bucket = ageingBucket(g.oldestDaysOverdue);
                        const styles = AGEING_BUCKET_STYLES[bucket];
                        const expanded = expandedId === g.customer_id;
                        return (
                          <Fragment key={g.customer_id}>
                            <tr
                              onClick={() => setExpandedId(expanded ? null : g.customer_id)}
                              className={`cursor-pointer border-b border-slate-100 transition-colors last:border-0 hover:bg-brand/5 dark:border-slate-800 dark:hover:bg-slate-800 ${
                                i % 2 === 1 ? "bg-cream-dim/70 dark:bg-slate-900/60" : "dark:bg-slate-900"
                              }`}
                            >
                              <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                                <input
                                  type="checkbox"
                                  checked={selectedIds.has(g.customer_id)}
                                  disabled={!g.customer_email}
                                  onChange={() => toggleOne(g.customer_id)}
                                  className="h-4 w-4 accent-brand"
                                />
                              </td>
                              <td className="whitespace-nowrap px-4 py-3 font-medium text-slate-900 dark:text-white">
                                <button
                                  type="button"
                                  title={`View email history for ${g.customer_name}`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openHistoryForCustomer(g.customer_name);
                                  }}
                                  className="text-left hover:text-brand hover:underline"
                                >
                                  {g.customer_name}
                                </button>
                              </td>
                              <td className="whitespace-nowrap px-4 py-3 text-slate-700 dark:text-slate-300">
                                {g.customer_email ?? (
                                  <span className="text-amber-600 dark:text-amber-400">No email on file</span>
                                )}
                              </td>
                              <td className="whitespace-nowrap px-4 py-3 text-slate-700 dark:text-slate-300">
                                {g.invoices.length} invoice{g.invoices.length === 1 ? "" : "s"}
                              </td>
                              <td className="whitespace-nowrap px-4 py-3">
                                <span
                                  className={`rounded-full px-2.5 py-1 text-xs font-semibold ${styles.badge}`}
                                >
                                  {g.oldestDaysOverdue}d
                                </span>
                              </td>
                              <td className="whitespace-nowrap px-4 py-3 text-slate-700 dark:text-slate-300">
                                {g.lastChasedAt ? (
                                  <>
                                    {formatDate(g.lastChasedAt)}{" "}
                                    <span className="text-slate-400 dark:text-slate-500">
                                      ·×{g.chaseCountOnLastDate}
                                    </span>
                                  </>
                                ) : (
                                  <span className="text-slate-400 dark:text-slate-500">Never</span>
                                )}
                              </td>
                              <td className="whitespace-nowrap px-4 py-3 font-medium text-slate-900 dark:text-white">
                                {formatCurrency(g.totalOutstanding)}
                              </td>
                              <td className="whitespace-nowrap px-4 py-3">
                                <div className="flex items-center justify-end gap-2">
                                  <button
                                    type="button"
                                    title="View invoices"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setExpandedId(expanded ? null : g.customer_id);
                                    }}
                                    className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-brand dark:text-slate-400 dark:hover:bg-slate-700"
                                  >
                                    <EyeIcon />
                                  </button>
                                  <button
                                    type="button"
                                    title="Download overdue invoices (CSV)"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      downloadCustomerCsv(g);
                                    }}
                                    className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-brand dark:text-slate-400 dark:hover:bg-slate-700"
                                  >
                                    <DownloadIcon />
                                  </button>
                                </div>
                              </td>
                            </tr>
                            {expanded && (
                              <tr className="border-b border-slate-100 dark:border-slate-800">
                                <td colSpan={COLUMNS.length + 2} className="bg-cream-dim px-4 py-4 dark:bg-slate-800">
                                  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
                                    Overdue invoices for {g.customer_name}
                                  </p>
                                  <div className="overflow-hidden rounded-lg border border-slate-200 bg-cream dark:border-slate-700 dark:bg-slate-900">
                                    <table className="w-full text-sm">
                                      <thead>
                                        <tr className="border-b border-slate-200 bg-slate-100 text-left dark:border-slate-700 dark:bg-slate-800">
                                          <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                            Invoice No.
                                          </th>
                                          <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                            Invoice Date
                                          </th>
                                          <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                            Due Date
                                          </th>
                                          <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                            Outstanding
                                          </th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {g.invoices.map((inv) => (
                                          <tr
                                            key={inv.id}
                                            className="border-b border-slate-100 last:border-0 dark:border-slate-800"
                                          >
                                            <td className="px-3 py-2 font-medium text-slate-800 dark:text-slate-100">
                                              {inv.invoice_no}
                                            </td>
                                            <td className="px-3 py-2 text-slate-600 dark:text-slate-300">
                                              {formatDate(inv.invoice_date)}
                                            </td>
                                            <td className="px-3 py-2 text-slate-600 dark:text-slate-300">
                                              {formatDate(inv.due_date)}
                                            </td>
                                            <td className="px-3 py-2 text-right font-medium text-slate-800 dark:text-slate-100">
                                              {formatCurrency(inv.outstanding)}
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}
