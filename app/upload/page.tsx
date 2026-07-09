"use client";

import { useEffect, useMemo, useState } from "react";
import { DataTable, type Column } from "@/components/DataTable";
import { PageHeader } from "@/components/PageHeader";
import { NotConfigured } from "@/components/NotConfigured";
import { isConfigured, supabase } from "@/lib/supabase";
import { parseCsv } from "@/lib/csv";
import type { InvoiceStatus } from "@/lib/types";

type UploadType = "customers" | "invoices";

interface FieldDef {
  key: string;
  label: string;
  required?: boolean;
  numeric?: boolean;
  date?: boolean;
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
  { key: "invoice_date", label: "Invoice Date", required: true, date: true },
  { key: "customer_code", label: "Customer Code", required: true },
  { key: "due_date", label: "Due Date (optional)", date: true },
  { key: "description", label: "Description", required: true },
  { key: "qty", label: "Qty", required: true, numeric: true },
  { key: "rate", label: "Rate", required: true, numeric: true },
  { key: "tax_amount", label: "Tax Amount", numeric: true },
  { key: "notes", label: "Notes" },
];

interface Row {
  id: string;
  values: Record<string, string>;
}

interface CustomerLookup {
  id: string;
  code: string;
  credit_days: number;
}

function fieldsFor(type: UploadType): FieldDef[] {
  return type === "customers" ? CUSTOMER_FIELDS : INVOICE_FIELDS;
}

function rowErrors(type: UploadType, values: Record<string, string>, customerCodes: Set<string>): Record<string, string> {
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
    if (f.date && Number.isNaN(Date.parse(val))) {
      errors[f.key] = "Invalid date";
      continue;
    }
    if (type === "invoices" && f.key === "customer_code" && !customerCodes.has(val)) {
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

export default function UploadPage() {
  const [type, setType] = useState<UploadType>("customers");
  const [rows, setRows] = useState<Row[]>([]);
  const [customers, setCustomers] = useState<CustomerLookup[]>([]);
  const [inserting, setInserting] = useState(false);
  const [result, setResult] = useState<{ inserted: number; failed: number; messages: string[] } | null>(null);

  async function loadCustomers() {
    if (!supabase) return;
    const { data } = await supabase.from("customers").select("id,code,credit_days");
    setCustomers(data ?? []);
  }

  useEffect(() => {
    void loadCustomers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const customerCodes = useMemo(() => new Set(customers.map((c) => c.code)), [customers]);

  if (!isConfigured || !supabase) {
    return <NotConfigured />;
  }

  function switchType(next: UploadType) {
    setType(next);
    setRows([]);
    setResult(null);
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

  const validRows = rows.filter((r) => Object.keys(rowErrors(type, r.values, customerCodes)).length === 0);
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
        const customer = customers.find((c) => c.code === v.customer_code.trim());
        if (!customer) {
          failures.push({ id: row.id, message: "Customer not found" });
          continue;
        }
        const qty = Number(v.qty);
        const rate = Number(v.rate);
        const amount = qty * rate;
        const taxAmount = Number(v.tax_amount) || 0;
        const total = amount + taxAmount;
        const dueDate = v.due_date.trim() || addDays(v.invoice_date.trim(), customer.credit_days);
        const today = new Date().toISOString().slice(0, 10);
        const status: InvoiceStatus = dueDate < today ? "overdue" : "open";

        const { data: invoiceData, error: invoiceError } = await supabase
          .from("invoices")
          .insert({
            invoice_no: v.invoice_no.trim(),
            invoice_date: v.invoice_date.trim(),
            customer_id: customer.id,
            due_date: dueDate,
            subtotal: amount,
            tax_amount: taxAmount,
            total,
            status,
            notes: v.notes.trim() || null,
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
          amount,
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

  const columns: Column<Row>[] = [
    ...fieldsFor(type).map((f) => ({
      key: f.key,
      header: f.label,
      render: (row: Row) => {
        const errors = rowErrors(type, row.values, customerCodes);
        const hasError = Boolean(errors[f.key]);
        return (
          <input
            value={row.values[f.key]}
            onChange={(e) => updateCell(row.id, f.key, e.target.value)}
            title={errors[f.key] ?? ""}
            className={`w-full min-w-[8rem] rounded border px-2 py-1 text-xs outline-none focus:border-brand focus:ring-1 focus:ring-brand ${
              hasError ? "border-red-400 bg-red-50" : "border-slate-200 bg-white"
            }`}
          />
        );
      },
    })),
    {
      key: "__status",
      header: "Status",
      render: (row: Row) => {
        const errors = rowErrors(type, row.values, customerCodes);
        const count = Object.keys(errors).length;
        return count === 0 ? (
          <span className="whitespace-nowrap text-xs font-semibold text-emerald-600">OK</span>
        ) : (
          <span className="whitespace-nowrap text-xs font-semibold text-red-600">
            {count} issue{count > 1 ? "s" : ""}
          </span>
        );
      },
    },
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

        <a
          href={type === "customers" ? "/samples/sample-customers.csv" : "/samples/sample-invoices.csv"}
          download
          className="text-sm font-medium text-brand hover:underline"
        >
          Download sample {type} CSV
        </a>

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
        <>
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm text-slate-600">
              <span className="font-semibold text-slate-900">{rows.length}</span> row{rows.length > 1 ? "s" : ""} parsed —{" "}
              <span className="font-semibold text-emerald-600">{validRows.length} ready</span>
              {invalidCount > 0 && (
                <>
                  {" "}
                  · <span className="font-semibold text-red-600">{invalidCount} with issues</span>
                </>
              )}
            </p>
            <button
              type="button"
              disabled={validRows.length === 0 || inserting}
              onClick={handleInsertAll}
              className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-40"
            >
              {inserting ? "Inserting…" : `Insert ${validRows.length} valid row${validRows.length === 1 ? "" : "s"}`}
            </button>
          </div>

          <div className="overflow-x-auto">
            <DataTable columns={columns} rows={rows} />
          </div>

          {invalidCount > 0 && (
            <p className="mt-3 text-xs text-slate-500">
              Rows with issues are highlighted red. Fix the value directly in the table (hover a red box to see why),
              or fix the CSV and re-upload it.
            </p>
          )}
        </>
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
