"use client";

import { useState } from "react";
import { money } from "@/lib/format";

function statusFor(amount: number, allocated: number) {
  const unapplied = amount - allocated;
  if (amount <= 0) return { label: "New", tone: "bg-slate-100 text-slate-500" };
  if (unapplied < -0.005) return { label: "Over-allocated", tone: "bg-red-100 text-red-700" };
  if (unapplied <= 0.005) return { label: "Fully Applied", tone: "bg-emerald-100 text-emerald-700" };
  if (allocated > 0.005) return { label: "Partially Applied", tone: "bg-amber-100 text-amber-700" };
  return { label: "Unapplied", tone: "bg-slate-100 text-slate-500" };
}

function Row({ label, value, emphasis }: { label: string; value: string; emphasis?: "warn" | "good" }) {
  return (
    <div className="flex items-center justify-between py-1.5 text-sm">
      <span className="text-slate-500">{label}</span>
      <span
        className={`font-medium ${
          emphasis === "warn" ? "text-red-600" : emphasis === "good" ? "text-emerald-600" : "text-slate-800"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

export function ReceiptSummaryPanel({
  receiptAmount,
  allocated,
  invoicesSelected,
  customerOutstanding,
  customerLabel,
}: {
  receiptAmount: number;
  allocated: number;
  invoicesSelected: number;
  customerOutstanding: number;
  customerLabel: string | null;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const unapplied = receiptAmount - allocated;
  const status = statusFor(receiptAmount, allocated);

  const body = (
    <>
      <div className="mb-3 flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Receipt Summary</h4>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${status.tone}`}>{status.label}</span>
      </div>
      <Row label="Receipt Amount" value={money(receiptAmount)} />
      <Row label="Allocated" value={money(allocated)} />
      <Row label="Unallocated" value={money(unapplied)} emphasis={unapplied < -0.005 ? "warn" : unapplied <= 0.005 && receiptAmount > 0 ? "good" : undefined} />
      <Row label="Invoices Selected" value={String(invoicesSelected)} />
      <div className="my-2 border-t border-slate-100" />
      <Row label={customerLabel ? `${customerLabel} — Outstanding` : "Customer Outstanding"} value={money(customerOutstanding)} />
    </>
  );

  return (
    <>
      {/* Desktop / tablet: sticky card */}
      <div className="hidden lg:sticky lg:top-6 lg:block lg:w-72 lg:flex-none lg:self-start lg:rounded-xl lg:border lg:border-slate-200 lg:bg-white lg:p-5">
        {body}
      </div>

      {/* Mobile: collapsible bottom sheet */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white shadow-[0_-4px_12px_rgba(0,0,0,0.06)] lg:hidden">
        <button
          type="button"
          onClick={() => setMobileOpen((v) => !v)}
          className="flex w-full items-center justify-between px-4 py-3"
        >
          <span className="text-sm text-slate-500">
            Unallocated: <span className="font-semibold text-slate-800">{money(unapplied)}</span>
          </span>
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${status.tone}`}>{status.label}</span>
        </button>
        {mobileOpen && <div className="border-t border-slate-100 px-4 pb-4 pt-2">{body}</div>}
      </div>
    </>
  );
}
