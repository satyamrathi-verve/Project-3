"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { supabase, isConfigured } from "@/lib/supabase";
import type { Customer, Invoice, InvoiceStatus, Receipt, ReceiptMode } from "@/lib/types";
import { money, moneyCompact, todayStr } from "@/lib/format";
import { PageHeader } from "@/components/PageHeader";
import { NotConfigured } from "@/components/NotConfigured";
import { DataTable, type Column } from "@/components/DataTable";
import { FormField, inputClass } from "@/components/FormField";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import { TableSkeleton } from "@/components/Skeleton";
import { useToast } from "@/components/Toast";
import { StatTile } from "@/components/StatTile";
import { Avatar } from "@/components/Avatar";
import { ExportCsvButton, type CsvColumn } from "@/components/ExportCsvButton";
import { DocumentIcon, BanknoteIcon, CalendarIcon, CardIcon, SearchIcon, PlusIcon } from "@/components/icons";
import { CustomerSelector } from "@/components/receipts/CustomerSelector";
import { InvoiceAllocationGrid, type InvoiceRow } from "@/components/receipts/InvoiceAllocationGrid";
import { AccountingPreview } from "@/components/receipts/AccountingPreview";
import { ReceiptSummaryPanel } from "@/components/receipts/ReceiptSummaryPanel";
import { ModeBadge } from "@/components/receipts/ModeBadge";

type ReceiptRow = Receipt & {
  customer_name: string;
  customer_code: string;
  allocated: number;
};

const MODES: { value: ReceiptMode; label: string }[] = [
  { value: "cash", label: "Cash" },
  { value: "cheque", label: "Cheque" },
  { value: "upi", label: "UPI" },
  { value: "neft", label: "NEFT / Bank Transfer" },
];

const DRAFT_KEY = "ar-receipt-draft";

type DraftPayload = {
  savedAt: string;
  receiptNo: string;
  receiptDate: string;
  mode: ReceiptMode;
  reference: string;
  amount: string;
  customerId: string | null;
  allocations: Record<string, string>;
};

function computeInvoiceStatus(total: number, allocated: number, dueDate: string): InvoiceStatus {
  const outstanding = total - allocated;
  if (outstanding <= 0.005) return "paid";
  if (dueDate < todayStr()) return "overdue";
  if (allocated > 0.005) return "partial";
  return "open";
}

function nextReceiptNo(existing: Receipt[]) {
  let max = 0;
  for (const r of existing) {
    const m = /^RCP-(\d+)$/.exec(r.receipt_no);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `RCP-${String(max + 1).padStart(4, "0")}`;
}

type FieldErrors = { receiptNo?: string; customer?: string; date?: string; amount?: string };

export default function ReceiptEntryPage() {
  const toast = useToast();

  const [receipts, setReceipts] = useState<ReceiptRow[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // list filters
  const [search, setSearch] = useState("");
  const [modeFilter, setModeFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sortOption, setSortOption] = useState<"newest" | "oldest" | "amount_desc" | "amount_asc">("newest");
  const [moreFiltersOpen, setMoreFiltersOpen] = useState(false);

  // form state
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [receiptNo, setReceiptNo] = useState("");
  const [receiptDate, setReceiptDate] = useState(todayStr());
  const [mode, setMode] = useState<ReceiptMode>("neft");
  const [reference, setReference] = useState("");
  const [amount, setAmount] = useState("");

  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [invoiceRows, setInvoiceRows] = useState<InvoiceRow[]>([]);
  const [allocations, setAllocations] = useState<Record<string, string>>({});
  const [invoicesLoading, setInvoicesLoading] = useState(false);

  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const [dirty, setDirty] = useState(false);
  const [pendingDraft, setPendingDraft] = useState<DraftPayload | null>(null);

  const customerInputRef = useRef<HTMLInputElement>(null);

  async function loadReceipts() {
    if (!supabase) return;
    setLoading(true);
    setError(null);

    const [{ data: receiptsData, error: rErr }, { data: allocData, error: aErr }] = await Promise.all([
      supabase.from("receipts").select("*, customers(code, name)").order("receipt_date", { ascending: false }),
      supabase.from("receipt_allocations").select("receipt_id, amount"),
    ]);

    if (rErr) {
      setError(rErr.message);
      setLoading(false);
      return;
    }
    if (aErr) {
      setError(aErr.message);
      setLoading(false);
      return;
    }

    const allocatedByReceipt = new Map<string, number>();
    for (const a of allocData ?? []) {
      allocatedByReceipt.set(a.receipt_id, (allocatedByReceipt.get(a.receipt_id) ?? 0) + Number(a.amount));
    }

    const rows: ReceiptRow[] = (receiptsData ?? []).map((r: any) => ({
      ...r,
      customer_name: r.customers?.name ?? "Unknown",
      customer_code: r.customers?.code ?? "—",
      allocated: allocatedByReceipt.get(r.id) ?? 0,
    }));

    setReceipts(rows);
    setLoading(false);
  }

  async function loadCustomers() {
    if (!supabase) return;
    const { data } = await supabase.from("customers").select("*").order("name");
    setCustomers(data ?? []);
  }

  useEffect(() => {
    loadReceipts();
    loadCustomers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadInvoicesForCustomer(customerId: string, excludeReceiptId: string | null, keepAllocations: Record<string, string>) {
    if (!supabase) return;
    setInvoicesLoading(true);

    const { data: invs } = await supabase.from("invoices").select("*").eq("customer_id", customerId).order("due_date");
    const invoiceList: Invoice[] = invs ?? [];
    const invIds = invoiceList.map((i) => i.id);

    let allocs: { invoice_id: string; receipt_id: string; amount: number }[] = [];
    if (invIds.length > 0) {
      const { data } = await supabase.from("receipt_allocations").select("invoice_id, receipt_id, amount").in("invoice_id", invIds);
      allocs = data ?? [];
    }

    const otherAllocatedByInvoice = new Map<string, number>();
    for (const a of allocs) {
      if (excludeReceiptId && a.receipt_id === excludeReceiptId) continue;
      otherAllocatedByInvoice.set(a.invoice_id, (otherAllocatedByInvoice.get(a.invoice_id) ?? 0) + Number(a.amount));
    }

    const rows: InvoiceRow[] = invoiceList
      .map((invoice) => ({
        invoice,
        outstandingExcl: Number(invoice.total) - (otherAllocatedByInvoice.get(invoice.id) ?? 0),
      }))
      .filter((row) => row.outstandingExcl > 0.005 || Number(keepAllocations[row.invoice.id] || 0) > 0);

    setInvoiceRows(rows);
    setInvoicesLoading(false);
  }

  function readDraft(): DraftPayload | null {
    try {
      const raw = window.localStorage.getItem(DRAFT_KEY);
      return raw ? (JSON.parse(raw) as DraftPayload) : null;
    } catch {
      return null;
    }
  }

  function clearDraft() {
    window.localStorage.removeItem(DRAFT_KEY);
    setPendingDraft(null);
  }

  function resetForm() {
    setEditingId(null);
    setReceiptNo(nextReceiptNo(receipts));
    setReceiptDate(todayStr());
    setMode("neft");
    setReference("");
    setAmount("");
    setSelectedCustomer(null);
    setInvoiceRows([]);
    setAllocations({});
    setFormError(null);
    setFieldErrors({});
    setDirty(false);
  }

  function openAddForm() {
    resetForm();
    const draft = readDraft();
    setPendingDraft(draft && !editingId ? draft : null);
    setFormOpen(true);
  }

  async function restoreDraft() {
    if (!pendingDraft) return;
    setReceiptNo(pendingDraft.receiptNo);
    setReceiptDate(pendingDraft.receiptDate);
    setMode(pendingDraft.mode);
    setReference(pendingDraft.reference);
    setAmount(pendingDraft.amount);
    setAllocations(pendingDraft.allocations);
    if (pendingDraft.customerId) {
      const c = customers.find((x) => x.id === pendingDraft.customerId) ?? null;
      setSelectedCustomer(c);
      if (c) await loadInvoicesForCustomer(c.id, null, pendingDraft.allocations);
    }
    setPendingDraft(null);
    setDirty(true);
  }

  async function openEditForm(row: ReceiptRow) {
    setEditingId(row.id);
    setReceiptNo(row.receipt_no);
    setReceiptDate(row.receipt_date);
    setMode(row.mode);
    setReference(row.reference ?? "");
    setAmount(String(row.amount));
    setFormError(null);
    setFieldErrors({});
    setDirty(false);
    setPendingDraft(null);

    const customer = customers.find((c) => c.id === row.customer_id) ?? null;
    setSelectedCustomer(customer);

    const { data: existingAllocs } = supabase
      ? await supabase.from("receipt_allocations").select("invoice_id, amount").eq("receipt_id", row.id)
      : { data: [] };
    const allocMap: Record<string, string> = {};
    for (const a of existingAllocs ?? []) allocMap[a.invoice_id] = String(a.amount);
    setAllocations(allocMap);

    if (customer) await loadInvoicesForCustomer(customer.id, row.id, allocMap);
    setFormOpen(true);
  }

  function attemptClose() {
    if (dirty && !window.confirm("Discard unsaved changes to this receipt?")) return;
    if (!editingId) clearDraft();
    setFormOpen(false);
    setFormError(null);
  }

  async function handleSelectCustomer(customer: Customer) {
    setSelectedCustomer(customer);
    setAllocations({});
    setDirty(true);
    setFieldErrors((f) => ({ ...f, customer: undefined }));
    await loadInvoicesForCustomer(customer.id, editingId, {});
  }

  const totalAllocated = useMemo(
    () => Object.values(allocations).reduce((sum, v) => sum + (Number(v) || 0), 0),
    [allocations]
  );
  const invoicesSelectedCount = useMemo(
    () => Object.values(allocations).filter((v) => (Number(v) || 0) > 0.005).length,
    [allocations]
  );
  const customerOutstandingTotal = useMemo(
    () => invoiceRows.reduce((sum, r) => sum + r.outstandingExcl, 0),
    [invoiceRows]
  );
  const amountNum = Number(amount) || 0;
  const unapplied = amountNum - totalAllocated;
  const overAllocated = totalAllocated > amountNum + 0.005;

  function updateAllocation(invoiceId: string, value: string) {
    setAllocations((a) => ({ ...a, [invoiceId]: value }));
    setDirty(true);
  }
  function allocateFull(invoiceId: string) {
    const row = invoiceRows.find((r) => r.invoice.id === invoiceId);
    if (row) updateAllocation(invoiceId, row.outstandingExcl.toFixed(2));
  }
  function clearAllocation(invoiceId: string) {
    updateAllocation(invoiceId, "");
  }
  function autoFillOldestFirst() {
    let remaining = amountNum;
    const next: Record<string, string> = {};
    for (const row of invoiceRows) {
      if (remaining <= 0.005) break;
      const take = Math.min(remaining, row.outstandingExcl);
      if (take > 0.005) {
        next[row.invoice.id] = take.toFixed(2);
        remaining -= take;
      }
    }
    setAllocations(next);
    setDirty(true);
  }

  async function recomputeInvoiceStatus(invoiceId: string) {
    if (!supabase) return;
    const { data: invoice } = await supabase.from("invoices").select("*").eq("id", invoiceId).single();
    if (!invoice) return;
    const { data: allocs } = await supabase.from("receipt_allocations").select("amount").eq("invoice_id", invoiceId);
    const allocatedSum = (allocs ?? []).reduce((sum, a) => sum + Number(a.amount), 0);
    const status = computeInvoiceStatus(Number(invoice.total), allocatedSum, invoice.due_date);
    if (status !== invoice.status) {
      await supabase.from("invoices").update({ status }).eq("id", invoiceId);
    }
  }

  function validate(): FieldErrors | null {
    const errs: FieldErrors = {};
    const trimmedNo = receiptNo.trim();

    if (!trimmedNo) errs.receiptNo = "Receipt number is required.";
    else if (receipts.some((r) => r.receipt_no.toLowerCase() === trimmedNo.toLowerCase() && r.id !== editingId)) {
      errs.receiptNo = `Receipt number ${trimmedNo} already exists.`;
    }
    if (!selectedCustomer) errs.customer = "Select a customer.";
    if (!receiptDate) errs.date = "Receipt date is required.";
    else if (receiptDate > todayStr()) errs.date = "Receipt date cannot be in the future.";
    if (amountNum <= 0) errs.amount = "Amount received must be greater than zero.";

    return Object.keys(errs).length > 0 ? errs : null;
  }

  async function handleSubmit(e: React.FormEvent, andNew = false) {
    e.preventDefault();
    if (!supabase || saving) return;
    setFormError(null);

    const errs = validate();
    if (errs) {
      setFieldErrors(errs);
      return;
    }
    setFieldErrors({});

    if (overAllocated) return setFormError("Total allocation cannot exceed the amount received.");
    for (const row of invoiceRows) {
      const alloc = Number(allocations[row.invoice.id]) || 0;
      if (alloc > row.outstandingExcl + 0.005) {
        return setFormError(`Allocation for ${row.invoice.invoice_no} exceeds its outstanding balance.`);
      }
    }

    setSaving(true);

    const payload = {
      receipt_no: receiptNo.trim(),
      receipt_date: receiptDate,
      customer_id: (selectedCustomer as Customer).id,
      amount: amountNum,
      mode,
      reference: reference.trim() || null,
    };

    const affectedInvoiceIds = new Set<string>();
    let receiptId = editingId;

    if (editingId) {
      const { data: oldAllocs } = await supabase.from("receipt_allocations").select("invoice_id").eq("receipt_id", editingId);
      for (const a of oldAllocs ?? []) affectedInvoiceIds.add(a.invoice_id);

      const { error: updateErr } = await supabase.from("receipts").update(payload).eq("id", editingId);
      if (updateErr) {
        setFormError(updateErr.message.includes("duplicate") ? `Receipt number ${payload.receipt_no} already exists.` : updateErr.message);
        setSaving(false);
        toast.show("error", "Could not save the receipt.");
        return;
      }
      await supabase.from("receipt_allocations").delete().eq("receipt_id", editingId);
    } else {
      const { data: inserted, error: insertErr } = await supabase.from("receipts").insert(payload).select().single();
      if (insertErr) {
        setFormError(insertErr.message.includes("duplicate") ? `Receipt number ${payload.receipt_no} already exists.` : insertErr.message);
        setSaving(false);
        toast.show("error", "Could not save the receipt.");
        return;
      }
      receiptId = inserted.id;
    }

    const newAllocRows = invoiceRows
      .map((row) => ({ invoice_id: row.invoice.id, amount: Number(allocations[row.invoice.id]) || 0 }))
      .filter((a) => a.amount > 0.005)
      .map((a) => ({ receipt_id: receiptId as string, invoice_id: a.invoice_id, amount: a.amount }));

    for (const a of newAllocRows) affectedInvoiceIds.add(a.invoice_id);

    if (newAllocRows.length > 0) {
      const { error: allocErr } = await supabase.from("receipt_allocations").insert(newAllocRows);
      if (allocErr) {
        setFormError(allocErr.message);
        setSaving(false);
        toast.show("error", "Could not save invoice allocations.");
        return;
      }
    }

    await Promise.all([...affectedInvoiceIds].map((id) => recomputeInvoiceStatus(id)));

    clearDraft();
    setSaving(false);
    toast.show("success", editingId ? `Receipt ${payload.receipt_no} updated.` : `Receipt ${payload.receipt_no} saved.`);
    await loadReceipts();

    if (andNew) {
      resetForm();
    } else {
      setFormOpen(false);
    }
  }

  async function handleDelete(row: ReceiptRow) {
    if (!supabase) return;
    if (!window.confirm(`Delete receipt ${row.receipt_no}? This also removes its invoice allocations.`)) return;

    const { data: allocs } = await supabase.from("receipt_allocations").select("invoice_id").eq("receipt_id", row.id);
    const affectedIds = (allocs ?? []).map((a) => a.invoice_id);

    const { error: delErr } = await supabase.from("receipts").delete().eq("id", row.id);
    if (delErr) {
      toast.show("error", "Could not delete the receipt.");
      return;
    }

    await Promise.all(affectedIds.map((id) => recomputeInvoiceStatus(id)));
    toast.show("success", `Receipt ${row.receipt_no} deleted.`);
    await loadReceipts();
  }

  // Autosave a lightweight draft (new receipts only) so an accidental tab close isn't total loss.
  useEffect(() => {
    if (!formOpen || editingId) return;
    const t = setTimeout(() => {
      const draft: DraftPayload = {
        savedAt: new Date().toISOString(),
        receiptNo,
        receiptDate,
        mode,
        reference,
        amount,
        customerId: selectedCustomer?.id ?? null,
        allocations,
      };
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    }, 800);
    return () => clearTimeout(t);
  }, [formOpen, editingId, receiptNo, receiptDate, mode, reference, amount, selectedCustomer, allocations]);

  // Warn before closing the tab with unsaved changes.
  useEffect(() => {
    function handler(e: BeforeUnloadEvent) {
      if (formOpen && dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    }
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [formOpen, dirty]);

  // Keyboard shortcuts: Ctrl/Cmd+S to save, Esc to cancel, "/" to jump to customer search.
  useEffect(() => {
    if (!formOpen) return;
    function handler(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        (document.getElementById("receipt-form-submit") as HTMLButtonElement | null)?.click();
      } else if (e.key === "Escape" && !typing) {
        attemptClose();
      } else if (e.key === "/" && !typing) {
        e.preventDefault();
        customerInputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formOpen, dirty]);

  const filteredReceipts = useMemo(() => {
    const list = receipts.filter((r) => {
      if (modeFilter && r.mode !== modeFilter) return false;
      if (dateFrom && r.receipt_date < dateFrom) return false;
      if (dateTo && r.receipt_date > dateTo) return false;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const hay = `${r.receipt_no} ${r.customer_name} ${r.reference ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    const sorted = [...list];
    switch (sortOption) {
      case "newest":
        sorted.sort((a, b) => b.receipt_date.localeCompare(a.receipt_date));
        break;
      case "oldest":
        sorted.sort((a, b) => a.receipt_date.localeCompare(b.receipt_date));
        break;
      case "amount_desc":
        sorted.sort((a, b) => Number(b.amount) - Number(a.amount));
        break;
      case "amount_asc":
        sorted.sort((a, b) => Number(a.amount) - Number(b.amount));
        break;
    }
    return sorted;
  }, [receipts, search, modeFilter, dateFrom, dateTo, sortOption]);

  const receiptStats = useMemo(() => {
    const thisMonthPrefix = todayStr().slice(0, 7);
    const totalReceived = receipts.reduce((sum, r) => sum + Number(r.amount), 0);
    const thisMonth = receipts.filter((r) => r.receipt_date.startsWith(thisMonthPrefix));
    const unallocated = receipts.reduce((sum, r) => sum + Math.max(Number(r.amount) - r.allocated, 0), 0);
    return {
      count: receipts.length,
      totalReceived,
      thisMonthCount: thisMonth.length,
      thisMonthAmount: thisMonth.reduce((sum, r) => sum + Number(r.amount), 0),
      unallocated,
    };
  }, [receipts]);

  const csvColumns: CsvColumn<ReceiptRow>[] = [
    { header: "Receipt No", value: (r) => r.receipt_no },
    { header: "Date", value: (r) => r.receipt_date },
    { header: "Customer Code", value: (r) => r.customer_code },
    { header: "Customer Name", value: (r) => r.customer_name },
    { header: "Mode", value: (r) => r.mode },
    { header: "Amount", value: (r) => Number(r.amount).toFixed(2) },
    { header: "Allocated", value: (r) => r.allocated.toFixed(2) },
    { header: "Unallocated", value: (r) => (Number(r.amount) - r.allocated).toFixed(2) },
    { header: "Reference", value: (r) => r.reference ?? "" },
  ];

  const columns: Column<ReceiptRow>[] = [
    {
      key: "receipt_no",
      header: "Receipt",
      render: (r) => (
        <div>
          <p className="font-semibold text-slate-800 dark:text-slate-100">{r.receipt_no}</p>
          {r.reference && <p className="text-xs text-slate-400">{r.reference}</p>}
        </div>
      ),
    },
    {
      key: "customer_name",
      header: "Customer",
      render: (r) => (
        <div className="flex items-center gap-3">
          <Avatar name={r.customer_name} />
          <div>
            <p className="font-medium text-slate-800 dark:text-slate-100">{r.customer_name}</p>
            <p className="text-xs text-slate-400">{r.customer_code}</p>
          </div>
        </div>
      ),
    },
    { key: "receipt_date", header: "Date" },
    { key: "mode", header: "Mode", render: (r) => <ModeBadge mode={r.mode} /> },
    { key: "amount", header: "Amount", render: (r) => <span className="font-semibold text-slate-800 dark:text-slate-100">{money(Number(r.amount))}</span> },
    {
      key: "allocation",
      header: "Allocation",
      render: (r) => {
        const u = Number(r.amount) - r.allocated;
        if (u <= 0.005) return <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">Fully allocated</span>;
        if (r.allocated > 0.005)
          return (
            <div>
              <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">Partially allocated</span>
              <p className="mt-1 text-xs text-slate-400">{money(u)} left</p>
            </div>
          );
        return <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-500">Unallocated</span>;
      },
    },
    {
      key: "actions",
      header: "",
      className: "text-right",
      render: (r) => (
        <div className="flex justify-end gap-3">
          <button type="button" onClick={() => openEditForm(r)} className="text-sm font-medium text-brand hover:underline">
            Edit
          </button>
          <button type="button" onClick={() => handleDelete(r)} className="text-sm font-medium text-red-600 hover:underline">
            Delete
          </button>
        </div>
      ),
    },
  ];

  return (
    <>
      <nav className="mb-2 text-xs text-slate-400 dark:text-slate-500">
        <Link href="/" className="hover:text-slate-600 dark:hover:text-slate-300">Home</Link>
        <span className="mx-1.5">/</span>
        <span>Accounts Receivable</span>
        <span className="mx-1.5">/</span>
        {formOpen ? (
          <>
            <Link href="/receipts" onClick={(e) => { e.preventDefault(); attemptClose(); }} className="hover:text-slate-600 dark:hover:text-slate-300">
              Receipts
            </Link>
            <span className="mx-1.5">/</span>
            <span className="text-slate-600 dark:text-slate-300">{editingId ? "Edit Receipt" : "New Receipt"}</span>
          </>
        ) : (
          <span className="text-slate-600 dark:text-slate-300">Receipts</span>
        )}
      </nav>

      <PageHeader
        title="Receipt Entry"
        subtitle="Record money received from customers and knock it off open invoices."
        action={
          isConfigured &&
          !formOpen && (
            <button
              type="button"
              onClick={openAddForm}
              className="flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-dark"
            >
              <PlusIcon />
              New Receipt
            </button>
          )
        }
      />

      {!isConfigured && <NotConfigured />}

      {isConfigured && formOpen && (
        <form onSubmit={handleSubmit} className="pb-24 lg:pb-0">
          <div className="mb-4 flex items-center justify-between rounded-xl border border-slate-200 bg-cream/95 px-5 py-3 backdrop-blur">
            <div>
              <h3 className="text-sm font-semibold text-slate-800">{editingId ? `Edit Receipt — ${receiptNo}` : "New Receipt"}</h3>
              <p className="text-xs text-slate-400">Ctrl+S to save · Esc to cancel · / to search customer</p>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={attemptClose} className="rounded-lg px-3 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100">
                Cancel
              </button>
              {!editingId && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={(e) => handleSubmit(e as unknown as React.FormEvent, true)}
                  className="rounded-lg border border-brand px-3 py-2 text-sm font-semibold text-brand hover:bg-brand/5 disabled:opacity-40"
                >
                  Save &amp; New
                </button>
              )}
              <button
                id="receipt-form-submit"
                type="submit"
                disabled={saving}
                className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-40"
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>

          {pendingDraft && (
            <div className="mb-4 flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              <span>You have an unsaved draft from {new Date(pendingDraft.savedAt).toLocaleString()}.</span>
              <div className="flex gap-3">
                <button type="button" onClick={restoreDraft} className="font-semibold hover:underline">Restore</button>
                <button type="button" onClick={clearDraft} className="text-amber-600 hover:underline">Discard</button>
              </div>
            </div>
          )}

          <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
            <div className="min-w-0 flex-1">
              <CollapsibleSection title="Receipt Information" subtitle="Who paid, how, and when.">
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <FormField label="Receipt Number">
                    <input
                      className={`${inputClass} ${fieldErrors.receiptNo ? "border-red-400" : ""}`}
                      value={receiptNo}
                      onChange={(e) => { setReceiptNo(e.target.value); setDirty(true); setFieldErrors((f) => ({ ...f, receiptNo: undefined })); }}
                    />
                    {fieldErrors.receiptNo && <p className="mt-1 text-xs font-medium text-red-600">{fieldErrors.receiptNo}</p>}
                  </FormField>
                  <FormField label="Receipt Date">
                    <input
                      type="date"
                      className={`${inputClass} ${fieldErrors.date ? "border-red-400" : ""}`}
                      value={receiptDate}
                      max={todayStr()}
                      onChange={(e) => { setReceiptDate(e.target.value); setDirty(true); setFieldErrors((f) => ({ ...f, date: undefined })); }}
                    />
                    {fieldErrors.date && <p className="mt-1 text-xs font-medium text-red-600">{fieldErrors.date}</p>}
                  </FormField>
                  <FormField label="Receipt Type">
                    <select className={inputClass} value={mode} onChange={(e) => { setMode(e.target.value as ReceiptMode); setDirty(true); }}>
                      {MODES.map((m) => (
                        <option key={m.value} value={m.value}>{m.label}</option>
                      ))}
                    </select>
                  </FormField>

                  <CustomerSelector
                    ref={customerInputRef}
                    customers={customers}
                    value={selectedCustomer}
                    onChange={handleSelectCustomer}
                    disabled={!!editingId}
                    error={fieldErrors.customer}
                  />

                  <FormField label="Customer Code">
                    <input className={`${inputClass} bg-cream-dim`} value={selectedCustomer?.code ?? ""} readOnly />
                  </FormField>
                  <FormField label="Amount Received">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      className={`${inputClass} ${fieldErrors.amount ? "border-red-400" : ""}`}
                      value={amount}
                      onChange={(e) => { setAmount(e.target.value); setDirty(true); setFieldErrors((f) => ({ ...f, amount: undefined })); }}
                    />
                    {fieldErrors.amount && <p className="mt-1 text-xs font-medium text-red-600">{fieldErrors.amount}</p>}
                  </FormField>
                  <FormField label="Payment Reference / UTR">
                    <input className={inputClass} value={reference} onChange={(e) => { setReference(e.target.value); setDirty(true); }} />
                  </FormField>
                </div>
              </CollapsibleSection>

              {selectedCustomer && (
                <CollapsibleSection title="Invoice Allocation" subtitle={`Open invoices for ${selectedCustomer.name}.`}>
                  <InvoiceAllocationGrid
                    rows={invoiceRows}
                    allocations={allocations}
                    onChangeAllocation={updateAllocation}
                    onAllocateFull={allocateFull}
                    onClear={clearAllocation}
                    onAutoAllocate={autoFillOldestFirst}
                    loading={invoicesLoading}
                  />
                  <div className="mt-3 flex flex-wrap gap-6 text-sm">
                    <span className="text-slate-500">Receipt amount: <span className="font-medium text-slate-800">{money(amountNum)}</span></span>
                    <span className="text-slate-500">Total allocated: <span className="font-medium text-slate-800">{money(totalAllocated)}</span></span>
                    <span className={overAllocated ? "font-medium text-red-600" : "text-slate-500"}>
                      Unapplied: <span className="font-medium">{money(unapplied)}</span>
                      {overAllocated && " — exceeds receipt amount!"}
                    </span>
                  </div>
                </CollapsibleSection>
              )}

              {selectedCustomer && amountNum > 0 && (
                <CollapsibleSection title="Accounting Preview" defaultOpen={false}>
                  <AccountingPreview mode={mode} amount={amountNum} />
                </CollapsibleSection>
              )}

              {formError && (
                <p role="alert" className="mt-2 text-sm font-medium text-red-600">{formError}</p>
              )}
            </div>

            <ReceiptSummaryPanel
              receiptAmount={amountNum}
              allocated={totalAllocated}
              invoicesSelected={invoicesSelectedCount}
              customerOutstanding={customerOutstandingTotal}
              customerLabel={selectedCustomer?.name ?? null}
            />
          </div>
        </form>
      )}

      {isConfigured && !formOpen && (
        <>
          <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile
              icon={<DocumentIcon />}
              tone="blue"
              label="Total Receipts"
              value={String(receiptStats.count)}
              sub="all time"
            />
            <StatTile
              icon={<BanknoteIcon />}
              tone="emerald"
              label="Total Received"
              value={moneyCompact(receiptStats.totalReceived)}
              sub={money(receiptStats.totalReceived)}
            />
            <StatTile
              icon={<CalendarIcon />}
              tone="purple"
              label="This Month"
              value={String(receiptStats.thisMonthCount)}
              sub={money(receiptStats.thisMonthAmount)}
            />
            <StatTile
              icon={<CardIcon />}
              tone="amber"
              label="Unallocated"
              value={money(receiptStats.unallocated)}
              sub="on-account balance"
            />
          </div>

          <div className="mb-4 flex flex-wrap items-center gap-3">
            <div className="relative min-w-[240px] flex-1">
              <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400">
                <SearchIcon />
              </span>
              <input
                className={`${inputClass} w-full rounded-full pl-9`}
                placeholder="Search receipt, customer, reference…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <select className={`${inputClass} rounded-full`} value={modeFilter} onChange={(e) => setModeFilter(e.target.value)}>
              <option value="">All modes</option>
              {MODES.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
            <select className={`${inputClass} rounded-full`} value={sortOption} onChange={(e) => setSortOption(e.target.value as typeof sortOption)}>
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="amount_desc">Amount: High to Low</option>
              <option value="amount_asc">Amount: Low to High</option>
            </select>
            <button
              type="button"
              onClick={() => setMoreFiltersOpen((v) => !v)}
              className="text-sm font-medium text-slate-500 hover:text-slate-700"
            >
              {moreFiltersOpen ? "Hide date filter" : "More filters"}
            </button>
            <ExportCsvButton rows={filteredReceipts} columns={csvColumns} filename={`receipts-${todayStr()}.csv`} />
          </div>

          {moreFiltersOpen && (
            <div className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-cream p-4">
              <FormField label="From">
                <input type="date" className={inputClass} value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
              </FormField>
              <FormField label="To">
                <input type="date" className={inputClass} value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
              </FormField>
              {(search || modeFilter || dateFrom || dateTo) && (
                <button
                  type="button"
                  onClick={() => { setSearch(""); setModeFilter(""); setDateFrom(""); setDateTo(""); }}
                  className="text-sm font-medium text-slate-500 hover:text-slate-700"
                >
                  Clear filters
                </button>
              )}
            </div>
          )}

          {error && <p role="alert" className="mb-4 text-sm font-medium text-red-600">{error}</p>}

          {loading ? (
            <TableSkeleton rows={5} cols={7} />
          ) : (
            <DataTable columns={columns} rows={filteredReceipts} empty="No receipts yet — record your first one." />
          )}
        </>
      )}
    </>
  );
}
