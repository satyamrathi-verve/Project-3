"use client";

export const TAB_KEYS = [
  "dashboard",
  "forecast",
  "receivables",
  "collections",
  "customers",
  "calendar",
  "scenario",
  "reports",
  "settings",
] as const;

export type TabKey = (typeof TAB_KEYS)[number];

const LABELS: Record<TabKey, string> = {
  dashboard: "Dashboard",
  forecast: "Forecast",
  receivables: "Receivables",
  collections: "Collections",
  customers: "Customer Analysis",
  calendar: "Calendar",
  scenario: "Scenario Planning",
  reports: "Reports",
  settings: "Settings",
};

export function Tabs({ active, onChange }: { active: TabKey; onChange: (t: TabKey) => void }) {
  return (
    <div className="mb-6 flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
      {TAB_KEYS.map((key) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          className={`whitespace-nowrap rounded-lg px-3.5 py-2 text-sm font-medium transition-colors ${
            active === key ? "bg-brand text-white shadow-sm" : "text-slate-600 hover:bg-slate-100"
          }`}
        >
          {LABELS[key]}
        </button>
      ))}
    </div>
  );
}
