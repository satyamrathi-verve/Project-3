export function fillPlaceholders(text: string, sample: Record<string, string>) {
  let out = text;
  for (const [key, value] of Object.entries(sample)) {
    out = out.replaceAll(`{${key}}`, value);
  }
  return out;
}

export function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function daysOverdue(dueDateIso: string) {
  const due = new Date(dueDateIso);
  const today = new Date();
  const diff = Math.floor((today.getTime() - due.getTime()) / (1000 * 60 * 60 * 24));
  return Math.max(0, diff);
}

export function formatCurrency(amount: number) {
  return `₹${amount.toLocaleString("en-IN")}`;
}

export type AgeingBucket = "0-30" | "31-60" | "61-90" | "90+";

export function ageingBucket(days: number): AgeingBucket {
  if (days <= 30) return "0-30";
  if (days <= 60) return "31-60";
  if (days <= 90) return "61-90";
  return "90+";
}

export const AGEING_BUCKET_STYLES: Record<
  AgeingBucket,
  { badge: string; dot: string; label: string }
> = {
  "0-30": {
    badge: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
    dot: "bg-amber-400",
    label: "0–30 days",
  },
  "31-60": {
    badge: "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300",
    dot: "bg-orange-500",
    label: "31–60 days",
  },
  "61-90": {
    badge: "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300",
    dot: "bg-rose-500",
    label: "61–90 days",
  },
  "90+": {
    badge: "bg-red-200 text-red-800 dark:bg-red-950 dark:text-red-300",
    dot: "bg-red-700",
    label: "90+ days",
  },
};

/*
  Each ageing bucket has its own escalating reminder template, matched by name
  (the reminder_templates table has no bucket column, so the name is the key).
  Ordered for display: mildest tier first, final-notice tier last.
*/
export const BUCKET_TEMPLATE_NAME: Record<AgeingBucket, string> = {
  "0-30": "0-30 Days Overdue",
  "31-60": "30-60 Days Overdue",
  "61-90": "61-90 Days Overdue",
  "90+": "90+ Days Overdue",
};

export const AGEING_BUCKET_ORDER: AgeingBucket[] = ["0-30", "31-60", "61-90", "90+"];

export function templateForDays<T extends { name: string }>(templates: T[], days: number): T | null {
  const wantedName = BUCKET_TEMPLATE_NAME[ageingBucket(days)];
  return (
    templates.find((t) => t.name === wantedName) ??
    templates.find((t) => t.name === BUCKET_TEMPLATE_NAME["0-30"]) ??
    templates[0] ??
    null
  );
}
