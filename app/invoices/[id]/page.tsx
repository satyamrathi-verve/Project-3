"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { supabase, isConfigured } from "@/lib/supabase";
import type { Company, Customer, Invoice, InvoiceItem } from "@/lib/types";
import { NotConfigured } from "@/components/NotConfigured";
import { money, formatDate } from "@/lib/format";
import { effectiveStatus, overdueDays, STATUS_LABEL, STATUS_BADGE } from "@/lib/invoiceStatus";

type InvoiceWithCustomer = Invoice & { customers: Customer | null };

export default function InvoiceViewPage({ params }: { params: { id: string } }) {
  const [invoice, setInvoice] = useState<InvoiceWithCustomer | null>(null);
  const [items, setItems] = useState<InvoiceItem[]>([]);
  const [company, setCompany] = useState<Company | null>(null);
  const [received, setReceived] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    setLoadError(null);
    setNotFound(false);

    const [invoiceRes, itemsRes, allocationsRes, companyRes] = await Promise.all([
      supabase.from("invoices").select("*, customers(*)").eq("id", params.id).maybeSingle(),
      supabase.from("invoice_items").select("*").eq("invoice_id", params.id),
      supabase.from("receipt_allocations").select("amount").eq("invoice_id", params.id),
      supabase.from("company").select("*").limit(1).maybeSingle(),
    ]);

    const error = invoiceRes.error ?? itemsRes.error ?? allocationsRes.error ?? companyRes.error;
    if (error) {
      setLoadError(error.message);
      setLoading(false);
      return;
    }

    if (!invoiceRes.data) {
      setNotFound(true);
      setLoading(false);
      return;
    }

    setInvoice(invoiceRes.data as InvoiceWithCustomer);
    setItems((itemsRes.data ?? []) as InvoiceItem[]);
    setReceived((allocationsRes.data ?? []).reduce((sum, a) => sum + Number(a.amount), 0));
    setCompany((companyRes.data ?? null) as Company | null);
    setLoading(false);
  }, [params.id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!isConfigured || !supabase) return <NotConfigured />;

  if (loading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-cream px-4 py-10 text-center text-sm text-slate-400">
        Loading invoice…
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="rounded-xl border border-rose-300 bg-rose-50 p-6 text-rose-800">
        <p className="font-semibold">Couldn&apos;t load this invoice.</p>
        <p className="mt-1 text-sm">{loadError}</p>
        <button
          type="button"
          onClick={() => void load()}
          className="mt-3 rounded-lg border border-rose-300 px-3 py-1 text-sm font-medium hover:bg-rose-100"
        >
          Try again
        </button>
      </div>
    );
  }

  if (notFound || !invoice) {
    return (
      <div className="rounded-xl border border-slate-200 bg-cream p-10 text-center">
        <p className="font-semibold text-slate-700">This invoice doesn&apos;t exist.</p>
        <p className="mt-1 text-sm text-slate-500">It may have been removed, or the link is wrong.</p>
        <Link href="/invoices" className="mt-4 inline-block text-sm font-medium text-brand hover:underline">
          ← Back to Sales Invoices
        </Link>
      </div>
    );
  }

  const status = effectiveStatus(invoice);
  const days = overdueDays(invoice);
  const outstanding = invoice.total - received;
  const taxRate = invoice.subtotal > 0 ? Math.round((invoice.tax_amount / invoice.subtotal) * 100) : null;

  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/invoices" className="mb-4 inline-block text-sm font-medium text-brand hover:underline">
        ← Back to Sales Invoices
      </Link>

      {/* Header: our company (the "invoice header") on the left, this invoice's
          identity and status on the right. */}
      <div className="mb-6 flex flex-col gap-6 rounded-xl border border-slate-200 bg-cream p-6 shadow-sm sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-brand">Tax Invoice</p>
          <h2 className="mt-1 text-xl font-bold text-slate-900">{company?.name ?? "Verve Advisory Pvt Ltd"}</h2>
          {company?.address && <p className="mt-1 text-sm text-slate-500">{company.address}</p>}
          <p className="mt-1 text-sm text-slate-500">
            {[company?.gstin && `GSTIN ${company.gstin}`, company?.email, company?.phone].filter(Boolean).join(" · ")}
          </p>
        </div>

        <div className="sm:text-right">
          <span
            className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${STATUS_BADGE[status]}`}
          >
            {STATUS_LABEL[status]}
            {status === "overdue" && ` · ${days} ${days === 1 ? "day" : "days"}`}
          </span>
          <p className="mt-3 font-mono text-lg font-bold text-slate-900">{invoice.invoice_no}</p>
          <p className="mt-1 text-sm text-slate-500">Invoice Date: {formatDate(invoice.invoice_date)}</p>
          <p className={`text-sm ${status === "overdue" ? "font-semibold text-rose-600" : "text-slate-500"}`}>
            Due Date: {formatDate(invoice.due_date)}
          </p>
        </div>
      </div>

      {/* Customer block */}
      <div className="mb-6 rounded-xl border border-slate-200 bg-cream p-6 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Bill To</p>
        <h3 className="mt-1 text-lg font-semibold text-slate-900">{invoice.customers?.name ?? "Unknown customer"}</h3>
        {invoice.customers && (
          <div className="mt-2 grid gap-x-8 gap-y-1 text-sm text-slate-600 sm:grid-cols-2">
            {invoice.customers.address && <p>{invoice.customers.address}</p>}
            {invoice.customers.contact_person && <p>Attn: {invoice.customers.contact_person}</p>}
            {invoice.customers.email && <p>{invoice.customers.email}</p>}
            {invoice.customers.phone && <p>{invoice.customers.phone}</p>}
            {invoice.customers.gstin && <p>GSTIN {invoice.customers.gstin}</p>}
          </div>
        )}
      </div>

      {/* Line items */}
      <div className="mb-6 overflow-x-auto rounded-xl border border-slate-200 bg-cream shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b-2 border-brand/30 bg-brand/10 text-left">
              <th className="whitespace-nowrap px-4 py-3 text-xs font-bold uppercase tracking-wide text-brand-dark">
                Description
              </th>
              <th className="whitespace-nowrap px-4 py-3 text-right text-xs font-bold uppercase tracking-wide text-brand-dark">
                Qty
              </th>
              <th className="whitespace-nowrap px-4 py-3 text-right text-xs font-bold uppercase tracking-wide text-brand-dark">
                Rate
              </th>
              <th className="whitespace-nowrap px-4 py-3 text-right text-xs font-bold uppercase tracking-wide text-brand-dark">
                Amount
              </th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-slate-400">
                  No line items on this invoice.
                </td>
              </tr>
            ) : (
              items.map((item, i) => (
                <tr
                  key={item.id}
                  className={`border-b border-slate-100 last:border-0 ${i % 2 === 1 ? "bg-cream-dim/70" : ""}`}
                >
                  <td className="px-4 py-3 text-slate-700">{item.description}</td>
                  <td className="px-4 py-3 text-right text-slate-700">{item.qty}</td>
                  <td className="px-4 py-3 text-right text-slate-700">{money(item.rate)}</td>
                  <td className="px-4 py-3 text-right font-medium text-slate-900">{money(item.amount)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Money summary */}
      <div className="ml-auto max-w-sm rounded-xl border border-slate-200 bg-cream p-6 shadow-sm">
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between">
            <dt className="text-slate-500">Subtotal</dt>
            <dd className="text-slate-700">{money(invoice.subtotal)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-500">Tax{taxRate !== null ? ` (${taxRate}%)` : ""}</dt>
            <dd className="text-slate-700">{money(invoice.tax_amount)}</dd>
          </div>
          <div className="flex justify-between border-t border-slate-200 pt-2 text-base font-semibold text-slate-900">
            <dt>Total</dt>
            <dd>{money(invoice.total)}</dd>
          </div>
          <div className="flex justify-between pt-2">
            <dt className="text-slate-500">Amount Received</dt>
            <dd className="text-emerald-600">{money(received)}</dd>
          </div>
          <div className="flex justify-between border-t border-slate-200 pt-2 text-base font-bold">
            <dt className="text-slate-900">Amount Outstanding</dt>
            <dd className={outstanding > 0 ? "text-rose-600" : "text-emerald-600"}>
              {outstanding > 0 ? money(outstanding) : "Paid in full"}
            </dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
