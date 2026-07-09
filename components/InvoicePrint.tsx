"use client";

import { useEffect, useState } from "react";
import { supabase, isConfigured } from "@/lib/supabase";
import { NotConfigured } from "@/components/NotConfigured";
import type { Company, Customer, Invoice, InvoiceItem } from "@/lib/types";

function formatDate(d: string) {
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

/*
  A clean, printable invoice for one saved invoice. No app chrome — just the
  document. The browser's Print → Save as PDF (Ctrl/Cmd+P) turns this into a
  real invoice.
*/
export function InvoicePrint({ invoiceId }: { invoiceId: string }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [company, setCompany] = useState<Company | null>(null);
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [items, setItems] = useState<InvoiceItem[]>([]);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    let cancelled = false;

    async function load() {
      const [companyRes, invoiceRes, itemsRes] = await Promise.all([
        supabase!.from("company").select("*").limit(1).maybeSingle(),
        supabase!.from("invoices").select("*").eq("id", invoiceId).single(),
        supabase!.from("invoice_items").select("*").eq("invoice_id", invoiceId).order("id"),
      ]);
      if (cancelled) return;

      if (invoiceRes.error || !invoiceRes.data) {
        setError("Couldn't find that invoice.");
        setLoading(false);
        return;
      }

      const inv = invoiceRes.data as Invoice;
      setCompany((companyRes.data as Company | null) ?? null);
      setInvoice(inv);
      setItems((itemsRes.data as InvoiceItem[]) ?? []);

      const { data: custData } = await supabase!.from("customers").select("*").eq("id", inv.customer_id).single();
      if (!cancelled) {
        setCustomer((custData as Customer | null) ?? null);
        setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [invoiceId]);

  if (!isConfigured) return <NotConfigured />;
  if (loading) return <p className="text-sm text-slate-500">Loading…</p>;
  if (error || !invoice) return <p className="text-sm text-red-600">{error ?? "Invoice not found."}</p>;

  return (
    <div className="mx-auto max-w-3xl print:max-w-none">
      <div className="mb-6 flex justify-end print:hidden">
        <button
          onClick={() => window.print()}
          className="rounded-lg bg-brand px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark"
        >
          Print / Save as PDF
        </button>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-10 print:rounded-none print:border-0 print:p-0">
        <div className="flex items-start justify-between border-b border-slate-200 pb-6">
          <div>
            <h1 className="text-xl font-bold text-slate-900">{company?.name ?? "Your Company"}</h1>
            {company?.address && <p className="mt-1 whitespace-pre-line text-sm text-slate-500">{company.address}</p>}
            <p className="mt-1 text-sm text-slate-500">
              {[company?.gstin && `GSTIN: ${company.gstin}`, company?.email, company?.phone]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
          <div className="text-right">
            <h2 className="text-lg font-semibold uppercase tracking-wide text-brand">Tax Invoice</h2>
            <p className="mt-2 text-sm text-slate-600">
              Invoice No: <span className="font-medium text-slate-900">{invoice.invoice_no}</span>
            </p>
            <p className="text-sm text-slate-600">
              Invoice Date: <span className="font-medium text-slate-900">{formatDate(invoice.invoice_date)}</span>
            </p>
            <p className="text-sm text-slate-600">
              Due Date: <span className="font-medium text-slate-900">{formatDate(invoice.due_date)}</span>
            </p>
          </div>
        </div>

        <div className="mt-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Bill To</p>
          <p className="mt-1 font-semibold text-slate-900">{customer?.name ?? "—"}</p>
          {customer?.address && <p className="whitespace-pre-line text-sm text-slate-600">{customer.address}</p>}
          <p className="text-sm text-slate-600">
            {[customer?.gstin && `GSTIN: ${customer.gstin}`, customer?.email, customer?.phone]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>

        <table className="mt-8 w-full text-sm">
          <thead>
            <tr className="border-b border-slate-300 text-left">
              <th className="py-2 font-semibold text-slate-600">#</th>
              <th className="py-2 font-semibold text-slate-600">Description</th>
              <th className="py-2 text-right font-semibold text-slate-600">Qty</th>
              <th className="py-2 text-right font-semibold text-slate-600">Rate</th>
              <th className="py-2 text-right font-semibold text-slate-600">Amount</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, i) => (
              <tr key={it.id} className="border-b border-slate-100">
                <td className="py-2 text-slate-500">{i + 1}</td>
                <td className="py-2 text-slate-800">{it.description}</td>
                <td className="py-2 text-right text-slate-700">{it.qty}</td>
                <td className="py-2 text-right text-slate-700">{Number(it.rate).toFixed(2)}</td>
                <td className="py-2 text-right text-slate-700">{Number(it.amount).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-6 flex justify-end">
          <div className="w-64 space-y-1 text-sm">
            <div className="flex justify-between text-slate-600">
              <span>Subtotal</span>
              <span>{Number(invoice.subtotal).toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-slate-600">
              <span>Tax</span>
              <span>{Number(invoice.tax_amount).toFixed(2)}</span>
            </div>
            <div className="flex justify-between border-t border-slate-300 pt-1 text-base font-semibold text-slate-900">
              <span>Total</span>
              <span>{Number(invoice.total).toFixed(2)}</span>
            </div>
          </div>
        </div>

        {invoice.notes && (
          <div className="mt-6 border-t border-slate-200 pt-4 text-sm text-slate-600">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Notes</p>
            <p className="mt-1 whitespace-pre-line">{invoice.notes}</p>
          </div>
        )}

        <p className="mt-10 text-center text-xs text-slate-400">Thank you for your business.</p>
      </div>
    </div>
  );
}
