import { money } from "@/lib/format";
import type { ReceiptMode } from "@/lib/types";

const GL_CASH = "Cash in Hand (1210)";
const GL_BANK = "Bank Account (1200)";
const GL_DEBTORS = "Sundry Debtors — Accounts Receivable (1100)";

export function AccountingPreview({ mode, amount }: { mode: ReceiptMode; amount: number }) {
  return (
    <div className="rounded-lg bg-cream-dim p-4">
      <p className="text-xs text-slate-400">
        Reference only — this schema has no journal/GL table to post entries to yet.
      </p>
      <div className="mt-2 space-y-1 font-mono text-xs text-slate-700">
        <div>Dr &nbsp;{mode === "cash" ? GL_CASH : GL_BANK} &nbsp;&nbsp;{money(amount)}</div>
        <div>&nbsp;&nbsp;&nbsp;Cr &nbsp;{GL_DEBTORS} &nbsp;&nbsp;{money(amount)}</div>
      </div>
    </div>
  );
}
