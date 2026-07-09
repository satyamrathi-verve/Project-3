import type { ReactNode } from "react";

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

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace("#", "");
  const bigint = parseInt(clean, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
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
}: {
  columns: Column<T>[];
  rows: T[];
  empty?: string;
  bare?: boolean;
  /** Optional per-row class, e.g. to highlight overdue or high-risk rows. */
  rowClassName?: (row: T) => string;
  /** Optional <tr> rendered in a <tfoot>, e.g. a totals row. */
  footer?: ReactNode;
}) {
  const table = (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-slate-200 bg-slate-100 text-left">
          {columns.map((c) => (
            <th
              key={c.key}
              className={`whitespace-nowrap px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500 ${c.className ?? ""}`}
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
            <td colSpan={columns.length} className="px-4 py-10 text-center text-slate-400">
              {empty}
            </td>
          </tr>
        ) : (
          rows.map((row, i) => (
            <tr
              key={row.id}
              className={`border-b border-slate-100 last:border-0 transition-colors hover:bg-blue-50/50 ${
                i % 2 === 1 ? "bg-slate-50/60" : "bg-white"
              } ${rowClassName?.(row) ?? ""}`}
            >
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={`px-4 py-3 text-slate-700 ${c.className ?? ""}`}
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

  return <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">{table}</div>;
}
