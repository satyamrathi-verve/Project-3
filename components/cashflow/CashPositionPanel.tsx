import { currency } from "@/lib/cashflow";
import { Badge, Card } from "./ui";

export function CashPositionPanel({ projectedInflow }: { projectedInflow: number }) {
  const opening = 0;
  const outflows = 0;
  const closing = opening + projectedInflow - outflows;

  return (
    <Card
      title="Cash Position"
      subtitle="Opening Cash → Inflows → Outflows → Closing Cash"
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <WaterfallStep label="Opening Cash" value={opening} note="Not tracked" tone="slate" />
        <WaterfallStep label="Projected Inflows" value={projectedInflow} tone="green" />
        <WaterfallStep label="Projected Outflows" value={-outflows} note="Not tracked" tone="slate" />
        <WaterfallStep label="Closing Cash" value={closing} tone="purple" strong />
      </div>
      <p className="mt-4 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
        This system only tracks receivables (money coming in). Opening bank balance and outflows (expenses,
        payables) aren&apos;t part of this schema, so they&apos;re shown as ₹0 rather than guessed — Closing Cash
        here equals projected inflows only.
      </p>
    </Card>
  );
}

function WaterfallStep({
  label,
  value,
  note,
  tone,
  strong,
}: {
  label: string;
  value: number;
  note?: string;
  tone: "slate" | "green" | "purple";
  strong?: boolean;
}) {
  const toneClass = tone === "green" ? "text-emerald-600" : tone === "purple" ? "text-purple-600" : "text-slate-500";
  return (
    <div className={`rounded-xl border p-3 ${strong ? "border-purple-200 bg-purple-50" : "border-slate-200"}`}>
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-lg font-bold ${toneClass}`}>{currency(value)}</p>
      {note && <Badge tone="slate">{note}</Badge>}
    </div>
  );
}

export function CashDeficitNote() {
  return (
    <Card title="Cash Deficit Forecast">
      <p className="text-sm text-slate-500">
        No deficit is projected. Deficit forecasting compares inflows against outflows (payroll, vendor payments,
        overheads), and this AR-only system doesn&apos;t track outflows — so there&apos;s nothing to subtract from
        inflows yet. Add an accounts-payable/expenses source to make this meaningful.
      </p>
    </Card>
  );
}
