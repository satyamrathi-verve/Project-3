import type { ReceiptMode } from "@/lib/types";

const MODE_STYLES: Record<ReceiptMode, string> = {
  cash: "bg-emerald-50 text-emerald-700",
  cheque: "bg-purple-50 text-purple-700",
  upi: "bg-blue-50 text-blue-700",
  neft: "bg-indigo-50 text-indigo-700",
};

const MODE_LABELS: Record<ReceiptMode, string> = {
  cash: "Cash",
  cheque: "Cheque",
  upi: "UPI",
  neft: "NEFT",
};

export function ModeBadge({ mode }: { mode: ReceiptMode }) {
  return (
    <span className={`inline-block rounded-full px-2.5 py-1 text-xs font-semibold uppercase tracking-wide ${MODE_STYLES[mode]}`}>
      {MODE_LABELS[mode]}
    </span>
  );
}
