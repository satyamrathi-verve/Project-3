export function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export function money(n: number) {
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Compact Indian units for headline stat numbers (₹4.09L, ₹1.20Cr); falls back to full money() below 1 lakh. */
export function moneyCompact(n: number) {
  const abs = Math.abs(n);
  if (abs >= 1e7) return `₹${(n / 1e7).toFixed(2)}Cr`;
  if (abs >= 1e5) return `₹${(n / 1e5).toFixed(2)}L`;
  return money(n);
}

/** Days between a past date string (YYYY-MM-DD) and today; 0 if not in the past. */
export function ageInDays(dateStr: string) {
  const ms = new Date(todayStr()).getTime() - new Date(dateStr).getTime();
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  return days > 0 ? days : 0;
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}

export const formatDate = (d: string) =>
  new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
