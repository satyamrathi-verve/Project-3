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
import { Avatar } from "@/components/Avatar";
import { ExportCsvButton, type CsvColumn } from "@/components/ExportCsvButton";
import { CustomerSelector } from "@/components/receipts/CustomerSelector";
import { StatementDocument, type LedgerRow, type Statement } from "@/components/reports/StatementDocument";

type Preset = "this_month" | "last_month" | "this_quarter" | "this_year" | "all_time" | "custom";
type ViewMode = "single" | "all";

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
): Statement {
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

function hasActivity(customer: Customer, statement: Statement) {
  return (
    statement.ledger.length > 1 ||
    Math.abs(statement.openingBalance) > 0.005 ||
    Math.abs(statement.balanceDue) > 0.005 ||
    Math.abs(Number(customer.opening_balance)) > 0.005
  );
}

export default function CustomerStatementPage() {
  const searchParams = useSearchParams();

  const [company, setCompany] = useState<Company | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("single");
  const [skipEmpty, setSkipEmpty] = useState(true);

  const [preset, setPreset] = useState<Preset>("this_month");
  const [customFrom, setCustomFrom] = useState(todayStr());
  const [customTo, setCustomTo] = useState(todayStr());

  const [allInvoices, setAllInvoices] = useState<Invoice[]>([]);
  const [allReceipts, setAllReceipts] = useState<Receipt[]>([]);
  const [allocDetails, setAllocDetails] = useState<Map<string, { invoice_no: string; amount: number }[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) return;
    setLoading(true);
    setError(null);

    (async () => {
      const [companyRes, customersRes, invoicesRes, receiptsRes, allocRes] = await Promise.all([
        supabase.from("company").select("*").limit(1).maybeSingle(),
        supabase.from("customers").select("*").order("name"),
        supabase.from("invoices").select("*"),
        supabase.from("receipts").select("*"),
        supabase.from("receipt_allocations").select("receipt_id, amount, invoices(invoice_no)"),
      ]);

      const err = customersRes.error ?? invoicesRes.error ?? receiptsRes.error ?? allocRes.error;
      if (err) {
        setError(err.message);
        setLoading(false);
        return;
      }

      const allocMap = new Map<string, { invoice_no: string; amount: number }[]>();
      for (const a of allocRes.data ?? []) {
        const list = allocMap.get(a.receipt_id) ?? [];
        list.push({ invoice_no: (a as any).invoices?.invoice_no ?? "—", amount: Number(a.amount) });
        allocMap.set(a.receipt_id, list);
      }

      setCompany(companyRes.data);
      const customersData = customersRes.data ?? [];
      setCustomers(customersData);
      setAllInvoices(invoicesRes.data ?? []);
      setAllReceipts(receiptsRes.data ?? []);
      setAllocDetails(allocMap);
      setLoading(false);

      const preselectId = searchParams.get("customer");
      if (preselectId) {
        const c = customersData.find((x) => x.id === preselectId);
        if (c) setSelectedCustomer(c);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { from, to } = useMemo(() => rangeForPreset(preset, customFrom, customTo), [preset, customFrom, customTo]);

  const invoicesByCustomer = useMemo(() => {
    const map = new Map<string, Invoice[]>();
    for (const i of allInvoices) map.set(i.customer_id, [...(map.get(i.customer_id) ?? []), i]);
    return map;
  }, [allInvoices]);

  const receiptsByCustomer = useMemo(() => {
    const map = new Map<string, Receipt[]>();
    for (const r of allReceipts) map.set(r.customer_id, [...(map.get(r.customer_id) ?? []), r]);
    return map;
  }, [allReceipts]);

  const statement = useMemo(() => {
    if (!selectedCustomer) return null;
    return buildStatement(
      selectedCustomer,
      invoicesByCustomer.get(selectedCustomer.id) ?? [],
      receiptsByCustomer.get(selectedCustomer.id) ?? [],
      allocDetails,
      from,
      to
    );
  }, [selectedCustomer, invoicesByCustomer, receiptsByCustomer, allocDetails, from, to]);

  const allStatements = useMemo(() => {
    const built = customers.map((customer) => ({
      customer,
      statement: buildStatement(
        customer,
        invoicesByCustomer.get(customer.id) ?? [],
        receiptsByCustomer.get(customer.id) ?? [],
        allocDetails,
        from,
        to
      ),
    }));
    return skipEmpty ? built.filter(({ customer, statement }) => hasActivity(customer, statement)) : built;
  }, [customers, invoicesByCustomer, receiptsByCustomer, allocDetails, from, to, skipEmpty]);

  const singleCsvColumns: CsvColumn<LedgerRow>[] = [
    { header: "Date", value: (r) => r.date },
    { header: "Transaction", value: (r) => r.label },
    { header: "Details", value: (r) => r.detailLines.join(" | ") },
    { header: "Amount", value: (r) => (r.debit ? r.debit.toFixed(2) : "") },
    { header: "Payments", value: (r) => (r.credit ? r.credit.toFixed(2) : "") },
    { header: "Balance", value: (r) => r.balance.toFixed(2) },
  ];

  const allCsvColumns: CsvColumn<{ customer: Customer; statement: Statement }>[] = [
    { header: "Customer Code", value: (x) => x.customer.code },
    { header: "Customer Name", value: (x) => x.customer.name },
    { header: "Opening Balance", value: (x) => x.statement.openingBalance.toFixed(2) },
    { header: "Invoiced Amount", value: (x) => x.statement.invoicedAmount.toFixed(2) },
    { header: "Amount Received", value: (x) => x.statement.amountReceived.toFixed(2) },
    { header: "Balance Due", value: (x) => x.statement.balanceDue.toFixed(2) },
  ];

  return (
    <>
      <PageHeader title="Customer Statement" subtitle="A running ledger of invoices and receipts, per customer or for everyone at once." />

      {!isConfigured && <NotConfigured />}

      {isConfigured && (
        <>
          <div className="mb-6 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-cream p-4 print:hidden">
            <div className="flex overflow-hidden rounded-lg border border-slate-200">
              <button
                type="button"
                onClick={() => setViewMode("single")}
                className={`px-3 py-2 text-sm font-medium ${viewMode === "single" ? "bg-brand text-white" : "text-slate-600 hover:bg-cream-dim"}`}
              >
                Single Customer
              </button>
              <button
                type="button"
                onClick={() => setViewMode("all")}
                className={`px-3 py-2 text-sm font-medium ${viewMode === "all" ? "bg-brand text-white" : "text-slate-600 hover:bg-cream-dim"}`}
              >
                All Customers
              </button>
            </div>

            {viewMode === "single" && (
              <div className="min-w-[260px] flex-1">
                <CustomerSelector customers={customers} value={selectedCustomer} onChange={setSelectedCustomer} />
              </div>
            )}

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

            {viewMode === "all" && (
              <label className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
                <input type="checkbox" checked={skipEmpty} onChange={(e) => setSkipEmpty(e.target.checked)} />
                Skip customers with no activity
              </label>
            )}

            {viewMode === "single" && statement && (
              <>
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-cream-dim"
                >
                  Print / Save as PDF
                </button>
                <ExportCsvButton
                  rows={statement.ledger}
                  columns={singleCsvColumns}
                  filename={`statement-${selectedCustomer?.code}-${from}-to-${to}.csv`}
                />
              </>
            )}

            {viewMode === "all" && !loading && (
              <>
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-cream-dim"
                >
                  Print All / Save as PDF
                </button>
                <ExportCsvButton rows={allStatements} columns={allCsvColumns} filename={`statements-all-customers-${from}-to-${to}.csv`} />
              </>
            )}
          </div>

          {error && <p role="alert" className="mb-4 text-sm font-medium text-red-600">{error}</p>}

          {loading && <TableSkeleton rows={5} cols={6} />}

          {!loading && viewMode === "single" && !selectedCustomer && (
            <p className="rounded-lg bg-cream-dim px-4 py-8 text-center text-sm text-slate-500">
              Select a customer above to view their statement.
            </p>
          )}

          {!loading && viewMode === "single" && selectedCustomer && statement && (
            <StatementDocument company={company} customer={selectedCustomer} statement={statement} from={from} to={to} />
          )}

          {!loading && viewMode === "all" && (
            <>
              <p className="mb-4 text-sm text-slate-500 print:hidden">
                Showing {allStatements.length} of {customers.length} customers
                {skipEmpty && customers.length > allStatements.length
                  ? ` (${customers.length - allStatements.length} skipped — no activity)`
                  : ""}
                .
              </p>
              {allStatements.length === 0 ? (
                <p className="rounded-lg bg-cream-dim px-4 py-8 text-center text-sm text-slate-500">
                  No customers with activity in this period.
                </p>
              ) : (
                <div className="overflow-hidden rounded-xl border border-slate-200 bg-cream print:border-0">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 bg-cream-dim text-left">
                        <th className="px-4 py-3 font-semibold text-slate-600">Customer</th>
                        <th className="px-4 py-3 text-right font-semibold text-slate-600">Opening Balance</th>
                        <th className="px-4 py-3 text-right font-semibold text-slate-600">Invoiced</th>
                        <th className="px-4 py-3 text-right font-semibold text-slate-600">Received</th>
                        <th className="px-4 py-3 text-right font-semibold text-slate-600">Balance Due</th>
                        <th className="px-4 py-3 text-right font-semibold text-slate-600 print:hidden" />
                      </tr>
                    </thead>
                    <tbody>
                      {allStatements.map(({ customer, statement }) => (
                        <tr key={customer.id} className="border-b border-slate-100 last:border-0 hover:bg-cream-dim">
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-3">
                              <Avatar name={customer.name} className="h-8 w-8 text-xs" />
                              <div>
                                <p className="font-medium text-slate-800">{customer.name}</p>
                                <p className="text-xs text-slate-400">{customer.code}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right text-slate-700">{money(statement.openingBalance)}</td>
                          <td className="px-4 py-3 text-right text-slate-700">{money(statement.invoicedAmount)}</td>
                          <td className="px-4 py-3 text-right text-slate-700">{money(statement.amountReceived)}</td>
                          <td className="px-4 py-3 text-right font-semibold text-slate-900">{money(statement.balanceDue)}</td>
                          <td className="px-4 py-3 text-right print:hidden">
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedCustomer(customer);
                                setViewMode("single");
                              }}
                              className="text-sm font-medium text-brand hover:underline"
                            >
                              View Statement
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-slate-200 bg-cream-dim">
                        <td className="px-4 py-3 font-semibold text-slate-700">Total</td>
                        <td className="px-4 py-3 text-right font-semibold text-slate-800">
                          {money(allStatements.reduce((s, x) => s + x.statement.openingBalance, 0))}
                        </td>
                        <td className="px-4 py-3 text-right font-semibold text-slate-800">
                          {money(allStatements.reduce((s, x) => s + x.statement.invoicedAmount, 0))}
                        </td>
                        <td className="px-4 py-3 text-right font-semibold text-slate-800">
                          {money(allStatements.reduce((s, x) => s + x.statement.amountReceived, 0))}
                        </td>
                        <td className="px-4 py-3 text-right font-bold text-slate-900">
                          {money(allStatements.reduce((s, x) => s + x.statement.balanceDue, 0))}
                        </td>
                        <td className="print:hidden" />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </>
          )}
        </>
      )}
    </>
  );
}
