"use client";

import { useState } from "react";
import { inputClass } from "@/components/FormField";
import { downloadCsv } from "@/lib/csv";
import type { AdjustmentRow } from "@/lib/cashflow";
import { Card } from "./ui";

const SCHEDULE_KEY = "cashflow-scheduled-report";

export function ExportMenu({ rows }: { rows: AdjustmentRow[] }) {
  const [showSchedule, setShowSchedule] = useState(false);
  const [email, setEmail] = useState("");
  const [frequency, setFrequency] = useState("weekly");
  const [saved, setSaved] = useState<string | null>(null);

  function exportCsv(excelStyle: boolean) {
    downloadCsv(
      excelStyle ? "cashflow-projection.xls.csv" : "cashflow-projection.csv",
      ["Invoice", "Customer", "Status", "Risk", "Due Date", "Outstanding", "Probability %", "Expected Amount", "Expected Date", "Follow-up", "Collector", "Remarks"],
      rows.map((r) => [
        r.invoice_no,
        r.customer_name,
        r.status,
        r.riskLevel,
        r.due_date,
        r.outstanding.toFixed(2),
        r.probability,
        r.expectedAmount,
        r.expectedDate,
        r.followUpDate,
        r.collector,
        r.remarks,
      ])
    );
  }

  function saveSchedule() {
    const config = { email, frequency, savedAt: new Date().toISOString() };
    localStorage.setItem(SCHEDULE_KEY, JSON.stringify(config));
    setSaved(`Saved locally: ${frequency} report to ${email || "(no email set)"}.`);
  }

  return (
    <Card title="Export & Reports" subtitle="Download the current invoice list, print a report, or schedule a recurring one.">
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => exportCsv(false)} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">
          Export CSV
        </button>
        <button type="button" onClick={() => exportCsv(true)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
          Export Excel (.csv)
        </button>
        <button type="button" onClick={() => window.print()} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
          Print / Save as PDF
        </button>
        <button type="button" onClick={() => setShowSchedule((v) => !v)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
          Schedule Email Report
        </button>
      </div>

      <p className="mt-3 text-[11px] text-slate-400">
        &quot;Excel&quot; export is CSV formatted to open cleanly in Excel — this project has no binary .xlsx writer.
        PDF uses your browser&apos;s print dialog, the same pattern used elsewhere in this app.
      </p>

      {showSchedule && (
        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <input type="email" placeholder="Recipient email" value={email} onChange={(e) => setEmail(e.target.value)} className={`${inputClass} py-2 text-sm`} />
            <select value={frequency} onChange={(e) => setFrequency(e.target.value)} className={`${inputClass} py-2 text-sm`}>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>
          <button type="button" onClick={saveSchedule} className="mt-3 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark">
            Save Schedule
          </button>
          {saved && <p className="mt-2 text-xs text-emerald-700">{saved}</p>}
          <p className="mt-2 text-[11px] text-amber-700">
            This saves your preference in this browser only. Actually emailing reports on a schedule needs a backend
            email/cron service, which isn&apos;t part of this project — nothing will really be sent.
          </p>
        </div>
      )}
    </Card>
  );
}
