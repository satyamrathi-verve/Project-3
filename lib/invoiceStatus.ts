import type { Invoice, InvoiceStatus } from "./types";

const MS_PER_DAY = 86_400_000;

/* Whole days past due, compared date-only (not time-of-day) so it doesn't flicker
   depending on what hour you load the page. 0 if paid or not yet due. */
export function overdueDays(inv: Invoice): number {
  if (inv.status === "paid") return 0;
  const due = new Date(inv.due_date);
  const today = new Date();
  const diff = Math.floor(
    (Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) -
      Date.UTC(due.getFullYear(), due.getMonth(), due.getDate())) /
      MS_PER_DAY,
  );
  return diff > 0 ? diff : 0;
}

/* The stored status is set once when an invoice is created and never revisited,
   so it goes stale: an open/partial invoice whose due date has since passed is
   overdue regardless of what the status column still says. Compute it instead. */
export function effectiveStatus(inv: Invoice): InvoiceStatus {
  if (inv.status === "paid") return "paid";
  return overdueDays(inv) > 0 ? "overdue" : inv.status;
}

export const STATUS_LABEL: Record<InvoiceStatus, string> = {
  open: "Open",
  paid: "Paid",
  overdue: "Overdue",
  partial: "Partial",
};

export const STATUS_BADGE: Record<InvoiceStatus, string> = {
  open: "bg-sky-100 text-sky-700",
  paid: "bg-emerald-100 text-emerald-700",
  overdue: "bg-rose-100 text-rose-700",
  partial: "bg-amber-100 text-amber-700",
};
