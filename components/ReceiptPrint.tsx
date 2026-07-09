"use client";

import { useEffect, useState } from "react";
import { supabase, isConfigured } from "@/lib/supabase";
import { NotConfigured } from "@/components/NotConfigured";
import { rupeesInWords } from "@/lib/numberToWords";
import type { Company, Customer, Invoice, Receipt, ReceiptAllocation } from "@/lib/types";

function formatDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function money(n: number) {
  return n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const MODE_LABEL: Record<string, string> = { cash: "Cash", cheque: "Cheque", upi: "UPI", neft: "NEFT / Bank Transfer" };

/*
  A clean, printable payment receipt for one saved receipt — same idea as
  InvoicePrint.tsx (no app chrome, browser Print → Save as PDF makes it a
  real document), but for money received rather than money billed.
*/
export function ReceiptPrint({ receiptId }: { receiptId: string }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [company, setCompany] = useState<Company | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [allocations, setAllocations] = useState<(ReceiptAllocation & { invoice: Invoice | null })[]>([]);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    let cancelled = false;

    async function load() {
      const [companyRes, receiptRes, allocRes] = await Promise.all([
        supabase!.from("company").select("*").limit(1).maybeSingle(),
        supabase!.from("receipts").select("*").eq("id", receiptId).single(),
        supabase!.from("receipt_allocations").select("*").eq("receipt_id", receiptId),
      ]);
      if (cancelled) return;

      if (receiptRes.error || !receiptRes.data) {
        setError("Couldn't find that receipt.");
        setLoading(false);
        return;
      }

      const rcpt = receiptRes.data as Receipt;
      setCompany((companyRes.data as Company | null) ?? null);
      setReceipt(rcpt);

      const { data: custData } = await supabase!.from("customers").select("*").eq("id", rcpt.customer_id).single();
      if (cancelled) return;
      setCustomer((custData as Customer | null) ?? null);

      const allocs = (allocRes.data as ReceiptAllocation[]) ?? [];
      const invoiceIds = allocs.map((a) => a.invoice_id);
      let invoicesById = new Map<string, Invoice>();
      if (invoiceIds.length > 0) {
        const { data: invData } = await supabase!.from("invoices").select("*").in("id", invoiceIds);
        invoicesById = new Map(((invData as Invoice[]) ?? []).map((i) => [i.id, i]));
      }
      if (!cancelled) {
        setAllocations(allocs.map((a) => ({ ...a, invoice: invoicesById.get(a.invoice_id) ?? null })));
      }

      setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [receiptId]);

  if (!isConfigured) return <NotConfigured />;
  if (loading) return <p className="text-sm text-slate-500">Loading…</p>;
  if (error || !receipt) return <p className="text-sm text-red-600">{error ?? "Receipt not found."}</p>;

  const totalAllocated = allocations.reduce((s, a) => s + Number(a.amount), 0);
  const unapplied = Number(receipt.amount) - totalAllocated;

  return (
    <div className="mx-auto max-w-2xl print:max-w-none">
      <style>{`
        @media print {
          @page { size: A4 portrait; margin: 14mm; }
        }
      `}</style>
      <div className="mb-6 flex justify-end print:hidden">
        <button
          onClick={() => window.print()}
          className="rounded-lg bg-brand px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark"
        >
          Print / Save as PDF
        </button>
      </div>

      <div className="rounded-xl border border-slate-200 bg-cream p-8 text-sm print:rounded-none print:border-0 print:p-0">
        <div className="flex items-start justify-between gap-6 border-b border-slate-200 pb-4">
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
              <h2 className="text-base font-bold text-slate-900">{company?.name ?? "Verve Advisory Pvt Ltd"}</h2>
              <p className="mt-0.5 whitespace-pre-line text-slate-500">{company?.address ?? ""}</p>
              <p className="mt-0.5 text-slate-500">{company?.gstin ? `GSTIN: ${company.gstin}` : ""}</p>
            </div>
          </div>
          <div className="flex-none text-right">
            <h1 className="text-lg font-bold uppercase tracking-wide text-slate-900">Payment Receipt</h1>
            <p className="mt-2">
              Receipt No: <span className="font-semibold text-slate-900">{receipt.receipt_no}</span>
            </p>
            <p>
              Date: <span className="font-semibold text-slate-900">{formatDate(receipt.receipt_date)}</span>
            </p>
          </div>
        </div>

        <div className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Received From</p>
          <p className="mt-1 font-semibold text-slate-900">{customer?.name ?? "—"}</p>
          <p className="text-slate-600">{customer?.address ?? ""}</p>
          <p className="text-slate-600">{customer?.gstin ? `GSTIN: ${customer.gstin}` : ""}</p>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-4 rounded-lg border border-slate-200 p-3 sm:grid-cols-3">
          <p>
            Amount Received
            <br />
            <span className="text-base font-bold text-slate-900">₹{money(Number(receipt.amount))}</span>
          </p>
          <p>
            Mode
            <br />
            <span className="font-semibold text-slate-900">{MODE_LABEL[receipt.mode] ?? receipt.mode}</span>
          </p>
          <p>
            Reference / UTR
            <br />
            <span className="font-semibold text-slate-900">{receipt.reference ?? "—"}</span>
          </p>
        </div>

        <p className="mt-3 text-slate-700">Amount in words: {rupeesInWords(Number(receipt.amount))}</p>

        <div className="mt-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Applied Against</p>
          {allocations.length === 0 ? (
            <p className="mt-2 text-slate-500">Not yet allocated to any invoice — held on account.</p>
          ) : (
            <table className="mt-2 w-full text-left">
              <thead>
                <tr className="border-y border-slate-300 text-slate-600">
                  <th className="py-2 pr-2 font-semibold">Invoice #</th>
                  <th className="py-2 pr-2 font-semibold">Invoice Date</th>
                  <th className="py-2 pl-2 text-right font-semibold">Amount Applied (₹)</th>
                </tr>
              </thead>
              <tbody>
                {allocations.map((a) => (
                  <tr key={a.id} className="border-b border-slate-100">
                    <td className="py-2 pr-2 text-slate-800">{a.invoice?.invoice_no ?? "—"}</td>
                    <td className="py-2 pr-2 text-slate-600">{formatDate(a.invoice?.invoice_date ?? null)}</td>
                    <td className="py-2 pl-2 text-right text-slate-700">{money(Number(a.amount))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {unapplied > 0.005 && (
            <p className="mt-2 text-slate-500">Unapplied balance held on account: ₹{money(unapplied)}</p>
          )}
        </div>

        <div className="mt-8 flex justify-end">
          <div className="text-right">
            <p className="mb-8 font-medium text-slate-700">For {company?.name ?? "Verve Advisory Pvt Ltd"}</p>
            <p className="border-t border-slate-400 pt-1 text-slate-600">Authorized Signatory</p>
          </div>
        </div>
      </div>
    </div>
  );
}
