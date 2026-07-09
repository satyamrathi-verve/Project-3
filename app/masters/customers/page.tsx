"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase, isConfigured } from "@/lib/supabase";
import type { Customer } from "@/lib/types";
import { DataTable, type Column } from "@/components/DataTable";
import { FormField, inputClass } from "@/components/FormField";
import { PageHeader } from "@/components/PageHeader";
import { NotConfigured } from "@/components/NotConfigured";
import { avatarColor } from "@/lib/avatarColor";

/* The shape of the add/edit form. Kept as strings because that's what inputs give us. */
interface FormState {
  code: string;
  name: string;
  contact_person: string;
  email: string;
  phone: string;
  credit_days: string;
  credit_limit: string;
}

const EMPTY_FORM: FormState = {
  code: "",
  name: "",
  contact_person: "",
  email: "",
  phone: "",
  credit_days: "30",
  credit_limit: "0",
};

function formFor(c: Customer): FormState {
  return {
    code: c.code,
    name: c.name,
    contact_person: c.contact_person ?? "",
    email: c.email ?? "",
    phone: c.phone ?? "",
    credit_days: String(c.credit_days),
    credit_limit: String(c.credit_limit),
  };
}

const money = (n: number) => `₹${Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;

type GstStatus = "Registered" | "Unregistered";
const gstStatus = (c: Customer): GstStatus => (c.gstin && c.gstin.trim() ? "Registered" : "Unregistered");
const GST_CHIP_ACTIVE: Record<GstStatus, string> = {
  Registered: "bg-emerald-600 text-white",
  Unregistered: "bg-slate-500 text-white",
};
/* Tinted even when not ticked, so the filter row reads as colour-coded at a
   glance — not just after you click something. */
const GST_CHIP_INACTIVE: Record<GstStatus, string> = {
  Registered: "border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100",
  Unregistered: "border border-slate-200 bg-cream-dim text-slate-600 hover:bg-slate-100",
};

export default function CustomerMasterPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  /* customer id -> opening_balance + outstanding across their invoices (total minus receipt_allocations). */
  const [netReceivable, setNetReceivable] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [gstTicks, setGstTicks] = useState<Set<GstStatus>>(new Set());

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    setLoadError(null);

    /* Net receivable isn't a stored column — it's opening_balance plus what's still
       outstanding on this customer's invoices (total minus what's been allocated
       against it from receipts). Computed here from the three tables it depends on. */
    const [customersRes, invoicesRes, allocationsRes] = await Promise.all([
      supabase.from("customers").select("*").order("code"),
      supabase.from("invoices").select("id,customer_id,total"),
      supabase.from("receipt_allocations").select("invoice_id,amount"),
    ]);

    const error = customersRes.error ?? invoicesRes.error ?? allocationsRes.error;
    if (error) {
      setLoadError(error.message);
      setLoading(false);
      return;
    }

    const allocatedByInvoice = new Map<string, number>();
    for (const a of allocationsRes.data ?? []) {
      allocatedByInvoice.set(a.invoice_id, (allocatedByInvoice.get(a.invoice_id) ?? 0) + Number(a.amount));
    }

    const outstandingByCustomer = new Map<string, number>();
    for (const inv of invoicesRes.data ?? []) {
      const outstanding = Number(inv.total) - (allocatedByInvoice.get(inv.id) ?? 0);
      outstandingByCustomer.set(inv.customer_id, (outstandingByCustomer.get(inv.customer_id) ?? 0) + outstanding);
    }

    const customersData = (customersRes.data ?? []) as Customer[];
    const net: Record<string, number> = {};
    for (const c of customersData) {
      net[c.id] = Number(c.opening_balance) + (outstandingByCustomer.get(c.id) ?? 0);
    }

    setCustomers(customersData);
    setNetReceivable(net);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function toggleGst(s: GstStatus) {
    setGstTicks((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return customers.filter((c) => {
      const haystack = [c.name, c.contact_person, c.address, c.email, c.phone]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      const matchesSearch = !q || haystack.includes(q);
      const matchesGst = gstTicks.size === 0 || gstTicks.has(gstStatus(c));
      return matchesSearch && matchesGst;
    });
  }, [customers, search, gstTicks]);

  const filtersActive = search.trim() !== "" || gstTicks.size > 0;

  function openAdd() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setFormOpen(true);
  }

  function openEdit(c: Customer) {
    setEditingId(c.id);
    setForm(formFor(c));
    setFormError(null);
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setEditingId(null);
    setFormError(null);
  }

  const set = (key: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) return;

    const code = form.code.trim();
    const name = form.name.trim();
    const days = Number(form.credit_days);
    const limit = Number(form.credit_limit);

    if (!code || !name) return setFormError("Code and Name are both required.");
    if (!Number.isInteger(days) || days < 0) return setFormError("Credit days must be a whole number, 0 or more.");
    if (!Number.isFinite(limit) || limit < 0) return setFormError("Credit limit must be a number, 0 or more.");

    /* Blank optional boxes should be stored as empty, not as the text "". */
    const payload = {
      code,
      name,
      contact_person: form.contact_person.trim() || null,
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
      credit_days: days,
      credit_limit: limit,
    };

    setSaving(true);
    setFormError(null);

    const { error } = editingId
      ? await supabase.from("customers").update(payload).eq("id", editingId)
      : await supabase.from("customers").insert(payload);

    setSaving(false);

    if (error) {
      /* 23505 is Postgres for "that unique value is already taken". */
      setFormError(
        error.code === "23505"
          ? `Customer code "${code}" is already used by another customer. Pick a different code.`
          : error.message,
      );
      return;
    }

    setNotice(editingId ? `Saved changes to ${name}.` : `Added ${name}.`);
    closeForm();
    await load();
  }

  if (!isConfigured || !supabase) return <NotConfigured />;

  const columns: Column<Customer>[] = [
    {
      key: "name",
      header: "Customer Name",
      render: (c) => (
        <div className="flex items-center gap-2.5">
          <span
            className={`flex h-7 w-7 flex-none items-center justify-center rounded-full text-xs font-bold ${avatarColor(c.code)}`}
          >
            {c.name.charAt(0).toUpperCase()}
          </span>
          <span className="font-medium text-slate-800 dark:text-slate-100">{c.name}</span>
        </div>
      ),
    },
    { key: "city", header: "Location", render: (c) => c.address ?? "—" },
    { key: "contact_person", header: "Contact Person", render: (c) => c.contact_person ?? "—" },
    { key: "email", header: "Email ID", render: (c) => c.email ?? "—" },
    { key: "phone", header: "Contact Number", render: (c) => c.phone ?? "—" },
    {
      key: "gst_treatment",
      header: "GST Treatment",
      /* Derived, not stored: this schema only has a raw gstin, no real treatment
         field (Regular / Composition / SEZ / Consumer, etc). "Registered" here just
         means a GSTIN is on file. */
      render: (c) => {
        const registered = gstStatus(c) === "Registered";
        return (
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
              registered ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"
            }`}
          >
            {gstStatus(c)}
          </span>
        );
      },
    },
    {
      key: "gstin",
      header: "GST Number",
      render: (c) => <span className="font-mono text-sm font-bold text-slate-700 dark:text-slate-300">{c.gstin ?? "—"}</span>,
    },
    {
      key: "pan",
      header: "PAN",
      render: (c) => <span className="font-mono text-sm font-bold text-slate-700 dark:text-slate-300">{c.pan ?? "—"}</span>,
    },
    { key: "credit_limit", header: "Credit Limit", render: (c) => money(c.credit_limit) },
    {
      key: "net_receivable",
      header: "Net Receivable",
      render: (c) => {
        const amt = netReceivable[c.id] ?? c.opening_balance;
        return <span className={amt > c.credit_limit ? "font-semibold text-rose-600 dark:text-rose-400" : "text-slate-700 dark:text-slate-300"}>{money(amt)}</span>;
      },
    },
    {
      key: "actions",
      header: "",
      className: "text-right",
      render: (c) => (
        <button
          type="button"
          onClick={() => openEdit(c)}
          className="rounded-lg border border-brand/30 px-3 py-1 text-xs font-medium text-brand hover:bg-brand/10"
        >
          Edit
        </button>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Customer Master"
        subtitle="Everyone who owes us money. Every other screen leans on this list."
        action={
          <button
            type="button"
            onClick={openAdd}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark"
          >
            Add Customer
          </button>
        }
      />

      {notice && (
        <div className="mb-4 flex items-center justify-between rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)} className="text-emerald-600 hover:text-emerald-900">
            Dismiss
          </button>
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-cream p-4 shadow-sm">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, contact, location, email or phone…"
          className="w-full flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand focus:ring-1 focus:ring-brand sm:w-auto"
        />
        <div className="flex flex-wrap items-center gap-2">
          {(["Registered", "Unregistered"] as GstStatus[]).map((s) => {
            const active = gstTicks.has(s);
            return (
              <button
                key={s}
                type="button"
                onClick={() => toggleGst(s)}
                aria-pressed={active}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  active ? GST_CHIP_ACTIVE[s] : GST_CHIP_INACTIVE[s]
                }`}
              >
                {s}
              </button>
            );
          })}
        </div>
        {filtersActive && (
          <button
            type="button"
            onClick={() => {
              setSearch("");
              setGstTicks(new Set());
            }}
            className="text-xs font-medium text-brand hover:underline"
          >
            Clear filters
          </button>
        )}
      </div>

      {formOpen && (
        <form onSubmit={save} className="mb-6 rounded-xl border border-slate-200 bg-cream p-6">
          <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">
            {editingId ? "Edit customer" : "New customer"}
          </h3>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <FormField label="Code">
              <input className={inputClass} value={form.code} onChange={set("code")} placeholder="CUST013" required />
            </FormField>
            <FormField label="Name">
              <input className={inputClass} value={form.name} onChange={set("name")} placeholder="Acme Pvt Ltd" required />
            </FormField>
            <FormField label="Contact Person">
              <input className={inputClass} value={form.contact_person} onChange={set("contact_person")} placeholder="Rohit Mehta" />
            </FormField>
            <FormField label="Email">
              <input className={inputClass} type="email" value={form.email} onChange={set("email")} placeholder="rohit@acme.com" />
            </FormField>
            <FormField label="Phone">
              <input className={inputClass} value={form.phone} onChange={set("phone")} placeholder="+91 98200 00000" />
            </FormField>
            <FormField label="Credit Days">
              <input className={inputClass} type="number" min="0" step="1" value={form.credit_days} onChange={set("credit_days")} />
            </FormField>
            <FormField label="Credit Limit (₹)">
              <input className={inputClass} type="number" min="0" step="0.01" value={form.credit_limit} onChange={set("credit_limit")} />
            </FormField>
          </div>

          {formError && (
            <p className="mt-4 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-700">{formError}</p>
          )}

          <div className="mt-6 flex gap-3">
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-50"
            >
              {saving ? "Saving…" : editingId ? "Save Changes" : "Add Customer"}
            </button>
            <button
              type="button"
              onClick={closeForm}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="rounded-xl border border-slate-200 bg-cream px-4 py-10 text-center text-sm text-slate-400">
          Loading customers…
        </div>
      ) : loadError ? (
        <div className="rounded-xl border border-rose-300 bg-rose-50 p-6 text-rose-800">
          <p className="font-semibold">Couldn&apos;t load customers.</p>
          <p className="mt-1 text-sm">{loadError}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-3 rounded-lg border border-rose-300 px-3 py-1 text-sm font-medium hover:bg-rose-100"
          >
            Try again
          </button>
        </div>
      ) : (
        <>
          <DataTable
            columns={columns}
            rows={filtered}
            empty={
              filtersActive
                ? "No customers match your search or filters."
                : "No customers yet. Click Add Customer to create the first one."
            }
          />
          <p className="mt-3 text-sm text-slate-500">
            Showing {filtered.length} of {customers.length} {customers.length === 1 ? "customer" : "customers"}
          </p>
        </>
      )}
    </>
  );
}
