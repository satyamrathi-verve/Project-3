"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { supabase, isConfigured } from "@/lib/supabase";
import { FormField, inputClass } from "@/components/FormField";
import { NotConfigured } from "@/components/NotConfigured";
import type { Customer, Invoice, InvoiceItem } from "@/lib/types";

interface LineItem {
  description: string;
  qty: string;
  rate: string;
}

const BLANK_ITEM: LineItem = { description: "", qty: "1", rate: "0" };

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(dateStr: string, days: number) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

async function nextInvoiceNo() {
  const { count } = await supabase!.from("invoices").select("id", { count: "exact", head: true });
  return `INV-${String((count ?? 0) + 1).padStart(4, "0")}`;
}

/*
  Shared by app/invoices/new and app/invoices/[id]/edit. Punches a new invoice
  or edits an existing one: pick a customer, add line items, tax auto-computes
  the total, and the due date auto-fills from the customer's credit days.
*/
export function InvoiceForm({ invoiceId }: { invoiceId?: string }) {
  const isEdit = Boolean(invoiceId);

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [customerId, setCustomerId] = useState("");
  const [invoiceNo, setInvoiceNo] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(todayISO());
  const [dueDate, setDueDate] = useState("");
  const [dueDateManual, setDueDateManual] = useState(false);
  const [notes, setNotes] = useState("");
  const [taxRate, setTaxRate] = useState("18");
  const [items, setItems] = useState<LineItem[]>([{ ...BLANK_ITEM }]);
  const [status, setStatus] = useState<Invoice["status"]>("open");
  const [savedId, setSavedId] = useState<string | null>(invoiceId ?? null);

  const hydrated = useRef(false);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    let cancelled = false;

    async function load() {
      const { data: custData } = await supabase!.from("customers").select("*").order("name");
      if (cancelled) return;
      setCustomers((custData as Customer[]) ?? []);

      if (invoiceId) {
        const { data: invData } = await supabase!.from("invoices").select("*").eq("id", invoiceId).single();
        const { data: itemData } = await supabase!
          .from("invoice_items")
          .select("*")
          .eq("invoice_id", invoiceId)
          .order("id");
        if (cancelled) return;

        const inv = invData as Invoice | null;
        if (inv) {
          setCustomerId(inv.customer_id);
          setInvoiceNo(inv.invoice_no);
          setInvoiceDate(inv.invoice_date);
          setDueDate(inv.due_date);
          setDueDateManual(true);
          setNotes(inv.notes ?? "");
          setStatus(inv.status);
          const subtotal = Number(inv.subtotal) || 0;
          const rate = subtotal > 0 ? ((Number(inv.tax_amount) || 0) / subtotal) * 100 : 0;
          setTaxRate(rate ? rate.toFixed(2) : "0");
        } else {
          setError("Couldn't find that invoice.");
        }

        const lineItems = (itemData as InvoiceItem[]) ?? [];
        if (lineItems.length) {
          setItems(
            lineItems.map((li) => ({
              description: li.description,
              qty: String(li.qty),
              rate: String(li.rate),
            }))
          );
        }
      } else {
        setInvoiceNo(await nextInvoiceNo());
      }

      if (!cancelled) {
        hydrated.current = true;
        setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [invoiceId]);

  // Due date auto-fills from the chosen customer's credit days, until the team edits it by hand.
  useEffect(() => {
    if (!hydrated.current || dueDateManual) return;
    const customer = customers.find((c) => c.id === customerId);
    if (!customer || !invoiceDate) return;
    setDueDate(addDays(invoiceDate, customer.credit_days ?? 0));
  }, [customerId, invoiceDate, customers, dueDateManual]);

  function updateItem(index: number, patch: Partial<LineItem>) {
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, ...patch } : it)));
  }

  function addLine() {
    setItems((prev) => [...prev, { ...BLANK_ITEM }]);
  }

  function removeLine(index: number) {
    setItems((prev) => (prev.length === 1 ? [{ ...BLANK_ITEM }] : prev.filter((_, i) => i !== index)));
  }

  const validItems = items.filter((it) => it.description.trim() && Number(it.qty) > 0);
  const subtotal = validItems.reduce((sum, it) => sum + Number(it.qty) * Number(it.rate), 0);
  const taxAmount = subtotal * (Number(taxRate) / 100 || 0);
  const total = subtotal + taxAmount;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!customerId) return setError("Pick a customer.");
    if (!invoiceNo.trim()) return setError("Enter an invoice number.");
    if (validItems.length === 0) return setError("Add at least one line item with a description and quantity.");

    setSaving(true);
    try {
      const payload = {
        invoice_no: invoiceNo.trim(),
        invoice_date: invoiceDate,
        customer_id: customerId,
        due_date: dueDate || invoiceDate,
        subtotal,
        tax_amount: taxAmount,
        total,
        status,
        notes: notes.trim() || null,
      };

      let id = invoiceId;

      if (isEdit && id) {
        const { error: updErr } = await supabase!.from("invoices").update(payload).eq("id", id);
        if (updErr) throw updErr;
        const { error: delErr } = await supabase!.from("invoice_items").delete().eq("invoice_id", id);
        if (delErr) throw delErr;
      } else {
        const { data: inserted, error: insErr } = await supabase!
          .from("invoices")
          .insert(payload)
          .select("id")
          .single();
        if (insErr) throw insErr;
        id = (inserted as { id: string }).id;
      }

      const { error: itemsErr } = await supabase!.from("invoice_items").insert(
        validItems.map((it) => ({
          invoice_id: id,
          description: it.description.trim(),
          qty: Number(it.qty),
          rate: Number(it.rate),
          amount: Number(it.qty) * Number(it.rate),
        }))
      );
      if (itemsErr) throw itemsErr;

      setSavedId(id ?? null);
      setSuccess(isEdit ? "Invoice updated." : `Invoice ${invoiceNo} created.`);

      if (!isEdit) {
        setCustomerId("");
        setInvoiceDate(todayISO());
        setDueDate("");
        setDueDateManual(false);
        setNotes("");
        setTaxRate("18");
        setItems([{ ...BLANK_ITEM }]);
        setInvoiceNo(await nextInvoiceNo());
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong saving the invoice.");
    } finally {
      setSaving(false);
    }
  }

  if (!isConfigured) return <NotConfigured />;
  if (loading) return <p className="text-sm text-slate-500">Loading…</p>;

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}
      {success && (
        <div className="flex items-center justify-between gap-4 rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          <span>{success}</span>
          {savedId && (
            <Link href={`/invoices/${savedId}/print`} className="font-medium text-brand underline hover:text-brand-dark">
              Print this invoice →
            </Link>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 rounded-xl border border-slate-200 bg-white p-6 sm:grid-cols-2 lg:grid-cols-4">
        <FormField label="Invoice No.">
          <input className={inputClass} value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} />
        </FormField>
        <FormField label="Invoice Date">
          <input
            type="date"
            className={inputClass}
            value={invoiceDate}
            onChange={(e) => setInvoiceDate(e.target.value)}
          />
        </FormField>
        <FormField label="Customer">
          <select className={inputClass} value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
            <option value="">Select a customer…</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code} — {c.name}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="Due Date">
          <input
            type="date"
            className={inputClass}
            value={dueDate}
            onChange={(e) => {
              setDueDateManual(true);
              setDueDate(e.target.value);
            }}
          />
        </FormField>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Line items</h3>
          <button
            type="button"
            onClick={addLine}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            + Add line
          </button>
        </div>

        <div className="mt-4 overflow-hidden rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left">
                <th className="px-3 py-2 font-semibold text-slate-600">Description</th>
                <th className="w-24 px-3 py-2 font-semibold text-slate-600">Qty</th>
                <th className="w-32 px-3 py-2 font-semibold text-slate-600">Rate</th>
                <th className="w-32 px-3 py-2 font-semibold text-slate-600">Amount</th>
                <th className="w-10 px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {items.map((item, i) => (
                <tr key={i} className="border-b border-slate-100 last:border-0">
                  <td className="px-3 py-2">
                    <input
                      className={`${inputClass} w-full`}
                      value={item.description}
                      onChange={(e) => updateItem(i, { description: e.target.value })}
                      placeholder="Item / service description"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      min="0"
                      step="1"
                      className={`${inputClass} w-full`}
                      value={item.qty}
                      onChange={(e) => updateItem(i, { qty: e.target.value })}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      className={`${inputClass} w-full`}
                      value={item.rate}
                      onChange={(e) => updateItem(i, { rate: e.target.value })}
                    />
                  </td>
                  <td className="px-3 py-2 text-slate-700">
                    {(Number(item.qty || 0) * Number(item.rate || 0)).toFixed(2)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => removeLine(i)}
                      className="text-slate-400 hover:text-red-600"
                      aria-label="Remove line"
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex justify-between gap-6">
        <div className="flex-1">
          <FormField label="Notes">
            <textarea className={inputClass} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </FormField>
        </div>

        <div className="w-full max-w-xs space-y-2 rounded-xl border border-slate-200 bg-white p-6">
          <div className="flex justify-between text-sm text-slate-600">
            <span>Subtotal</span>
            <span>{subtotal.toFixed(2)}</span>
          </div>
          <div className="flex items-center justify-between text-sm text-slate-600">
            <label htmlFor="taxRate" className="flex items-center gap-2">
              Tax
              <input
                id="taxRate"
                type="number"
                min="0"
                step="0.01"
                value={taxRate}
                onChange={(e) => setTaxRate(e.target.value)}
                className={`${inputClass} w-16 px-2 py-1`}
              />
              %
            </label>
            <span>{taxAmount.toFixed(2)}</span>
          </div>
          <div className="flex justify-between border-t border-slate-200 pt-2 text-base font-semibold text-slate-900">
            <span>Total</span>
            <span>{total.toFixed(2)}</span>
          </div>
        </div>
      </div>

      <div className="flex justify-end gap-3">
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-brand px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-50"
        >
          {saving ? "Saving…" : isEdit ? "Save changes" : "Create invoice"}
        </button>
      </div>
    </form>
  );
}
