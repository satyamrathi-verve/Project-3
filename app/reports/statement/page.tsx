"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { supabase, isConfigured } from "@/lib/supabase";
import type { Company, Customer, Invoice, Receipt } from "@/lib/types";
import { money, todayStr } from "@/lib/format";
import { PageHeader } from "@/components/PageHeader";
import { NotConfigured } from "@/components/NotConfigured";
import { FormField, inputClass } from "@/components/FormField";
import { TableSkeleton } from "@/components/Skeleton";
import { ExportCsvButton, type CsvColumn } from "@/components/ExportCsvButton";
import { CustomerSelector } from "@/components/receipts/CustomerSelector";

type LedgerRow = {
  date: string;
  kind: "opening" | "invoice" | "receipt";
  label: string;
  detailLines: string[];
  debit: number;
  credit: number;
  balance: number;
};

type Preset = "this_month" | "last_month" | "this_quarter" | "this_year" | "all_time" | "custom";

function pad(n: number) {
  return String(n).padStart(2, "0");
}
function iso(y: number, m: number, d: number) {
  return `${y}-${pad(m)}-${pad(d)}`;
}
function lastDayOfMonth(y: number, m: number) {
  return new Date(y, m, 0).getDate();
}

function rangeForPreset(preset: Preset, customFrom: string, customTo: string) {
  const today = new Date(todayStr());
  const y = today.getFullYear();
  const m = today.getMonth() + 1;

  switch (preset) {
    case "this_month":
      return { from: iso(y, m, 1), to: iso(y, m, lastDayOfMonth(y, m)) };
    case "last_month": {
      const lm = m === 1 ? 12 : m - 1;
      const ly = m === 1 ? y - 1 : y;
      return { from: iso(ly, lm, 1), to: iso(ly, lm, lastDayOfMonth(ly, lm)) };
    }
    case "this_quarter": {
      const qStartMonth = Math.floor((m - 1) / 3) * 3 + 1;
      return { from: iso(y, qStartMonth, 1), to: iso(y, qStartMonth + 2, lastDayOfMonth(y, qStartMonth + 2)) };
    }
    case "this_year":
      return { from: iso(y, 1, 1), to: iso(y, 12, 31) };
    case "all_time":
      return { from: "2000-01-01", to: todayStr() };
    case "custom":
      return { from: customFrom || todayStr(), to: customTo || todayStr() };
  }
}

function buildStatement(
  customer: Customer,
  invoices: Invoice[],
  receipts: Receipt[],
  allocDetailsByReceipt: Map<string, { invoice_no: string; amount: number }[]>,
  from: string,
  to: string
) {
  const before = (d: string) => d < from;
  const inRange = (d: string) => d >= from && d <= to;

  const openingDebits = invoices.filter((i) => before(i.invoice_date)).reduce((s, i) => s + Number(i.total), 0);
  const openingCredits = receipts.filter((r) => before(r.receipt_date)).reduce((s, r) => s + Number(r.amount), 0);
  const openingBalance = Number(customer.opening_balance) + openingDebits - openingCredits;

  const invoiceRows = invoices
    .filter((i) => inRange(i.invoice_date))
    .map((i) => ({
      date: i.invoice_date,
      kind: "invoice" as const,
      label: i.invoice_no,
      detailLines: [`Due on ${i.due_date}`],
      debit: Number(i.total),
      credit: 0,
    }));

  const receiptRows = receipts
    .filter((r) => inRange(r.receipt_date))
    .map((r) => {
      const allocs = allocDetailsByReceipt.get(r.id) ?? [];
      const allocatedSum = allocs.reduce((s, a) => s + a.amount, 0);
      const detailLines = allocs.map((a) => `${money(a.amount)} for payment of ${a.invoice_no}`);
      const unapplied = Number(r.amount) - allocatedSum;
      if (unapplied > 0.005) detailLines.push(`${money(unapplied)} on account (unapplied)`);
      return {
        date: r.receipt_date,
        kind: "receipt" as const,
        label: r.receipt_no,
        detailLines: detailLines.length > 0 ? detailLines : ["On account (unapplied)"],
        debit: 0,
        credit: Number(r.amount),
      };
    });

  const rows = [...invoiceRows, ...receiptRows].sort((a, b) =>
    a.date === b.date ? (a.kind === "invoice" ? -1 : 1) : a.date.localeCompare(b.date)
  );

  let running = openingBalance;
  const ledger: LedgerRow[] = [
    { date: from, kind: "opening", label: "Opening Balance", detailLines: [], debit: 0, credit: 0, balance: running },
  ];
  for (const r of rows) {
    running += r.debit - r.credit;
    ledger.push({ ...r, balance: running });
  }

  return {
    openingBalance,
    invoicedAmount: invoiceRows.reduce((s, r) => s + r.debit, 0),
    amountReceived: receiptRows.reduce((s, r) => s + r.credit, 0),
    balanceDue: running,
    ledger,
  };
}

export default function CustomerStatementPage() {
  const searchParams = useSearchParams();

  const [company, setCompany] = useState<Company | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);

  const [preset, setPreset] = useState<Preset>("this_month");
  const [customFrom, setCustomFrom] = useState(todayStr());
  const [customTo, setCustomTo] = useState(todayStr());

  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [allocDetails, setAllocDetails] = useState<Map<string, { invoice_no: string; amount: number }[]>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) return;
    supabase.from("company").select("*").limit(1).maybeSingle().then(({ data }) => setCompany(data));
    supabase.from("customers").select("*").order("name").then(({ data }) => {
      setCustomers(data ?? []);
      const preselectId = searchParams.get("customer");
      if (preselectId) {
        const c = (data ?? []).find((x) => x.id === preselectId);
        if (c) setSelectedCustomer(c);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!supabase || !selectedCustomer) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      const [{ data: invs, error: iErr }, { data: rcpts, error: rErr }] = await Promise.all([
        supabase.from("invoices").select("*").eq("customer_id", selectedCustomer.id).order("invoice_date"),
        supabase.from("receipts").select("*").eq("customer_id", selectedCustomer.id).order("receipt_date"),
      ]);
      if (cancelled) return;
      if (iErr || rErr) {
        setError((iErr ?? rErr)?.message ?? "Failed to load statement data.");
        setLoading(false);
        return;
      }

      const receiptIds = (rcpts ?? []).map((r) => r.id);
      const allocMap = new Map<string, { invoice_no: string; amount: number }[]>();
      if (receiptIds.length > 0) {
        const { data: allocs } = await supabase
          .from("receipt_allocations")
          .select("receipt_id, amount, invoices(invoice_no)")
          .in("receipt_id", receiptIds);
        for (const a of allocs ?? []) {
          const list = allocMap.get(a.receipt_id) ?? [];
          list.push({ invoice_no: (a as any).invoices?.invoice_no ?? "—", amount: Number(a.amount) });
          allocMap.set(a.receipt_id, list);
        }
      }

      if (cancelled) return;
      setInvoices(invs ?? []);
      setReceipts(rcpts ?? []);
      setAllocDetails(allocMap);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedCustomer]);

  const { from, to } = useMemo(() => rangeForPreset(preset, customFrom, customTo), [preset, customFrom, customTo]);

  const statement = useMemo(() => {
    if (!selectedCustomer) return null;
    return buildStatement(selectedCustomer, invoices, receipts, allocDetails, from, to);
  }, [selectedCustomer, invoices, receipts, allocDetails, from, to]);

  const csvColumns: CsvColumn<LedgerRow>[] = [
    { header: "Date", value: (r) => r.date },
    { header: "Transaction", value: (r) => r.label },
    { header: "Details", value: (r) => r.detailLines.join(" | ") },
    { header: "Amount", value: (r) => (r.debit ? r.debit.toFixed(2) : "") },
    { header: "Payments", value: (r) => (r.credit ? r.credit.toFixed(2) : "") },
    { header: "Balance", value: (r) => r.balance.toFixed(2) },
  ];

  const addressLines = (addr: string | null | undefined) => (addr ? addr.split(",").map((s) => s.trim()) : []);

  return (
    <>
      <PageHeader title="Customer Statement" subtitle="A running ledger of invoices and receipts for one customer." />

      {!isConfigured && <NotConfigured />}

      {isConfigured && (
        <>
          <div className="mb-6 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 print:hidden">
            <div className="min-w-[260px] flex-1">
              <CustomerSelector customers={customers} value={selectedCustomer} onChange={setSelectedCustomer} />
            </div>
            <FormField label="Period">
              <select className={inputClass} value={preset} onChange={(e) => setPreset(e.target.value as Preset)}>
                <option value="this_month">This Month</option>
                <option value="last_month">Last Month</option>
                <option value="this_quarter">This Quarter</option>
                <option value="this_year">This Year</option>
                <option value="all_time">All Time</option>
                <option value="custom">Custom Range</option>
              </select>
            </FormField>
            {preset === "custom" && (
              <>
                <FormField label="From">
                  <input type="date" className={inputClass} value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
                </FormField>
                <FormField label="To">
                  <input type="date" className={inputClass} value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
                </FormField>
              </>
            )}
            {statement && (
              <>
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
                >
                  Print / Save as PDF
                </button>
                <ExportCsvButton
                  rows={statement.ledger}
                  columns={csvColumns}
                  filename={`statement-${selectedCustomer?.code}-${from}-to-${to}.csv`}
                />
              </>
            )}
          </div>

          {error && <p role="alert" className="mb-4 text-sm font-medium text-red-600">{error}</p>}

          {!selectedCustomer && (
            <p className="rounded-lg bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
              Select a customer above to view their statement.
            </p>
          )}

          {selectedCustomer && loading && <TableSkeleton rows={5} cols={6} />}

          {selectedCustomer && !loading && statement && (
            <div className="mx-auto max-w-3xl rounded-xl border border-slate-200 bg-white p-10 print:border-0 print:p-0 print:shadow-none">
              <div className="mb-8 flex items-start justify-between">
                <div>
                  <h2 className="text-lg font-bold text-brand">{company?.name ?? "Company"}</h2>
                  {addressLines(company?.address).map((line, i) => (
                    <p key={i} className="text-xs text-slate-500">{line}</p>
                  ))}
                  {company?.gstin && <p className="text-xs text-slate-500">GSTIN {company.gstin}</p>}
                </div>
                <div className="text-right">
                  <h3 className="text-sm font-bold uppercase tracking-wide text-slate-700">Statement of Accounts</h3>
                  <p className="mt-1 text-xs text-slate-400">{from} to {to}</p>
                </div>
              </div>

              <div className="mb-8 flex items-start justify-between">
                <div>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">To</p>
                  <p className="font-semibold text-slate-800">{selectedCustomer.name}</p>
                  {addressLines(selectedCustomer.address).map((line, i) => (
                    <p key={i} className="text-xs text-slate-500">{line}</p>
                  ))}
                  {selectedCustomer.gstin && <p className="text-xs text-slate-500">GSTIN {selectedCustomer.gstin}</p>}
                </div>

                <table className="text-sm">
                  <tbody>
                    <tr>
                      <td className="pr-6 text-slate-500">Opening Balance</td>
                      <td className="text-right font-medium text-slate-800">{money(statement.openingBalance)}</td>
                    </tr>
                    <tr>
                      <td className="pr-6 text-slate-500">Invoiced Amount</td>
                      <td className="text-right font-medium text-slate-800">{money(statement.invoicedAmount)}</td>
                    </tr>
                    <tr>
                      <td className="pr-6 text-slate-500">Amount Received</td>
                      <td className="text-right font-medium text-slate-800">{money(statement.amountReceived)}</td>
                    </tr>
                    <tr className="border-t border-slate-200">
                      <td className="pr-6 pt-1 font-semibold text-slate-700">Balance Due</td>
                      <td className="pt-1 text-right font-bold text-slate-900">{money(statement.balanceDue)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-800 text-left text-xs uppercase tracking-wide text-white">
                    <th className="px-3 py-2 font-semibold">Date</th>
                    <th className="px-3 py-2 font-semibold">Transaction</th>
                    <th className="px-3 py-2 font-semibold">Details</th>
                    <th className="px-3 py-2 text-right font-semibold">Amount</th>
                    <th className="px-3 py-2 text-right font-semibold">Payments</th>
                    <th className="px-3 py-2 text-right font-semibold">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {statement.ledger.map((row, i) => (
                    <tr key={i} className={`border-b border-slate-100 ${i % 2 === 1 ? "bg-slate-50" : ""}`}>
                      <td className="px-3 py-2 align-top text-slate-500">{row.date}</td>
                      <td className="px-3 py-2 align-top font-medium text-slate-700">
                        {row.kind === "opening" ? <span className="italic">***Opening Balance***</span> : row.label}
                      </td>
                      <td className="px-3 py-2 align-top text-slate-500">
                        {row.detailLines.map((d, j) => (
                          <p key={j}>{d}</p>
                        ))}
                      </td>
                      <td className="px-3 py-2 text-right align-top text-slate-700">{row.debit ? money(row.debit) : ""}</td>
                      <td className="px-3 py-2 text-right align-top text-slate-700">{row.credit ? money(row.credit) : ""}</td>
                      <td className="px-3 py-2 text-right align-top font-medium text-slate-800">{money(row.balance)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={5} className="px-3 py-3 text-right font-semibold text-slate-700">Balance Due</td>
                    <td className="px-3 py-3 text-right font-bold text-slate-900">{money(statement.balanceDue)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </>
      )}
    </>
  );
}
