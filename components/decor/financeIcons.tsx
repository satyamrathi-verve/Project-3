/*
  Shared line-icon shapes for the "scattered finance objects" decorative
  motif — used by the Sign In backdrop, and the sidebar/header chrome so all
  three feel like one consistent visual language rather than one-off collages.
*/
import type { ReactNode } from "react";

export function FinanceIcon({ path, className }: { path: ReactNode; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {path}
    </svg>
  );
}

export const invoicePath = (
  <>
    <path d="M6 2h9l3 3v17H6z" />
    <path d="M9 8h6M9 12h6M9 16h4" />
  </>
);

export const ledgerGridPath = (
  <>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
  </>
);

export const trendChartPath = (
  <>
    <path d="M3 17l6-6 4 4 8-8" />
    <path d="M17 7h4v4" />
  </>
);

export const pieChartPath = (
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 3v9l6 6" />
  </>
);

export const buildingPath = (
  <>
    <path d="M4 21V6l8-4 8 4v15" />
    <path d="M9 21v-6h6v6M9 10h.01M15 10h.01M9 14h.01M15 14h.01" />
  </>
);

export const currencyFlowPath = (
  <>
    <line x1="12" y1="1" x2="12" y2="23" />
    <path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
  </>
);

export const calculatorPath = (
  <>
    <rect x="4" y="2" width="16" height="20" rx="2" />
    <path d="M8 6h8M8 11h.01M12 11h.01M16 11h.01M8 15h.01M12 15h.01M16 15h.01M8 19h.01M12 19h.01M16 19h.01" />
  </>
);
