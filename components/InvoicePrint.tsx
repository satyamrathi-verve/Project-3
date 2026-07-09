"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { supabase, isConfigured } from "@/lib/supabase";
import { NotConfigured } from "@/components/NotConfigured";
import { rupeesInWords } from "@/lib/numberToWords";
import type { Company, Customer, Invoice, InvoiceItem } from "@/lib/types";

function formatDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function money(n: number) {
  return n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/*
  A clean, printable GST tax invoice for one saved invoice. No app chrome —
  just the document. The browser's Print → Save as PDF (Ctrl/Cmd+P) turns this
  into a real invoice.
*/
export function InvoicePrint({ invoiceId }: { invoiceId: string }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [company, setCompany] = useState<Company | null>(null);
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [items, setItems] = useState<InvoiceItem[]>([]);
  const [paid, setPaid] = useState(0);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    let cancelled = false;

    async function load() {
      const [companyRes, invoiceRes, itemsRes, allocRes] = await Promise.all([
        supabase!.from("company").select("*").limit(1).maybeSingle(),
        supabase!.from("invoices").select("*").eq("id", invoiceId).single(),
        supabase!.from("invoice_items").select("*").eq("invoice_id", invoiceId).order("id"),
        supabase!.from("receipt_allocations").select("amount").eq("invoice_id", invoiceId),
      ]);
      if (cancelled) return;

      if (invoiceRes.error || !invoiceRes.data) {
        setError("Couldn't find that invoice.");
        setLoading(false);
        return;
      }

      const inv = invoiceRes.data as Invoice;
      const comp = (companyRes.data as Company | null) ?? null;
      setCompany(comp);
      setInvoice(inv);
      setItems((itemsRes.data as InvoiceItem[]) ?? []);
      const allocations = (allocRes.data as { amount: number }[] | null) ?? [];
      setPaid(allocations.reduce((sum, a) => sum + Number(a.amount), 0));

      const { data: custData } = await supabase!.from("customers").select("*").eq("id", inv.customer_id).single();
      if (cancelled) return;
      setCustomer((custData as Customer | null) ?? null);

      const qrPayload = [
        `Invoice:${inv.invoice_no}`,
        `Date:${inv.invoice_date}`,
        `Total:${inv.total}`,
        inv.irn ? `IRN:${inv.irn}` : null,
        comp?.gstin ? `GSTIN:${comp.gstin}` : null,
      ]
        .filter(Boolean)
        .join("|");
      try {
        const url = await QRCode.toDataURL(qrPayload, { width: 120, margin: 0 });
        if (!cancelled) setQrDataUrl(url);
      } catch {
        // QR is decorative — a failed render just leaves the placeholder box.
      }

      setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [invoiceId]);

  if (!isConfigured) return <NotConfigured />;
  if (loading) return <p className="text-sm text-slate-500">Loading…</p>;
  if (error || !invoice) return <p className="text-sm text-red-600">{error ?? "Invoice not found."}</p>;

  const balance = Number(invoice.total) - paid;
  const cgst = Number(invoice.tax_amount) / 2;
  const sgst = Number(invoice.tax_amount) / 2;
  const terms = (company?.terms_conditions ?? "").split("\n").filter(Boolean);
  const shippingName = invoice.shipping_name ?? customer?.name ?? null;
  const shippingGstin = invoice.shipping_gstin ?? customer?.gstin ?? null;
  const shippingAddress = invoice.shipping_address ?? customer?.address ?? null;

  return (
    <div className="mx-auto max-w-4xl print:max-w-none">
      <div className="mb-6 flex justify-end print:hidden">
        <button
          onClick={() => window.print()}
          className="rounded-lg bg-brand px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark"
        >
          Print / Save as PDF
        </button>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-8 text-sm print:rounded-none print:border-0 print:p-0 print:text-xs">
        <div className="flex justify-between text-xs text-slate-500">
          <span>Page No. 1 of 1</span>
          <span className="font-medium">Original Copy</span>
        </div>
        <h1 className="mt-2 text-center text-lg font-bold uppercase tracking-wide text-slate-900">Tax Invoice</h1>

        <div className="mt-4 flex items-start justify-between gap-6 border-t border-b border-slate-200 py-4">
          <div className="flex gap-4">
            {company?.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={company.logo_url} alt="" className="h-14 w-14 rounded object-contain" />
            ) : (
              <div className="flex h-14 w-14 flex-none items-center justify-center rounded border border-dashed border-slate-300 text-[10px] text-slate-400">
                Logo
              </div>
            )}
            <div>
              <h2 className="text-base font-bold text-slate-900">{company?.name ?? "Add Company Name"}</h2>
              <p className="mt-0.5 whitespace-pre-line text-slate-500">{company?.address ?? "Add Address"}</p>
              <p className="mt-0.5 text-slate-500">
                {company?.phone ? `Mobile: ${company.phone}` : "Mobile: —"}
                {company?.email ? ` | Email: ${company.email}` : ""}
              </p>
              <p className="mt-0.5 text-slate-500">
                GSTIN: {company?.gstin ?? "—"} | PAN: {company?.pan ?? "—"}
              </p>
            </div>
          </div>
          <div className="flex-none text-right">
            <p>
              Invoice Number: <span className="font-semibold text-slate-900">{invoice.invoice_no}</span>
            </p>
            <p>
              Invoice Date: <span className="font-semibold text-slate-900">{formatDate(invoice.invoice_date)}</span>
            </p>
            <p>
              Due Date: <span className="font-semibold text-slate-900">{formatDate(invoice.due_date)}</span>
            </p>
            <p>
              Place of Supply: <span className="font-semibold text-slate-900">{invoice.place_of_supply ?? "—"}</span>
            </p>
            <p>
              Reverse Charge:{" "}
              <span className="font-semibold text-slate-900">{invoice.reverse_charge ? "Yes" : "No"}</span>
            </p>
          </div>
        </div>

        <div className="mt-4 rounded-lg border border-slate-200 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Transporter Details</p>
          <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-slate-600 sm:grid-cols-3">
            <p>Transporter: <span className="text-slate-900">{invoice.transporter_name ?? "—"}</span></p>
            <p>Vehicle No.: <span className="text-slate-900">{invoice.vehicle_no ?? "—"}</span></p>
            <p>Transporter Doc No.: <span className="text-slate-900">{invoice.transporter_doc_no ?? "—"}</span></p>
            <p>Transporter Doc Date: <span className="text-slate-900">{formatDate(invoice.transporter_doc_date)}</span></p>
            <p>E-Way Bill No.: <span className="text-slate-900">{invoice.eway_bill_no ?? "—"}</span></p>
            <p>E-Way Bill Date: <span className="text-slate-900">{formatDate(invoice.eway_bill_date)}</span></p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Billing Details</p>
            <p className="mt-1 font-semibold text-slate-900">{customer?.name ?? "—"}</p>
            <p className="text-slate-600">
              GSTIN: {customer?.gstin ?? "—"} | Mobile: {customer?.phone ?? "—"} | Email: {customer?.email ?? "—"}
            </p>
            <p className="whitespace-pre-line text-slate-600">{customer?.address ?? "—"}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Shipping Details</p>
            <p className="mt-1 font-semibold text-slate-900">{shippingName ?? "—"}</p>
            <p className="text-slate-600">GSTIN: {shippingGstin ?? "—"}</p>
            <p className="whitespace-pre-line text-slate-600">{shippingAddress ?? "—"}</p>
          </div>
        </div>

        {invoice.irn && (
          <p className="mt-3 break-all text-xs text-slate-500">
            IRN: {invoice.irn} {invoice.ack_no && `| Ack No.: ${invoice.ack_no}`}{" "}
            {invoice.ack_date && `| Ack Date: ${formatDate(invoice.ack_date)}`}
          </p>
        )}

        <table className="mt-6 w-full text-left">
          <thead>
            <tr className="border-y border-slate-300 text-slate-600">
              <th className="py-2 pr-2 font-semibold">Sr.</th>
              <th className="py-2 pr-2 font-semibold">Item Description</th>
              <th className="py-2 pr-2 font-semibold">HSN/SAC</th>
              <th className="py-2 pr-2 text-right font-semibold">Qty</th>
              <th className="py-2 pr-2 font-semibold">Unit</th>
              <th className="py-2 pr-2 text-right font-semibold">List Price</th>
              <th className="py-2 pr-2 text-right font-semibold">Disc.</th>
              <th className="py-2 pr-2 text-right font-semibold">Tax %</th>
              <th className="py-2 pl-2 text-right font-semibold">Amount (₹)</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, i) => (
              <tr key={it.id} className="border-b border-slate-100">
                <td className="py-2 pr-2 text-slate-500">{i + 1}</td>
                <td className="py-2 pr-2 text-slate-800">{it.description}</td>
                <td className="py-2 pr-2 text-slate-600">{it.hsn_sac ?? "—"}</td>
                <td className="py-2 pr-2 text-right text-slate-700">{Number(it.qty).toFixed(2)}</td>
                <td className="py-2 pr-2 text-slate-600">{it.unit ?? "Nos"}</td>
                <td className="py-2 pr-2 text-right text-slate-700">{money(Number(it.rate))}</td>
                <td className="py-2 pr-2 text-right text-slate-700">{Number(it.discount) ? money(Number(it.discount)) : "—"}</td>
                <td className="py-2 pr-2 text-right text-slate-700">{Number(it.tax_rate).toFixed(2)}</td>
                <td className="py-2 pl-2 text-right text-slate-700">{money(Number(it.amount))}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-3 flex justify-end">
          <div className="w-64 space-y-1">
            {invoice.discount_total > 0 && (
              <div className="flex justify-between text-slate-600">
                <span>Discount</span>
                <span>- {money(Number(invoice.discount_total))}</span>
              </div>
            )}
            <div className="flex justify-between border-t border-slate-300 pt-1 text-base font-semibold text-slate-900">
              <span>Total</span>
              <span>{money(Number(invoice.total))}</span>
            </div>
          </div>
        </div>

        <p className="mt-3 border-t border-slate-200 pt-3 text-slate-700">{rupeesInWords(Number(invoice.total))}</p>

        <p className="mt-1 text-slate-700">
          Invoice Balance: <span className="font-semibold">{money(balance)}</span>
          {paid > 0 && <span className="text-slate-500"> · Settled: {money(paid)}</span>}
        </p>

        <p className="mt-1 text-xs text-slate-500">
          Taxable Amt = {money(Number(invoice.subtotal))} | CGST = {money(cgst)} | SGST = {money(sgst)} | Total Tax ={" "}
          {money(Number(invoice.tax_amount))} | Cess = 0.00
        </p>

        <div className="mt-6 grid grid-cols-1 gap-6 border-t border-slate-200 pt-4 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Terms and Conditions</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-slate-600">
              {(terms.length ? terms : ["E & OE"]).map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ul>
          </div>
          <div className="flex flex-col items-center justify-start gap-1">
            {qrDataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qrDataUrl} alt="e-Invoice QR" className="h-24 w-24" />
            ) : (
              <div className="flex h-24 w-24 items-center justify-center rounded border border-dashed border-slate-300 text-[10px] text-slate-400">
                E-Invoice QR
              </div>
            )}
          </div>
        </div>

        <div className="mt-4 flex flex-col justify-between gap-6 sm:flex-row">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Bank Details</p>
            <p className="mt-1 text-slate-600">Account Number: {company?.bank_account_no ?? "—"}</p>
            <p className="text-slate-600">Bank: {company?.bank_name ?? "—"}</p>
            <p className="text-slate-600">IFSC: {company?.bank_ifsc ?? "—"}</p>
            <p className="text-slate-600">Branch: {company?.bank_branch ?? "—"}</p>
          </div>
          <div className="flex flex-col items-end justify-end text-right">
            <p className="mb-8 font-medium text-slate-700">For {company?.name ?? "Add Name"}</p>
            <p className="border-t border-slate-400 pt-1 text-slate-600">Signature</p>
          </div>
        </div>
      </div>
    </div>
  );
}
