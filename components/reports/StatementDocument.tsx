import type { Company, Customer } from "@/lib/types";
import { money } from "@/lib/format";

export type LedgerRow = {
  date: string;
  kind: "opening" | "invoice" | "receipt";
  label: string;
  detailLines: string[];
  debit: number;
  credit: number;
  balance: number;
};

export type Statement = {
  openingBalance: number;
  invoicedAmount: number;
  amountReceived: number;
  balanceDue: number;
  ledger: LedgerRow[];
};

function addressLines(addr: string | null | undefined) {
  return addr ? addr.split(",").map((s) => s.trim()) : [];
}

export function StatementDocument({
  company,
  customer,
  statement,
  from,
  to,
  breakAfter = false,
}: {
  company: Company | null;
  customer: Customer;
  statement: Statement;
  from: string;
  to: string;
  breakAfter?: boolean;
}) {
  return (
    <div
      className={`mx-auto max-w-3xl rounded-xl border-t-4 border-brand border-x border-b border-slate-200 bg-white p-10 print:rounded-none print:border-x-0 print:border-b-0 print:shadow-none ${
        breakAfter ? "print:break-after-page" : ""
      }`}
    >
      <div className="mb-8 flex items-start justify-between gap-6">
        <div className="flex gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={company?.logo_url || "/brand/verve-logo.png"}
            alt={company?.name ?? "Company logo"}
            className="h-14 w-auto flex-none object-contain"
          />
          <div>
            <h2 className="text-lg font-bold text-brand">{company?.name ?? "Company"}</h2>
            {addressLines(company?.address).map((line, i) => (
              <p key={i} className="text-xs text-slate-500">{line}</p>
            ))}
            {company?.gstin && <p className="text-xs text-slate-500">GSTIN {company.gstin}</p>}
          </div>
        </div>
        <div className="flex-none text-right">
          <h3 className="text-sm font-bold uppercase tracking-wide text-brand">Statement of Accounts</h3>
          <p className="mt-1 text-xs text-slate-400">{from} to {to}</p>
        </div>
      </div>

      <div className="mb-8 flex items-start justify-between">
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">To</p>
          <p className="font-semibold text-slate-800">{customer.name}</p>
          {addressLines(customer.address).map((line, i) => (
            <p key={i} className="text-xs text-slate-500">{line}</p>
          ))}
          {customer.gstin && <p className="text-xs text-slate-500">GSTIN {customer.gstin}</p>}
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
            <tr className="border-t-2 border-brand">
              <td className="pr-6 pt-1 font-semibold text-brand">Balance Due</td>
              <td className="pt-1 text-right font-bold text-accent-dark">{money(statement.balanceDue)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="bg-brand text-left text-xs uppercase tracking-wide text-white">
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
            <td colSpan={5} className="px-3 py-3 text-right font-semibold text-brand">Balance Due</td>
            <td className="px-3 py-3 text-right font-bold text-accent-dark">{money(statement.balanceDue)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
