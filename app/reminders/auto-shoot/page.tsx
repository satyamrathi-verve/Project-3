"use client";

import { useEffect, useMemo, useState } from "react";
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

export default function AutoEmailShootPage() {
  const [loading, setLoading] = useState(true);
  const [template, setTemplate] = useState<ReminderTemplate | null>(null);
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
  const [historyLoading, setHistoryLoading] = useState(false);

  async function loadData() {
    if (!isConfigured || !supabase) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const todayIso = new Date().toISOString().slice(0, 10);

    const [{ data: templates }, { data: company }, { data: rawInvoices }] = await Promise.all([
      supabase.from("reminder_templates").select("*").order("name").limit(1),
      supabase.from("company").select("name").limit(1).maybeSingle(),
      supabase
        .from("invoices")
        .select("id, invoice_no, invoice_date, due_date, total, customer_id, customers(name, email)")
        .neq("status", "paid")
        .order("due_date"),
    ]);

    const tmpl = (templates as ReminderTemplate[] | null)?.[0] ?? null;
    setTemplate(tmpl);
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
    setView("history");
    loadHistory();
  }

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
  function selectOnly90Plus() {
    setSelectedIds(
      new Set(
        customerGroups.filter((g) => g.customer_email && g.oldestDaysOverdue >= 90).map((g) => g.customer_id)
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

  function previewFor(g: CustomerGroup) {
    if (!template) return { subject: "", body: "" };
    const sample = buildCustomerSample(g);
    return {
      subject: fillPlaceholders(template.subject, sample),
      body: fillPlaceholders(template.body, sample),
    };
  }

  async function handleSendAll() {
    if (!supabase || !template) return;
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
            ? "One email per overdue customer, covering all their overdue invoices. Click a row to preview."
            : "Every reminder ever logged, newest first."
        }
        action={
          view === "chase" ? (
            <div className="flex gap-2">
              <button
                onClick={openHistory}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                Sent history
              </button>
              <button
                onClick={handleSendAll}
                disabled={sending || selectedIds.size === 0 || !template}
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
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left dark:border-slate-800 dark:bg-slate-800">
                  <th className="px-4 py-3 font-semibold text-slate-600 dark:text-slate-300">Sent</th>
                  <th className="px-4 py-3 font-semibold text-slate-600 dark:text-slate-300">Customer</th>
                  <th className="px-4 py-3 font-semibold text-slate-600 dark:text-slate-300">Invoice</th>
                  <th className="px-4 py-3 font-semibold text-slate-600 dark:text-slate-300">Email</th>
                  <th className="px-4 py-3 font-semibold text-slate-600 dark:text-slate-300">Subject</th>
                  <th className="px-4 py-3 font-semibold text-slate-600 dark:text-slate-300">Status</th>
                </tr>
              </thead>
              <tbody>
                {historyRows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-slate-400 dark:text-slate-600">
                      Nothing sent yet.
                    </td>
                  </tr>
                ) : (
                  historyRows.map((r) => (
                    <tr
                      key={r.id}
                      className="border-b border-slate-100 last:border-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800"
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
        )
      ) : loading ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">Loading overdue invoices…</p>
      ) : !template ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          No reminder template found —{" "}
          <Link href="/reminders" className="text-brand hover:underline">
            build the Reminder Template screen first
          </Link>
          .
        </p>
      ) : (
        <>
          <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
            Emails are generated from your saved Reminder Template —{" "}
            <Link href="/reminders" className="font-medium text-brand hover:underline">
              edit it here
            </Link>
            .
          </p>

          <div className="mb-4 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
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
            <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
              Nothing overdue right now — every invoice is either paid or not yet due.
            </div>
          ) : (
            <>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
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
                    className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                  >
                    Select all
                  </button>
                  <button
                    onClick={selectOnly90Plus}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                  >
                    Only 90+ days
                  </button>
                  <button
                    onClick={selectOnlyNeverChased}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                  >
                    Only never chased
                  </button>
                  <button
                    onClick={clearSelection}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
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

              <div className="flex flex-col gap-3">
                {customerGroups.map((g) => {
                  const bucket = ageingBucket(g.oldestDaysOverdue);
                  const styles = AGEING_BUCKET_STYLES[bucket];
                  const expanded = expandedId === g.customer_id;
                  const preview = expanded ? previewFor(g) : null;
                  return (
                    <div
                      key={g.customer_id}
                      onClick={() => setExpandedId(expanded ? null : g.customer_id)}
                      className="cursor-pointer rounded-lg border border-slate-200 bg-white p-4 hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700"
                    >
                      <div className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(g.customer_id)}
                          disabled={!g.customer_email}
                          onClick={(e) => e.stopPropagation()}
                          onChange={() => toggleOne(g.customer_id)}
                          className="mt-1 h-4 w-4 flex-none accent-brand"
                        />
                        <div className="flex-1">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <p className="font-semibold text-slate-900 dark:text-white">
                                {g.customer_name}
                              </p>
                              <p className="text-xs text-slate-400 dark:text-slate-500">
                                {g.customer_email ?? (
                                  <span className="text-amber-600 dark:text-amber-400">
                                    No email on file
                                  </span>
                                )}
                              </p>
                              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                                {g.invoices.length} invoice{g.invoices.length === 1 ? "" : "s"}
                              </p>
                            </div>
                            <div className="flex flex-none flex-col items-end gap-1">
                              <span
                                className={`rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-wide ${styles.badge}`}
                              >
                                {g.oldestDaysOverdue} days overdue
                              </span>
                              <span className="text-xs text-slate-400 dark:text-slate-500">
                                {g.lastChasedAt
                                  ? `Reminded ${formatDate(g.lastChasedAt)} · ×${g.chaseCountOnLastDate}`
                                  : "Never reminded"}
                              </span>
                            </div>
                          </div>
                          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                            Due Date: {formatDate(g.oldestDueDate)}
                          </p>
                          <p className="text-sm text-slate-500 dark:text-slate-400">
                            Outstanding: {formatCurrency(g.totalOutstanding)}
                          </p>
                        </div>
                      </div>

                      {expanded && preview && (
                        <div
                          onClick={(e) => e.stopPropagation()}
                          className="mt-4 cursor-default rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800"
                        >
                          <p className="text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
                            To
                          </p>
                          <p className="mt-1 text-sm font-medium text-slate-800 dark:text-slate-100">
                            {g.customer_email ?? "No email on file"}
                          </p>
                          <p className="mt-3 text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
                            Subject
                          </p>
                          <p className="mt-1 text-sm font-medium text-slate-800 dark:text-slate-100">
                            {preview.subject}
                          </p>
                          <p className="mt-3 text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
                            Body
                          </p>
                          <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-300">
                            {preview.body}
                          </p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}
