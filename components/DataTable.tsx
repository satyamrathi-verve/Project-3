import type { ReactNode } from "react";
import { hexToRgba } from "@/lib/colors";

export interface Column<T> {
  key: string;
  header: string;
  /** Optional custom cell; defaults to String(row[key]). */
  render?: (row: T) => ReactNode;
  className?: string;
  /**
   * Optional per-column accent (hex). Tints the header a bit stronger and the
   * body cells faintly, so a wide, horizontally-scrolled table (e.g. Upload
   * Report's CSV preview) stays easy to track column-by-column — Rainbow-CSV
   * style. Leave unset for a plain column.
   */
  accentColor?: string;
}

/*
  A plain, reusable table. Copy this pattern for every list screen (invoices,
  receipts, GL accounts…). Pass your columns and rows; it handles the empty state.

  Pass `bare` when the caller supplies its own bordered/rounded container (e.g. a
  toolbar + table panel) so DataTable doesn't draw a second border inside it.
*/
export function DataTable<T extends { id: string }>({
  columns,
  rows,
  empty = "Nothing here yet.",
  bare = false,
  rowClassName,
  footer,
  onRowClick,
}: {
  columns: Column<T>[];
  rows: T[];
  empty?: string;
  bare?: boolean;
  /** Optional per-row class, e.g. to highlight overdue or high-risk rows. */
  rowClassName?: (row: T) => string;
  /** Optional <tr> rendered in a <tfoot>, e.g. a totals row. */
  footer?: ReactNode;
  /** Optional: makes rows clickable (e.g. open a detail drawer). */
  onRowClick?: (row: T) => void;
}) {
  const table = (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b-2 border-brand/30 bg-brand/10 text-left dark:border-brand/40 dark:bg-brand/20">
          {columns.map((c) => (
            <th
              key={c.key}
              className={`whitespace-nowrap px-4 py-3 text-xs font-bold uppercase tracking-wide text-brand-dark dark:text-brand ${c.className ?? ""}`}
              style={
                c.accentColor
                  ? { backgroundColor: hexToRgba(c.accentColor, 0.16), borderBottom: `2px solid ${c.accentColor}` }
                  : undefined
              }
            >
              {c.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td colSpan={columns.length} className="px-4 py-10 text-center text-slate-400 dark:text-slate-600">
              {empty}
            </td>
          </tr>
        ) : (
          rows.map((row, i) => (
            <tr
              key={row.id}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={`border-b border-slate-100 last:border-0 transition-colors hover:bg-brand/5 dark:border-slate-800 dark:hover:bg-slate-800 ${
                i % 2 === 1 ? "bg-slate-50/70 dark:bg-slate-900/60" : "dark:bg-slate-900"
              } ${onRowClick ? "cursor-pointer" : ""} ${rowClassName?.(row) ?? ""}`}
            >
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={`whitespace-nowrap px-4 py-3 text-slate-700 dark:text-slate-300 ${c.className ?? ""}`}
                  style={c.accentColor ? { backgroundColor: hexToRgba(c.accentColor, 0.07) } : undefined}
                >
                  {c.render ? c.render(row) : String((row as Record<string, unknown>)[c.key] ?? "")}
                </td>
              ))}
            </tr>
          ))
        )}
      </tbody>
      {footer && <tfoot>{footer}</tfoot>}
    </table>
  );

  if (bare) return table;

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      {table}
    </div>
  );
}
