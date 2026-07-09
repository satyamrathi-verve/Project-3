"use client";

import { useMemo, useState } from "react";
import { computeScenario, currency, type AdjustmentRow } from "@/lib/cashflow";
import { Card } from "./ui";

export function ScenarioPanel({ rows, today }: { rows: AdjustmentRow[]; today: string }) {
  const [delayDays, setDelayDays] = useState(0);
  const [probAdj, setProbAdj] = useState(0);

  const result = useMemo(() => computeScenario(rows, today, delayDays, probAdj), [rows, today, delayDays, probAdj]);

  return (
    <Card
      title="Scenario Planning"
      subtitle="Apply a hypothetical delay or collection-probability shift across every open invoice and see the impact — nothing here changes real data."
    >
      <div className="mb-6 grid grid-cols-1 gap-6 sm:grid-cols-2">
        <div>
          <label className="flex justify-between text-xs font-medium text-slate-600">
            <span>Payment delay assumption</span>
            <span className="font-semibold text-slate-900">{delayDays > 0 ? `+${delayDays}` : delayDays} days</span>
          </label>
          <input type="range" min={-30} max={30} value={delayDays} onChange={(e) => setDelayDays(Number(e.target.value))} className="mt-2 w-full accent-brand" />
        </div>
        <div>
          <label className="flex justify-between text-xs font-medium text-slate-600">
            <span>Collection probability shift</span>
            <span className="font-semibold text-slate-900">{probAdj > 0 ? `+${probAdj}` : probAdj}%</span>
          </label>
          <input type="range" min={-30} max={30} value={probAdj} onChange={(e) => setProbAdj(Number(e.target.value))} className="mt-2 w-full accent-brand" />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <ComparisonRow label="Risk-Adjusted Expected Inflow" baseline={result.baselineExpected} scenario={result.scenarioExpected} />
        <ComparisonRow label="Due This Week" baseline={result.baselineDueThisWeek} scenario={result.scenarioDueThisWeek} />
        <ComparisonRow label="Due This Month" baseline={result.baselineDueThisMonth} scenario={result.scenarioDueThisMonth} />
      </div>
    </Card>
  );
}

function ComparisonRow({ label, baseline, scenario }: { label: string; baseline: number; scenario: number }) {
  const delta = scenario - baseline;
  return (
    <div className="rounded-xl border border-slate-200 p-4">
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-lg font-bold text-slate-900">{currency(scenario)}</span>
        <span className={`text-xs font-semibold ${delta > 0 ? "text-emerald-600" : delta < 0 ? "text-red-600" : "text-slate-400"}`}>
          {delta === 0 ? "—" : `${delta > 0 ? "+" : ""}${currency(delta)}`}
        </span>
      </div>
      <p className="mt-0.5 text-[11px] text-slate-400">Baseline: {currency(baseline)}</p>
    </div>
  );
}
