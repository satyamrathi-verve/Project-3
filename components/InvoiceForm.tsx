"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { supabase, isConfigured } from "@/lib/supabase";
import { FormField, inputClass } from "@/components/FormField";
import { NotConfigured } from "@/components/NotConfigured";
import type { Customer, Invoice, InvoiceItem } from "@/lib/types";

interface LineItem {
  description: string;
  hsnSac: string;
  qty: string;
  unit: string;
  rate: string;
  discount: string;
  taxRate: string;
}

const BLANK_ITEM: LineItem = {
  description: "",
  hsnSac: "",
  qty: "1",
  unit: "Nos",
  rate: "0",
  discount: "0",
  taxRate: "18",
};

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

function lineTaxable(it: LineItem) {
  const gross = Number(it.qty || 0) * Number(it.rate || 0);
  return Math.max(0, gross - Number(it.discount || 0));
}

function lineTax(it: LineItem) {
  return lineTaxable(it) * (Number(it.taxRate || 0) / 100);
}

/*
  Shared by app/invoices/new and app/invoices/[id]/edit. Punches a new invoice
  or edits an existing one: pick a customer, add line items (with HSN/SAC, unit,
  per-line discount and tax rate), transporter / e-way bill / IRN details, and a
  shipping address. Due date auto-fills from the customer's credit days.
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
  const [items, setItems] = useState<LineItem[]>([{ ...BLANK_ITEM }]);
  const [status, setStatus] = useState<Invoice["status"]>("open");
  const [savedId, setSavedId] = useState<string | null>(invoiceId ?? null);

  const [placeOfSupply, setPlaceOfSupply] = useState("");
  const [reverseCharge, setReverseCharge] = useState(false);
  const [discountTotal, setDiscountTotal] = useState("0");

  const [transporterName, setTransporterName] = useState("");
  const [vehicleNo, setVehicleNo] = useState("");
  const [transporterDocNo, setTransporterDocNo] = useState("");
  const [transporterDocDate, setTransporterDocDate] = useState("");
  const [ewayBillNo, setEwayBillNo] = useState("");
  const [ewayBillDate, setEwayBillDate] = useState("");

  const [irn, setIrn] = useState("");
  const [ackNo, setAckNo] = useState("");
  const [ackDate, setAckDate] = useState("");

  const [shippingSame, setShippingSame] = useState(true);
  const [shippingName, setShippingName] = useState("");
  const [shippingGstin, setShippingGstin] = useState("");
  const [shippingAddress, setShippingAddress] = useState("");

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
          setPlaceOfSupply(inv.place_of_supply ?? "");
          setReverseCharge(inv.reverse_charge ?? false);
          setDiscountTotal(String(inv.discount_total ?? 0));
          setTransporterName(inv.transporter_name ?? "");
          setVehicleNo(inv.vehicle_no ?? "");
          setTransporterDocNo(inv.transporter_doc_no ?? "");
          setTransporterDocDate(inv.transporter_doc_date ?? "");
          setEwayBillNo(inv.eway_bill_no ?? "");
          setEwayBillDate(inv.eway_bill_date ?? "");
          setIrn(inv.irn ?? "");
          setAckNo(inv.ack_no ?? "");
          setAckDate(inv.ack_date ?? "");
          if (inv.shipping_name || inv.shipping_gstin || inv.shipping_address) {
            setShippingSame(false);
            setShippingName(inv.shipping_name ?? "");
            setShippingGstin(inv.shipping_gstin ?? "");
            setShippingAddress(inv.shipping_address ?? "");
          }
        } else {
          setError("Couldn't find that invoice.");
        }

        const lineItems = (itemData as InvoiceItem[]) ?? [];
        if (lineItems.length) {
          setItems(
            lineItems.map((li) => ({
              description: li.description,
              hsnSac: li.hsn_sac ?? "",
              qty: String(li.qty),
              unit: li.unit ?? "Nos",
              rate: String(li.rate),
              discount: String(li.discount ?? 0),
              taxRate: String(li.tax_rate ?? 18),
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

  // Shipping details mirror the customer's billing info until the team unchecks "same as billing".
  useEffect(() => {
    if (!hydrated.current || !shippingSame) return;
    const customer = customers.find((c) => c.id === customerId);
    if (!customer) return;
    setShippingName(customer.name);
    setShippingGstin(customer.gstin ?? "");
    setShippingAddress(customer.address ?? "");
  }, [customerId, customers, shippingSame]);

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
  const subtotal = validItems.reduce((sum, it) => sum + lineTaxable(it), 0);
  const taxAmount = validItems.reduce((sum, it) => sum + lineTax(it), 0);
  const extraDiscount = Number(discountTotal || 0);
  const total = subtotal + taxAmount - extraDiscount;

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
        place_of_supply: placeOfSupply.trim() || null,
        reverse_charge: reverseCharge,
        discount_total: extraDiscount,
        transporter_name: transporterName.trim() || null,
        vehicle_no: vehicleNo.trim() || null,
        transporter_doc_no: transporterDocNo.trim() || null,
        transporter_doc_date: transporterDocDate || null,
        eway_bill_no: ewayBillNo.trim() || null,
        eway_bill_date: ewayBillDate || null,
        irn: irn.trim() || null,
        ack_no: ackNo.trim() || null,
        ack_date: ackDate || null,
        shipping_name: shippingSame ? null : shippingName.trim() || null,
        shipping_gstin: shippingSame ? null : shippingGstin.trim() || null,
        shipping_address: shippingSame ? null : shippingAddress.trim() || null,
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
          hsn_sac: it.hsnSac.trim() || null,
          qty: Number(it.qty),
          unit: it.unit.trim() || "Nos",
          rate: Number(it.rate),
          discount: Number(it.discount || 0),
          tax_rate: Number(it.taxRate || 0),
          amount: lineTaxable(it),
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
        setPlaceOfSupply("");
        setReverseCharge(false);
        setDiscountTotal("0");
        setTransporterName("");
        setVehicleNo("");
        setTransporterDocNo("");
        setTransporterDocDate("");
        setEwayBillNo("");
        setEwayBillDate("");
        setIrn("");
        setAckNo("");
        setAckDate("");
        setShippingSame(true);
        setShippingName("");
        setShippingGstin("");
        setShippingAddress("");
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

      <div className="grid grid-cols-1 gap-4 rounded-xl border border-slate-200 bg-cream p-6 sm:grid-cols-2 lg:grid-cols-3">
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
        <FormField label="Place of Supply">
          <input
            className={inputClass}
            placeholder="e.g. 27-Maharashtra"
            value={placeOfSupply}
            onChange={(e) => setPlaceOfSupply(e.target.value)}
          />
        </FormField>
        <FormField label="Reverse Charge">
          <select
            className={inputClass}
            value={reverseCharge ? "yes" : "no"}
            onChange={(e) => setReverseCharge(e.target.value === "yes")}
          >
            <option value="no">No</option>
            <option value="yes">Yes</option>
          </select>
        </FormField>
      </div>

      <div className="rounded-xl border border-slate-200 bg-cream p-6">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Transporter Details</h3>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <FormField label="Transporter">
            <input className={inputClass} value={transporterName} onChange={(e) => setTransporterName(e.target.value)} />
          </FormField>
          <FormField label="Vehicle No.">
            <input className={inputClass} value={vehicleNo} onChange={(e) => setVehicleNo(e.target.value)} />
          </FormField>
          <FormField label="Transporter Doc No.">
            <input className={inputClass} value={transporterDocNo} onChange={(e) => setTransporterDocNo(e.target.value)} />
          </FormField>
          <FormField label="Transporter Doc Date">
            <input
              type="date"
              className={inputClass}
              value={transporterDocDate}
              onChange={(e) => setTransporterDocDate(e.target.value)}
            />
          </FormField>
          <FormField label="E-Way Bill No.">
            <input className={inputClass} value={ewayBillNo} onChange={(e) => setEwayBillNo(e.target.value)} />
          </FormField>
          <FormField label="E-Way Bill Date">
            <input
              type="date"
              className={inputClass}
              value={ewayBillDate}
              onChange={(e) => setEwayBillDate(e.target.value)}
            />
          </FormField>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-cream p-6">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">E-Invoice (IRN)</h3>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <FormField label="IRN">
            <input className={inputClass} value={irn} onChange={(e) => setIrn(e.target.value)} />
          </FormField>
          <FormField label="Ack No.">
            <input className={inputClass} value={ackNo} onChange={(e) => setAckNo(e.target.value)} />
          </FormField>
          <FormField label="Ack Date">
            <input type="date" className={inputClass} value={ackDate} onChange={(e) => setAckDate(e.target.value)} />
          </FormField>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-cream p-6">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Shipping Details</h3>
          <label className="flex items-center gap-2 text-xs font-medium text-slate-500">
            <input
              type="checkbox"
              checked={shippingSame}
              onChange={(e) => setShippingSame(e.target.checked)}
              className="rounded border-slate-300"
            />
            Same as billing
          </label>
        </div>
        {!shippingSame && (
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <FormField label="Name">
              <input className={inputClass} value={shippingName} onChange={(e) => setShippingName(e.target.value)} />
            </FormField>
            <FormField label="GSTIN">
              <input className={inputClass} value={shippingGstin} onChange={(e) => setShippingGstin(e.target.value)} />
            </FormField>
            <FormField label="Address">
              <input className={inputClass} value={shippingAddress} onChange={(e) => setShippingAddress(e.target.value)} />
            </FormField>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 bg-cream p-6">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Line items</h3>
          <button
            type="button"
            onClick={addLine}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-cream-dim"
          >
            + Add line
          </button>
        </div>

        <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-cream-dim text-left">
                <th className="px-3 py-2 font-semibold text-slate-600">Description</th>
                <th className="w-28 px-3 py-2 font-semibold text-slate-600">HSN/SAC</th>
                <th className="w-20 px-3 py-2 font-semibold text-slate-600">Qty</th>
                <th className="w-24 px-3 py-2 font-semibold text-slate-600">Unit</th>
                <th className="w-28 px-3 py-2 font-semibold text-slate-600">List Price</th>
                <th className="w-24 px-3 py-2 font-semibold text-slate-600">Disc.</th>
                <th className="w-20 px-3 py-2 font-semibold text-slate-600">Tax %</th>
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
                      className={`${inputClass} w-full`}
                      value={item.hsnSac}
                      onChange={(e) => updateItem(i, { hsnSac: e.target.value })}
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
                      className={`${inputClass} w-full`}
                      value={item.unit}
                      onChange={(e) => updateItem(i, { unit: e.target.value })}
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
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      className={`${inputClass} w-full`}
                      value={item.discount}
                      onChange={(e) => updateItem(i, { discount: e.target.value })}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      className={`${inputClass} w-full`}
                      value={item.taxRate}
                      onChange={(e) => updateItem(i, { taxRate: e.target.value })}
                    />
                  </td>
                  <td className="px-3 py-2 text-slate-700">{lineTaxable(item).toFixed(2)}</td>
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

      <div className="flex flex-col gap-6 lg:flex-row lg:justify-between">
        <div className="flex-1">
          <FormField label="Notes">
            <textarea className={inputClass} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </FormField>
        </div>

        <div className="w-full max-w-xs space-y-2 rounded-xl border border-slate-200 bg-cream p-6">
          <div className="flex justify-between text-sm text-slate-600">
            <span>Subtotal</span>
            <span>{subtotal.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-sm text-slate-600">
            <span>Tax</span>
            <span>{taxAmount.toFixed(2)}</span>
          </div>
          <div className="flex items-center justify-between text-sm text-slate-600">
            <span>Discount</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={discountTotal}
              onChange={(e) => setDiscountTotal(e.target.value)}
              className={`${inputClass} w-24 px-2 py-1 text-right`}
            />
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
