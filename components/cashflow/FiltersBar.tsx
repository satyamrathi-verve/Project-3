"use client";

import { inputClass } from "@/components/FormField";
import { EMPTY_FILTERS, hasActiveFilters, type CashflowFilters } from "@/lib/cashflow";
import { Card } from "./ui";

const selectClass = `${inputClass} py-1.5 text-xs`;

export function FiltersBar({
  value,
  onChange,
  customers,
  collectorOptions,
}: {
  value: CashflowFilters;
  onChange: (next: CashflowFilters) => void;
  customers: { id: string; name: string }[];
  collectorOptions: string[];
}) {
  function set<K extends keyof CashflowFilters>(key: K, v: CashflowFilters[K]) {
    onChange({ ...value, [key]: v });
  }

  return (
    <Card
      className="mb-6"
      action={
        hasActiveFilters(value) ? (
          <button type="button" onClick={() => onChange(EMPTY_FILTERS)} className="text-xs font-medium text-brand hover:underline">
            Clear all
          </button>
        ) : undefined
      }
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <select className={selectClass} value={value.customerId} onChange={(e) => set("customerId", e.target.value)}>
          <option value="">All customers</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>

        <select className={selectClass} value={value.status} onChange={(e) => set("status", e.target.value)}>
          <option value="">All statuses</option>
          <option value="open">Open</option>
          <option value="partial">Partial</option>
          <option value="overdue">Overdue</option>
          <option value="paid">Paid</option>
        </select>

        <select className={selectClass} value={value.riskLevel} onChange={(e) => set("riskLevel", e.target.value)}>
          <option value="">All risk levels</option>
          <option value="Low">Low risk</option>
          <option value="Medium">Medium risk</option>
          <option value="High">High risk</option>
        </select>

        <select className={selectClass} value={value.collector} onChange={(e) => set("collector", e.target.value)}>
          <option value="">All collectors</option>
          {collectorOptions.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>

        <input type="date" className={selectClass} value={value.dateFrom} onChange={(e) => set("dateFrom", e.target.value)} title="Due date from" />
        <input type="date" className={selectClass} value={value.dateTo} onChange={(e) => set("dateTo", e.target.value)} title="Due date to" />

        <input type="number" placeholder="Min amount" className={selectClass} value={value.amountMin} onChange={(e) => set("amountMin", e.target.value)} />
        <input type="number" placeholder="Max amount" className={selectClass} value={value.amountMax} onChange={(e) => set("amountMax", e.target.value)} />
      </div>
      <p className="mt-2 text-[11px] text-slate-400">
        Company, business unit, currency and salesperson filters aren&apos;t shown — this dataset is single-company,
        single-currency and has no business-unit/salesperson fields yet.
      </p>
    </Card>
  );
}
