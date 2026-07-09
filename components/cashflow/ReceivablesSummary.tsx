import { currency } from "@/lib/cashflow";
import { Card } from "./ui";

export function ReceivablesSummary({
  averageInvoiceValue,
  dso,
  outstandingInvoices,
  totalOutstanding,
}: {
  averageInvoiceValue: number;
  dso: number;
  outstandingInvoices: number;
  totalOutstanding: number;
}) {
  return (
    <Card title="Receivables Summary" subtitle="Simplified DSO based on this dataset's full invoice history.">
      <div className="grid grid-cols-2 gap-4">
        <Stat label="Average Invoice Value" value={currency(averageInvoiceValue)} />
        <Stat label="Days Sales Outstanding" value={`${dso.toFixed(0)} days`} />
        <Stat label="Outstanding Invoices" value={String(outstandingInvoices)} />
        <Stat label="Total Outstanding" value={currency(totalOutstanding)} />
      </div>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 p-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-bold text-slate-900">{value}</p>
    </div>
  );
}
