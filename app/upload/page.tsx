"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { DataTable, type Column } from "@/components/DataTable";
import { PageHeader } from "@/components/PageHeader";
import { NotConfigured } from "@/components/NotConfigured";
import { isConfigured, supabase } from "@/lib/supabase";
import { parseCsv } from "@/lib/csv";
import { colorForIndex } from "@/lib/colors";
import type { InvoiceStatus } from "@/lib/types";

type UploadType = "customers" | "invoices";

interface FieldDef {
  key: string;
  label: string;
  required?: boolean;
  numeric?: boolean;
  date?: boolean;
  /** Numeric fields only: value must be <= 0 (e.g. TDS, a deduction). */
  nonPositive?: boolean;
  /** Numeric fields only: value must be >= 0 (e.g. Credit Period, a day count). */
  nonNegative?: boolean;
}

const CUSTOMER_FIELDS: FieldDef[] = [
  { key: "code", label: "Code", required: true },
  { key: "name", label: "Name", required: true },
  { key: "contact_person", label: "Contact Person" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
  { key: "address", label: "Address" },
  { key: "gstin", label: "GSTIN" },
  { key: "pan", label: "PAN" },
  { key: "credit_limit", label: "Credit Limit", numeric: true },
  { key: "credit_days", label: "Credit Days", numeric: true },
  { key: "opening_balance", label: "Opening Balance", numeric: true },
];

const INVOICE_FIELDS: FieldDef[] = [
  { key: "invoice_no", label: "Invoice No", required: true },
  { key: "ref_no", label: "Ref No" },
  { key: "invoice_date", label: "Invoice Date", required: true, date: true },
  { key: "customer_code", label: "Customer Code", required: true },
  // Days of credit for this invoice — overrides the customer's default credit_days
  // when set. Due Date (fed straight into the AR Ageing report's bucketing) is
  // always derived from this, never typed directly, so the two screens can't disagree.
  { key: "credit_period", label: "Credit Period", numeric: true, nonNegative: true },
  { key: "description", label: "Description", required: true },
  { key: "qty", label: "Qty", required: true, numeric: true },
  { key: "rate", label: "Rate", required: true, numeric: true },
  { key: "igst", label: "IGST", numeric: true },
  { key: "cgst", label: "CGST", numeric: true },
  { key: "sgst", label: "SGST", numeric: true },
  { key: "tds", label: "TDS", numeric: true, nonPositive: true },
  { key: "narration", label: "Narration" },
];

// Example rows for the "download sample CSV" button. Headers are generated from
// CUSTOMER_FIELDS/INVOICE_FIELDS above at click time (see buildSampleCsv), so the
// downloaded file can never drift out of sync with the columns the preview expects
// — only these example values need to stay hand-written.
const SAMPLE_CUSTOMER_ROWS: Record<string, string>[] = [
  {
    code: "CUST101",
    name: "Bluewave Logistics Pvt Ltd",
    contact_person: "Sanjay Kulkarni",
    email: "sanjay@bluewave.in",
    phone: "+91 98220 44444",
    address: "Pune",
    gstin: "27AABCB4444D1Z4",
    pan: "AABCB4444D",
    credit_limit: "400000",
    credit_days: "30",
    opening_balance: "0",
  },
  {
    code: "CUST102",
    name: "Harborline Foods LLP",
    contact_person: "Meera Iyer",
    email: "meera@harborline.in",
    phone: "+91 98450 55555",
    address: "Chennai",
    gstin: "33AABCH5555E1Z5",
    pan: "AABCH5555E",
    credit_limit: "250000",
    credit_days: "15",
    opening_balance: "5000",
  },
  {
    code: "CUST103",
    name: "",
    contact_person: "Devika Nair",
    email: "devika@orbitpack.in",
    phone: "+91 98770 66666",
    address: "Kochi",
    gstin: "32AABCO6666F1Z6",
    pan: "AABCO6666F",
    credit_limit: "600000",
    credit_days: "45",
    opening_balance: "0",
  },
];

// customer_name, due_date, and taxable_value are shown here purely for reference —
// they mirror the three computed/looked-up columns in the preview table
// (customer_name from customer_code; due_date from invoice_date + credit_period,
// or the customer's default credit_days if left blank; taxable_value = qty*rate).
// None are real input fields, so all three are ignored if this file is re-uploaded.
const SAMPLE_INVOICE_ROWS: Record<string, string>[] = [
  {
    invoice_no: "INV-9001",
    ref_no: "PO-5501",
    invoice_date: "2026-06-01",
    customer_code: "CUST001",
    customer_name: "Sterling Textiles Pvt Ltd",
    credit_period: "",
    due_date: "2026-07-01",
    description: "Cotton yarn - bulk order",
    qty: "100",
    rate: "450",
    taxable_value: "45000",
    igst: "",
    cgst: "2250",
    sgst: "2250",
    tds: "-2500",
    narration: "Bulk CSV import test",
  },
  {
    invoice_no: "INV-9002",
    ref_no: "PO-5502",
    invoice_date: "2026-06-05",
    customer_code: "CUST002",
    customer_name: "Greenleaf Organics LLP",
    credit_period: "15",
    due_date: "2026-06-20",
    description: "Organic packaging supplies",
    qty: "50",
    rate: "220",
    taxable_value: "11000",
    igst: "1100",
    cgst: "",
    sgst: "",
    tds: "",
    narration: "",
  },
  {
    invoice_no: "INV-9003",
    ref_no: "PO-5503",
    invoice_date: "2026-06-10",
    customer_code: "CUST999",
    customer_name: "",
    credit_period: "",
    due_date: "",
    description: "Custom order",
    qty: "20",
    rate: "300",
    taxable_value: "6000",
    igst: "600",
    cgst: "",
    sgst: "",
    tds: "",
    narration: "Unknown customer code on purpose",
  },
  {
    invoice_no: "INV-9004",
    ref_no: "",
    invoice_date: "2026-06-12",
    customer_code: "CUST003",
    customer_name: "Nimbus Software Solutions",
    credit_period: "",
    due_date: "2026-07-27",
    description: "Software support retainer",
    qty: "",
    rate: "5000",
    taxable_value: "",
    igst: "",
    cgst: "450",
    sgst: "450",
    tds: "300",
    narration: "Missing qty on purpose (and TDS entered as positive on purpose)",
  },
];

// Column order for the downloadable invoice template — matches the preview table
// exactly (including the two reference-only computed columns), unlike INVOICE_FIELDS
// above which is the real input/validation schema used for parsing and inserts.
const INVOICE_SAMPLE_COLUMNS = [
  "invoice_no",
  "ref_no",
  "invoice_date",
  "customer_code",
  "customer_name",
  "credit_period",
  "due_date",
  "description",
  "qty",
  "rate",
  "taxable_value",
  "igst",
  "cgst",
  "sgst",
  "tds",
  "narration",
];

function toCsvValue(v: string): string {
  if (v.includes(",") || v.includes('"') || v.includes("\n")) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}

function buildSampleCsv(type: UploadType): string {
  if (type === "customers") {
    const headerLine = CUSTOMER_FIELDS.map((f) => f.key).join(",");
    const dataLines = SAMPLE_CUSTOMER_ROWS.map((r) => CUSTOMER_FIELDS.map((f) => toCsvValue(r[f.key] ?? "")).join(","));
    return [headerLine, ...dataLines].join("\n") + "\n";
  }
  const headerLine = INVOICE_SAMPLE_COLUMNS.join(",");
  const dataLines = SAMPLE_INVOICE_ROWS.map((r) => INVOICE_SAMPLE_COLUMNS.map((k) => toCsvValue(r[k] ?? "")).join(","));
  return [headerLine, ...dataLines].join("\n") + "\n";
}

function downloadSampleCsv(type: UploadType) {
  const csv = buildSampleCsv(type);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `sample-${type}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

interface Row {
  id: string;
  values: Record<string, string>;
}

interface CustomerLookup {
  id: string;
  code: string;
  name: string;
  credit_days: number;
}

function fieldsFor(type: UploadType): FieldDef[] {
  return type === "customers" ? CUSTOMER_FIELDS : INVOICE_FIELDS;
}

function rowErrors(type: UploadType, values: Record<string, string>, customersByCode: Map<string, CustomerLookup>): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const f of fieldsFor(type)) {
    const val = values[f.key]?.trim() ?? "";
    if (f.required && !val) {
      errors[f.key] = "Required";
      continue;
    }
    if (!val) continue;
    if (f.numeric && Number.isNaN(Number(val))) {
      errors[f.key] = "Must be a number";
      continue;
    }
    if (f.nonPositive && Number(val) > 0) {
      errors[f.key] = "Must be zero or negative (it's a deduction)";
      continue;
    }
    if (f.nonNegative && Number(val) < 0) {
      errors[f.key] = "Must be zero or positive (it's a day count)";
      continue;
    }
    if (f.date && Number.isNaN(Date.parse(val))) {
      errors[f.key] = "Invalid date";
      continue;
    }
    if (type === "invoices" && f.key === "customer_code" && !customersByCode.has(val)) {
      errors[f.key] = "No matching customer";
    }
  }
  return errors;
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function taxableValue(v: Record<string, string>): number {
  const qty = Number(v.qty) || 0;
  const rate = Number(v.rate) || 0;
  return qty * rate;
}

// The date that actually lands in invoices.due_date, and the only thing the AR
// Ageing report reads to bucket a balance — so this preview column always
// mirrors what will get synced, before you even insert.
function resolvedDueDate(v: Record<string, string>, customer: CustomerLookup | undefined): string | null {
  const invoiceDate = v.invoice_date.trim();
  if (!invoiceDate || Number.isNaN(Date.parse(invoiceDate))) return null;
  const creditPeriodStr = v.credit_period.trim();
  const days =
    creditPeriodStr !== "" && !Number.isNaN(Number(creditPeriodStr)) ? Number(creditPeriodStr) : customer?.credit_days;
  if (days === undefined) return null;
  return addDays(invoiceDate, days);
}

function money(n: number): string {
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function ChevronLeftIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
    </svg>
  );
}

export default function UploadPage() {
  const [type, setType] = useState<UploadType>("customers");
  const [rows, setRows] = useState<Row[]>([]);
  const [customers, setCustomers] = useState<CustomerLookup[]>([]);
  const [inserting, setInserting] = useState(false);
  const [result, setResult] = useState<{ inserted: number; failed: number; messages: string[] } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  async function loadCustomers() {
    if (!supabase) return;
    const { data } = await supabase.from("customers").select("id,code,name,credit_days");
    setCustomers(data ?? []);
  }

  useEffect(() => {
    void loadCustomers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const customersByCode = useMemo(() => new Map(customers.map((c) => [c.code, c])), [customers]);

  if (!isConfigured || !supabase) {
    return <NotConfigured />;
  }

  function switchType(next: UploadType) {
    setType(next);
    setRows([]);
    setResult(null);
  }

  function scrollPreview(delta: number) {
    scrollRef.current?.scrollBy({ left: delta, behavior: "smooth" });
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const text = await file.text();
    const { rows: parsed } = parseCsv(text);
    const fields = fieldsFor(type);
    const newRows: Row[] = parsed.map((r, i) => ({
      id: `row-${Date.now()}-${i}`,
      values: Object.fromEntries(fields.map((f) => [f.key, r[f.key] ?? ""])),
    }));
    setRows(newRows);
    setResult(null);
  }

  function updateCell(id: string, key: string, value: string) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, values: { ...r.values, [key]: value } } : r)));
  }

  const validRows = rows.filter((r) => Object.keys(rowErrors(type, r.values, customersByCode)).length === 0);
  const invalidCount = rows.length - validRows.length;

  async function handleInsertAll() {
    if (!supabase) return;
    setInserting(true);
    setResult(null);

    const succeeded: string[] = [];
    const failures: { id: string; message: string }[] = [];

    if (type === "customers") {
      for (const row of validRows) {
        const v = row.values;
        const { error } = await supabase.from("customers").insert({
          code: v.code.trim(),
          name: v.name.trim(),
          contact_person: v.contact_person.trim() || null,
          email: v.email.trim() || null,
          phone: v.phone.trim() || null,
          address: v.address.trim() || null,
          gstin: v.gstin.trim() || null,
          pan: v.pan.trim() || null,
          credit_limit: Number(v.credit_limit) || 0,
          credit_days: Number(v.credit_days) || 0,
          opening_balance: Number(v.opening_balance) || 0,
        });
        if (error) failures.push({ id: row.id, message: error.message });
        else succeeded.push(row.id);
      }
      await loadCustomers();
    } else {
      for (const row of validRows) {
        const v = row.values;
        const customer = customersByCode.get(v.customer_code.trim());
        if (!customer) {
          failures.push({ id: row.id, message: "Customer not found" });
          continue;
        }
        const qty = Number(v.qty);
        const rate = Number(v.rate);
        const subtotal = qty * rate;
        const taxAmount = (Number(v.igst) || 0) + (Number(v.cgst) || 0) + (Number(v.sgst) || 0);
        const tds = Number(v.tds) || 0; // always <= 0 by validation — a deduction before payment
        const total = subtotal + taxAmount + tds;
        const creditPeriodStr = v.credit_period.trim();
        const creditDays = creditPeriodStr !== "" ? Number(creditPeriodStr) : customer.credit_days;
        const dueDate = addDays(v.invoice_date.trim(), creditDays);
        const today = new Date().toISOString().slice(0, 10);
        const status: InvoiceStatus = dueDate < today ? "overdue" : "open";
        // invoices has no dedicated ref_no/TDS column, so fold both into the narration
        // rather than lose them — never adding a column per the "don't touch the backend" rule.
        const refNo = v.ref_no.trim();
        const narrationParts = [
          refNo && `Ref: ${refNo}`,
          tds !== 0 && `TDS: ${tds}`,
          v.narration.trim(),
        ].filter(Boolean);
        const notes = narrationParts.length > 0 ? narrationParts.join(" — ") : null;

        const { data: invoiceData, error: invoiceError } = await supabase
          .from("invoices")
          .insert({
            invoice_no: v.invoice_no.trim(),
            invoice_date: v.invoice_date.trim(),
            customer_id: customer.id,
            due_date: dueDate,
            subtotal,
            tax_amount: taxAmount,
            total,
            status,
            notes,
          })
          .select("id")
          .single();

        if (invoiceError || !invoiceData) {
          failures.push({ id: row.id, message: invoiceError?.message ?? "Insert failed" });
          continue;
        }

        const { error: itemError } = await supabase.from("invoice_items").insert({
          invoice_id: invoiceData.id,
          description: v.description.trim(),
          qty,
          rate,
          amount: subtotal,
        });

        if (itemError) {
          failures.push({ id: row.id, message: `Invoice created but line item failed: ${itemError.message}` });
        } else {
          succeeded.push(row.id);
        }
      }
    }

    setRows((prev) => prev.filter((r) => !succeeded.includes(r.id)));
    setResult({
      inserted: succeeded.length,
      failed: failures.length,
      messages: failures.map((f) => f.message),
    });
    setInserting(false);
  }

  function editableColumn(f: FieldDef, colorIndex: number): Column<Row> {
    return {
      key: f.key,
      header: f.label,
      className: f.numeric ? "text-right" : undefined,
      accentColor: colorForIndex(colorIndex),
      render: (row: Row) => {
        const errors = rowErrors(type, row.values, customersByCode);
        const hasError = Boolean(errors[f.key]);
        return (
          <input
            value={row.values[f.key]}
            onChange={(e) => updateCell(row.id, f.key, e.target.value)}
            title={errors[f.key] ?? ""}
            className={`w-full min-w-[7rem] rounded border px-2 py-1 text-xs outline-none focus:border-brand focus:ring-1 focus:ring-brand ${
              f.numeric ? "text-right tabular-nums" : ""
            } ${hasError ? "border-red-400 bg-red-50" : "border-slate-200 bg-white"}`}
          />
        );
      },
    };
  }

  const statusColumn: Column<Row> = {
    key: "__status",
    header: "Status",
    render: (row: Row) => {
      const errors = rowErrors(type, row.values, customersByCode);
      const count = Object.keys(errors).length;
      return count === 0 ? (
        <span className="whitespace-nowrap text-xs font-semibold text-emerald-600">OK</span>
      ) : (
        <span className="whitespace-nowrap text-xs font-semibold text-red-600">
          {count} issue{count > 1 ? "s" : ""}
        </span>
      );
    },
  };

  const invoiceField = (key: string) => INVOICE_FIELDS.find((f) => f.key === key)!;

  const columns: Column<Row>[] =
    type === "customers"
      ? [...CUSTOMER_FIELDS.map((f, i) => editableColumn(f, i)), statusColumn]
      : [
          editableColumn(invoiceField("invoice_no"), 0),
          editableColumn(invoiceField("ref_no"), 1),
          editableColumn(invoiceField("invoice_date"), 2),
          editableColumn(invoiceField("customer_code"), 3),
          {
            key: "__customer_name",
            header: "Customer Name",
            accentColor: colorForIndex(4),
            render: (row: Row) => {
              const customer = customersByCode.get(row.values.customer_code.trim());
              return customer ? (
                <span className="whitespace-nowrap text-xs text-slate-600">{customer.name}</span>
              ) : (
                <span className="text-xs italic text-slate-300">—</span>
              );
            },
          },
          editableColumn(invoiceField("credit_period"), 5),
          {
            key: "__due_date",
            header: "Due Date",
            accentColor: colorForIndex(6),
            render: (row: Row) => {
              const customer = customersByCode.get(row.values.customer_code.trim());
              const due = resolvedDueDate(row.values, customer);
              return due ? (
                <span className="whitespace-nowrap text-xs text-slate-600">{due}</span>
              ) : (
                <span className="text-xs italic text-slate-300">—</span>
              );
            },
          },
          editableColumn(invoiceField("description"), 7),
          editableColumn(invoiceField("qty"), 0),
          editableColumn(invoiceField("rate"), 1),
          {
            key: "__taxable_value",
            header: "Taxable Value-Qty*Rate",
            className: "text-right",
            accentColor: colorForIndex(2),
            render: (row: Row) => (
              <span className="whitespace-nowrap text-xs font-medium tabular-nums text-slate-700">
                {money(taxableValue(row.values))}
              </span>
            ),
          },
          editableColumn(invoiceField("igst"), 3),
          editableColumn(invoiceField("cgst"), 4),
          editableColumn(invoiceField("sgst"), 5),
          editableColumn(invoiceField("tds"), 6),
          editableColumn(invoiceField("narration"), 7),
          statusColumn,
        ];

  return (
    <div>
      <PageHeader
        title="Upload Report"
        subtitle="Bulk-import customers or invoices from a CSV file instead of punching them one by one."
      />

      <div className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex rounded-lg border border-slate-200 p-1">
          <button
            type="button"
            onClick={() => switchType("customers")}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              type === "customers" ? "bg-brand text-white" : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            Customers
          </button>
          <button
            type="button"
            onClick={() => switchType("invoices")}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              type === "invoices" ? "bg-brand text-white" : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            Invoices
          </button>
        </div>

        <button
          type="button"
          onClick={() => downloadSampleCsv(type)}
          className="text-sm font-medium text-brand hover:underline"
        >
          Download sample {type} CSV
        </button>

        <label className="ml-auto cursor-pointer rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">
          Choose CSV file
          <input type="file" accept=".csv" onChange={handleFileChange} className="hidden" />
        </label>
      </div>

      {rows.length === 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-slate-400">
          No file uploaded yet. Choose a CSV above to preview its rows here.
        </div>
      )}

      {rows.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-slate-800">Preview</p>
              <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-600">
                {rows.length} row{rows.length > 1 ? "s" : ""}
              </span>
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                {validRows.length} ready
              </span>
              {invalidCount > 0 && (
                <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">
                  {invalidCount} issue{invalidCount > 1 ? "s" : ""}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => scrollPreview(-320)}
                aria-label="Scroll preview left"
                className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-500 transition-colors hover:border-brand hover:text-brand"
              >
                <ChevronLeftIcon />
              </button>
              <button
                type="button"
                onClick={() => scrollPreview(320)}
                aria-label="Scroll preview right"
                className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-500 transition-colors hover:border-brand hover:text-brand"
              >
                <ChevronRightIcon />
              </button>
              <button
                type="button"
                disabled={validRows.length === 0 || inserting}
                onClick={handleInsertAll}
                className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-40"
              >
                {inserting ? "Inserting…" : `Insert ${validRows.length} valid row${validRows.length === 1 ? "" : "s"}`}
              </button>
            </div>
          </div>

          <div ref={scrollRef} className="overflow-x-auto">
            <DataTable columns={columns} rows={rows} bare />
          </div>

          {invalidCount > 0 && (
            <p className="border-t border-slate-100 bg-slate-50/50 px-4 py-2 text-xs text-slate-500">
              Rows with issues are highlighted red. Fix the value directly in the table (hover a red box to see why),
              or fix the CSV and re-upload it.
            </p>
          )}
        </div>
      )}

      {result && (
        <div
          className={`mt-6 rounded-xl border p-4 text-sm ${
            result.failed === 0 ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-amber-300 bg-amber-50 text-amber-800"
          }`}
        >
          <p className="font-semibold">
            Inserted {result.inserted} row{result.inserted === 1 ? "" : "s"}
            {result.failed > 0 && `, ${result.failed} failed`}.
          </p>
          {result.messages.length > 0 && (
            <ul className="mt-2 list-inside list-disc space-y-1">
              {result.messages.map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
