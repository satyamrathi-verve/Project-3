import { DownloadIcon } from "@/components/icons";

export type CsvColumn<T> = { header: string; value: (row: T) => string | number };

function escapeCsvCell(v: string | number) {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]) {
  const header = columns.map((c) => escapeCsvCell(c.header)).join(",");
  const body = rows.map((row) => columns.map((c) => escapeCsvCell(c.value(row))).join(",")).join("\n");
  return `${header}\n${body}`;
}

/*
  Pure client-side CSV export — no backend needed. Reusable for any list
  screen: pass the same rows/columns you already render in a DataTable.
*/
export function ExportCsvButton<T>({
  rows,
  columns,
  filename,
}: {
  rows: T[];
  columns: CsvColumn<T>[];
  filename: string;
}) {
  function handleExport() {
    const csv = toCsv(rows, columns);
    const blob = new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <button
      type="button"
      onClick={handleExport}
      disabled={rows.length === 0}
      className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-cream-dim disabled:cursor-not-allowed disabled:opacity-40"
    >
      <DownloadIcon />
      Export CSV
    </button>
  );
}
