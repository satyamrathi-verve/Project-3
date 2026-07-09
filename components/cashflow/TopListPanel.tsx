import { currency } from "@/lib/cashflow";
import { Card, EmptyState } from "./ui";

export function TopListPanel({
  title,
  subtitle,
  rows,
}: {
  title: string;
  subtitle?: string;
  rows: { id: string; name: string; amount: number; meta?: string }[];
}) {
  const max = Math.max(1, ...rows.map((r) => r.amount));
  return (
    <Card title={title} subtitle={subtitle}>
      {rows.length === 0 ? (
        <EmptyState title="Nothing to rank yet" />
      ) : (
        <div className="flex flex-col gap-2.5">
          {rows.map((r, i) => (
            <div key={r.id} className="flex items-center gap-3">
              <span className="w-4 flex-none text-xs font-semibold text-slate-400">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="flex justify-between text-xs">
                  <span className="truncate font-medium text-slate-700">{r.name}</span>
                  <span className="flex-none pl-2 font-semibold text-slate-900">{currency(r.amount)}</span>
                </div>
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full bg-brand" style={{ width: `${(r.amount / max) * 100}%` }} />
                </div>
                {r.meta && <p className="mt-0.5 text-[10px] text-slate-400">{r.meta}</p>}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
