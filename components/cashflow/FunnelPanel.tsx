import type { FunnelStage } from "@/lib/cashflow";
import { currency } from "@/lib/cashflow";
import { Card } from "./ui";

const COLORS = ["bg-blue-500", "bg-orange-400", "bg-red-500", "bg-emerald-500"];

export function FunnelPanel({ stages }: { stages: FunnelStage[] }) {
  const max = Math.max(1, ...stages.map((s) => s.amount));
  return (
    <Card title="Collection Funnel" subtitle="How invoiced value moves from raised to due to overdue to collected.">
      <div className="flex flex-col gap-3">
        {stages.map((s, i) => (
          <div key={s.label}>
            <div className="mb-1 flex justify-between text-xs">
              <span className="font-medium text-slate-700">{s.label}</span>
              <span className="text-slate-500">{s.count} · {currency(s.amount)}</span>
            </div>
            <div className="h-6 w-full overflow-hidden rounded-md bg-slate-100">
              <div className={`h-full ${COLORS[i % COLORS.length]}`} style={{ width: `${Math.max(2, (s.amount / max) * 100)}%` }} />
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
