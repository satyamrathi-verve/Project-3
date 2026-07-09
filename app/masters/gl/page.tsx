"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { supabase, isConfigured } from "@/lib/supabase";
import type { GLAccount, GLAccountStatus } from "@/lib/types";
import { ACCOUNT_DESCRIPTIONS, GL_GROUPS, glGroupForAccount } from "@/lib/chartOfAccounts";
import { parseCSVToObjects, downloadTextFile, exportTimestamp } from "@/lib/csv";
import {
  buildImportTemplateCSV,
  buildExportCSV,
  validateImportRows,
  type ImportMode,
  type ImportPlan,
} from "@/lib/glImport";
import { PageHeader } from "@/components/PageHeader";
import { NotConfigured } from "@/components/NotConfigured";
import { DataTable, type Column } from "@/components/DataTable";
import { FormField, inputClass } from "@/components/FormField";
import { SearchableSelect } from "@/components/SearchableSelect";
import { useToast } from "@/components/Toast";

const TYPE_LABEL: Record<GLAccount["type"], string> = {
  asset: "Asset",
  liability: "Liability",
  income: "Income",
  expense: "Expense",
};

const TYPE_BADGE: Record<GLAccount["type"], string> = {
  asset: "bg-blue-50 text-blue-700",
  liability: "bg-amber-50 text-amber-700",
  income: "bg-emerald-50 text-emerald-700",
  expense: "bg-rose-50 text-rose-700",
};

// How often the screen quietly refetches to pick up balance changes made by
// teammates elsewhere — a real (not simulated) "live" update, since this app
// has no transaction/journal engine to compute balances from; current_balance
// only ever changes when someone edits it via the Edit modal.
const POLL_INTERVAL_MS = 20000;
const TREND_DISPLAY_MS = 6000;

export default function GLMasterPage() {
  return <GLMasterScreen />;
}

function GLMasterScreen() {
  const { show: showToast } = useToast();
  const [accounts, setAccounts] = useState<GLAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [trends, setTrends] = useState<Record<string, "up" | "down">>({});
  const lastBalances = useRef<Map<string, number>>(new Map());

  const [addOpen, setAddOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<GLAccount | null>(null);

  useEffect(() => {
    if (!isConfigured || !supabase) {
      setLoading(false);
      return;
    }
    void loadAccounts();

    const interval = setInterval(() => {
      if (!document.hidden) void loadAccounts({ silent: true });
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  async function loadAccounts(opts?: { silent?: boolean }) {
    if (!opts?.silent) setLoading(true);
    setError(null);
    const { data, error } = await supabase!.from("gl_accounts").select("*").order("code");
    if (error) {
      setError(error.message);
      if (!opts?.silent) setLoading(false);
      return;
    }

    const next = data ?? [];
    const changed: Record<string, "up" | "down"> = {};
    for (const a of next) {
      const prev = lastBalances.current.get(a.id);
      const cur = a.current_balance ?? 0;
      if (prev !== undefined && cur !== prev) changed[a.id] = cur > prev ? "up" : "down";
    }
    if (Object.keys(changed).length > 0) {
      setTrends((t) => ({ ...t, ...changed }));
      setTimeout(() => {
        setTrends((t) => {
          const copy = { ...t };
          for (const id of Object.keys(changed)) delete copy[id];
          return copy;
        });
      }, TREND_DISPLAY_MS);
    }
    lastBalances.current = new Map(next.map((a) => [a.id, a.current_balance ?? 0]));

    setAccounts(next);
    if (!opts?.silent) setLoading(false);
  }

  const filteredAccounts = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return accounts;
    return accounts.filter(
      (a) =>
        a.code.toLowerCase().includes(q) ||
        a.name.toLowerCase().includes(q) ||
        (a.parent_group ?? "").toLowerCase().includes(q)
    );
  }, [accounts, search]);

  // Total Assets / Liabilities / Equity / Revenue / Expenses summary strip.
  // Equity is stored as type "liability" (see lib/chartOfAccounts.ts) so it's
  // split out by parent_group; Revenue folds in "Other Income" and Expenses
  // folds in COGS + "Other Expenses" since the strip only has 5 buckets.
  const summary = useMemo(() => {
    let assets = 0,
      liabilities = 0,
      equity = 0,
      revenue = 0,
      expenses = 0;
    for (const a of accounts) {
      const bal = a.current_balance ?? 0;
      if (a.type === "asset") assets += bal;
      else if (a.type === "liability") {
        if (a.parent_group === "Equity") equity += bal;
        else liabilities += bal;
      } else if (a.type === "income") revenue += bal;
      else if (a.type === "expense") expenses += bal;
    }
    return { assets, liabilities, equity, revenue, expenses };
  }, [accounts]);

  function handleExport(scope: "filtered" | "all") {
    const rows = scope === "filtered" ? filteredAccounts : accounts;
    if (rows.length === 0) {
      showToast("error", "Nothing to export.");
      return;
    }
    const csv = buildExportCSV(rows);
    downloadTextFile(`GL_Master_Export_${exportTimestamp()}.csv`, csv);
    showToast("success", `Exported ${rows.length} account${rows.length === 1 ? "" : "s"}.`);
  }

  function handleDownloadTemplate() {
    downloadTextFile("GL_Master_Import_Template.csv", buildImportTemplateCSV());
  }

  const columns: Column<GLAccount>[] = [
    { key: "code", header: "Code", className: "w-24 font-mono" },
    { key: "name", header: "Name" },
    {
      key: "type",
      header: "Type",
      render: (row) => (
        <span className={`rounded px-2 py-0.5 text-xs font-medium ${TYPE_BADGE[row.type]}`}>
          {glGroupForAccount(row)?.label ?? TYPE_LABEL[row.type]}
        </span>
      ),
    },
    { key: "parent_group", header: "Group", render: (row) => row.parent_group ?? "—" },
    {
      key: "description",
      header: "Description",
      className: "text-slate-500",
      render: (row) => row.description || ACCOUNT_DESCRIPTIONS[row.code] || "—",
    },
    {
      key: "balance",
      header: "Balance",
      className: "text-right",
      render: (row) => {
        const trend = trends[row.id];
        return (
          <span className="inline-flex items-center justify-end gap-1.5">
            {(row.current_balance ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
            {trend === "up" && <span className="text-xs text-emerald-600">▲</span>}
            {trend === "down" && <span className="text-xs text-rose-600">▼</span>}
          </span>
        );
      },
    },
    {
      key: "status",
      header: "Status",
      render: (row) => (
        <span
          className={`rounded px-2 py-0.5 text-xs font-medium ${
            row.status === "inactive" ? "bg-slate-100 text-slate-500" : "bg-emerald-50 text-emerald-700"
          }`}
        >
          {row.status === "inactive" ? "Inactive" : "Active"}
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      className: "w-16 text-right",
      render: (row) => (
        <button type="button" onClick={() => setEditingAccount(row)} className="text-xs font-medium text-brand underline">
          Edit
        </button>
      ),
    },
  ];

  if (!isConfigured) {
    return (
      <>
        <PageHeader title="GL Master" subtitle="Chart of accounts used across the AR Manager." />
        <NotConfigured />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="GL Master"
        subtitle={`Chart of accounts — ${accounts.length} ledger account${accounts.length === 1 ? "" : "s"}.`}
        action={
          <div className="flex items-center gap-2">
            <GLImportExportMenu accounts={accounts} onDownloadTemplate={handleDownloadTemplate} onImported={loadAccounts} />
            <button
              type="button"
              onClick={() => handleExport("filtered")}
              className="rounded-lg border border-slate-300 bg-cream px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-cream-dim"
            >
              Export
            </button>
            <button
              type="button"
              onClick={() => setAddOpen(true)}
              className="rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-dark"
            >
              + Add New
            </button>
          </div>
        }
      />

      <SummaryStrip summary={summary} />

      {error && (
        <div className="mb-6 rounded-xl border border-rose-300 bg-rose-50 p-4 text-sm text-rose-700">
          Couldn&apos;t load accounts: {error}
        </div>
      )}

      <div className="mb-4 flex items-center justify-between gap-4">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by code, name, or group…"
          className={`${inputClass} max-w-sm flex-1`}
        />
        <button
          type="button"
          onClick={() => handleExport("all")}
          className="text-sm text-slate-500 underline hover:text-brand"
        >
          Export all ({accounts.length})
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">Loading accounts…</p>
      ) : (
        <DataTable columns={columns} rows={filteredAccounts} empty="No GL accounts match." />
      )}

      {addOpen && (
        <AddAccountModal
          accounts={accounts}
          onClose={() => setAddOpen(false)}
          onSaved={async () => {
            setAddOpen(false);
            await loadAccounts();
          }}
        />
      )}

      {editingAccount && (
        <EditAccountModal
          account={editingAccount}
          accounts={accounts}
          onClose={() => setEditingAccount(null)}
          onSaved={async () => {
            setEditingAccount(null);
            await loadAccounts();
          }}
        />
      )}
    </>
  );
}

function SummaryStrip({
  summary,
}: {
  summary: { assets: number; liabilities: number; equity: number; revenue: number; expenses: number };
}) {
  const cards: { label: string; value: number; tone: string }[] = [
    { label: "Total Assets", value: summary.assets, tone: "text-blue-700" },
    { label: "Total Liabilities", value: summary.liabilities, tone: "text-amber-700" },
    { label: "Total Equity", value: summary.equity, tone: "text-purple-700" },
    { label: "Total Revenue", value: summary.revenue, tone: "text-emerald-700" },
    { label: "Total Expenses", value: summary.expenses, tone: "text-rose-700" },
  ];
  return (
    <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {cards.map((c) => (
        <div key={c.label} className="rounded-xl border border-slate-200 bg-cream p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{c.label}</p>
          <p className={`mt-1 text-xl font-bold ${c.tone}`}>
            {c.value.toLocaleString(undefined, { minimumFractionDigits: 2 })}
          </p>
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------- Add / Edit modals

interface AccountFormState {
  name: string;
  groupLabel: string;
  category: string;
  parent_account_id: string;
  balance: string;
  status: GLAccountStatus;
  description: string;
}

function emptyFormState(): AccountFormState {
  const first = GL_GROUPS[0];
  return {
    name: "",
    groupLabel: first.label,
    category: first.categories[0],
    parent_account_id: "",
    balance: "0",
    status: "active",
    description: "",
  };
}

function GroupCategoryFields({
  form,
  setForm,
}: {
  form: AccountFormState;
  setForm: (f: AccountFormState) => void;
}) {
  const group = GL_GROUPS.find((g) => g.label === form.groupLabel) ?? GL_GROUPS[0];
  // Custom/imported accounts can carry a parent_group outside the 8 standard
  // groups' category lists (free text was always allowed via CSV import and
  // the original Add form) — keep that value selectable instead of silently
  // mismatching the dropdown or losing it on save.
  const categoryOptions = group.categories.includes(form.category)
    ? group.categories
    : [form.category, ...group.categories];
  return (
    <>
      <FormField label="GL Group / Account Type">
        <select
          className={inputClass}
          value={form.groupLabel}
          onChange={(e) => {
            const next = GL_GROUPS.find((g) => g.label === e.target.value) ?? GL_GROUPS[0];
            setForm({ ...form, groupLabel: next.label, category: next.categories[0] });
          }}
        >
          {GL_GROUPS.map((g) => (
            <option key={g.label} value={g.label}>
              {g.label}
            </option>
          ))}
        </select>
      </FormField>
      <FormField label="Category / Sub-category">
        <select className={inputClass} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
          {categoryOptions.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </FormField>
    </>
  );
}

function AddAccountModal({
  accounts,
  onClose,
  onSaved,
}: {
  accounts: GLAccount[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { show: showToast } = useToast();
  const [form, setForm] = useState<AccountFormState>(emptyFormState());
  const [reservedCode, setReservedCode] = useState<string | null>(null);
  const [reserveError, setReserveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    // Reserve the V-number as soon as the modal opens so it can be shown
    // read-only, e.g. "V0142" — the exact number used on save (not re-fetched).
    void (async () => {
      const { data, error } = await supabase!.rpc("next_gl_account_number");
      if (error) {
        setReserveError(
          error.message.includes("Could not find the function")
            ? "V-number generator isn't set up yet — run supabase/migrations/002_gl_v_series.sql first."
            : error.message
        );
      } else {
        setReservedCode(data as string);
      }
    })();
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    const name = form.name.trim();
    if (!name) return setFormError("Account name is required.");
    if (!reservedCode) return setFormError(reserveError ?? "V-number not ready yet — please wait a moment.");
    const balance = Number(form.balance || "0");
    if (Number.isNaN(balance)) return setFormError("Opening balance must be a number.");

    const group = GL_GROUPS.find((g) => g.label === form.groupLabel)!;
    setSaving(true);
    const { error } = await supabase!.from("gl_accounts").insert({
      code: reservedCode,
      name,
      type: group.type,
      parent_group: form.category,
      parent_account_id: form.parent_account_id || null,
      opening_balance: balance,
      current_balance: balance,
      description: form.description.trim() || null,
      status: form.status,
    });
    setSaving(false);
    if (error) return setFormError(error.message);

    showToast("success", `Account ${reservedCode} — ${name} added.`);
    await onSaved();
  }

  const parentOptions = accounts.map((a) => ({ value: a.id, label: `${a.code} — ${a.name}` }));

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-slate-200 bg-cream p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-900">Add New Account</h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700">
            ✕
          </button>
        </div>
        <form onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2">
          <FormField label="V-Number">
            <input
              disabled
              value={reservedCode ?? (reserveError ? "Unavailable" : "Reserving…")}
              className={`${inputClass} cursor-not-allowed bg-cream-dim font-mono text-slate-500`}
            />
          </FormField>
          <FormField label="Account Name">
            <input
              className={inputClass}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Foreign Currency Account"
              autoFocus
            />
          </FormField>
          <GroupCategoryFields form={form} setForm={setForm} />
          <FormField label="Parent Account">
            <SearchableSelect
              value={form.parent_account_id}
              onChange={(v) => setForm({ ...form, parent_account_id: v })}
              options={parentOptions}
              placeholder="Search accounts…"
            />
          </FormField>
          <FormField label="Opening Balance">
            <input
              type="number"
              step="0.01"
              className={inputClass}
              value={form.balance}
              onChange={(e) => setForm({ ...form, balance: e.target.value })}
            />
          </FormField>
          <FormField label="Status">
            <select
              className={inputClass}
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value as GLAccountStatus })}
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </FormField>
          <div className="sm:col-span-2">
            <FormField label="Description">
              <input
                className={inputClass}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Optional"
              />
            </FormField>
          </div>
          <div className="flex items-center justify-end gap-2 sm:col-span-2">
            {formError && <p className="mr-auto text-xs text-rose-600">{formError}</p>}
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-cream-dim"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-brand px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-60"
            >
              {saving ? "Adding…" : "Add Account"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function EditAccountModal({
  account,
  accounts,
  onClose,
  onSaved,
}: {
  account: GLAccount;
  accounts: GLAccount[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { show: showToast } = useToast();
  const initialGroup = glGroupForAccount(account) ?? GL_GROUPS[0];
  const [form, setForm] = useState<AccountFormState>({
    name: account.name,
    groupLabel: initialGroup.label,
    category: account.parent_group ?? initialGroup.categories[0],
    parent_account_id: account.parent_account_id ?? "",
    balance: String(account.current_balance ?? 0),
    status: account.status ?? "active",
    description: account.description ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    const name = form.name.trim();
    if (!name) return setFormError("Account name is required.");
    const balance = Number(form.balance || "0");
    if (Number.isNaN(balance)) return setFormError("Current balance must be a number.");

    const group = GL_GROUPS.find((g) => g.label === form.groupLabel)!;
    setSaving(true);
    const { error } = await supabase!
      .from("gl_accounts")
      .update({
        name,
        type: group.type,
        parent_group: form.category,
        parent_account_id: form.parent_account_id || null,
        current_balance: balance,
        status: form.status,
        description: form.description.trim() || null,
      })
      .eq("id", account.id);
    setSaving(false);
    if (error) return setFormError(error.message);

    showToast("success", `Account ${account.code} updated.`);
    await onSaved();
  }

  // Can't select the account itself, or one of its direct children, as its own parent.
  const parentOptions = accounts
    .filter((a) => a.id !== account.id && a.parent_account_id !== account.id)
    .map((a) => ({ value: a.id, label: `${a.code} — ${a.name}` }));

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-slate-200 bg-cream p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-900">Edit Account — {account.code}</h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700">
            ✕
          </button>
        </div>
        <form onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2">
          <FormField label="Account Name">
            <input
              className={inputClass}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              autoFocus
            />
          </FormField>
          <GroupCategoryFields form={form} setForm={setForm} />
          <FormField label="Parent Account">
            <SearchableSelect
              value={form.parent_account_id}
              onChange={(v) => setForm({ ...form, parent_account_id: v })}
              options={parentOptions}
              placeholder="Search accounts…"
            />
          </FormField>
          <FormField label="Current Balance">
            <input
              type="number"
              step="0.01"
              className={inputClass}
              value={form.balance}
              onChange={(e) => setForm({ ...form, balance: e.target.value })}
            />
          </FormField>
          <FormField label="Status">
            <select
              className={inputClass}
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value as GLAccountStatus })}
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </FormField>
          <div className="sm:col-span-2">
            <FormField label="Description">
              <input
                className={inputClass}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Optional"
              />
            </FormField>
          </div>
          <div className="flex items-center justify-end gap-2 sm:col-span-2">
            {formError && <p className="mr-auto text-xs text-rose-600">{formError}</p>}
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-cream-dim"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-brand px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save Changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// -------------------------------------------------------------------- Import

function GLImportExportMenu({
  accounts,
  onDownloadTemplate,
  onImported,
}: {
  accounts: GLAccount[];
  onDownloadTemplate: () => void;
  onImported: () => Promise<void>;
}) {
  const { show: showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<ImportMode>("add-update");
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [committing, setCommitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function reset() {
    setPlan(null);
    setFileName(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleFile(file: File) {
    setFileName(file.name);
    const text = await file.text();
    const rows = parseCSVToObjects(text);
    setPlan(validateImportRows(rows, accounts, mode));
  }

  async function commit() {
    if (!plan) return;
    setCommitting(true);
    try {
      const codeToId = new Map<string, string>(accounts.map((a) => [a.code, a.id]));

      for (const row of plan.toAdd) {
        let code = row.vNumber;
        if (!code) {
          const { data, error } = await supabase!.rpc("next_gl_account_number");
          if (error) throw new Error(error.message);
          code = data as string;
        }
        const { data, error } = await supabase!
          .from("gl_accounts")
          .insert({
            code,
            name: row.name,
            type: row.type,
            parent_group: row.parent_group,
            opening_balance: row.opening_balance,
            current_balance: row.opening_balance,
            description: row.description,
            status: row.status,
          })
          .select()
          .single();
        if (error) throw new Error(error.message);
        codeToId.set(code, data.id);
      }

      for (const row of plan.toUpdate) {
        if (!row.existingId) continue;
        const { error } = await supabase!
          .from("gl_accounts")
          .update({
            name: row.name,
            type: row.type,
            parent_group: row.parent_group,
            opening_balance: row.opening_balance,
            description: row.description,
            status: row.status,
          })
          .eq("id", row.existingId);
        if (error) throw new Error(error.message);
        if (row.vNumber) codeToId.set(row.vNumber, row.existingId);
      }

      for (const row of [...plan.toAdd, ...plan.toUpdate]) {
        if (!row.parentAccountCode) continue;
        const childId = row.existingId ?? (row.vNumber ? codeToId.get(row.vNumber) : undefined);
        const parentId = codeToId.get(row.parentAccountCode);
        if (childId && parentId) {
          await supabase!.from("gl_accounts").update({ parent_account_id: parentId }).eq("id", childId);
        }
      }

      showToast("success", `Import complete — ${plan.toAdd.length} added, ${plan.toUpdate.length} updated.`);
      setOpen(false);
      reset();
      await onImported();
    } catch (err) {
      showToast("error", `Import failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setCommitting(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg border border-slate-300 bg-cream px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-cream-dim"
      >
        Import
      </button>

      {open && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-slate-200 bg-cream p-6">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-900">Import GL Accounts</h3>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  reset();
                }}
                className="text-slate-400 hover:text-slate-700"
              >
                ✕
              </button>
            </div>

            <button type="button" onClick={onDownloadTemplate} className="mb-4 text-sm text-brand underline">
              Download CSV template
            </button>

            <div className="mb-4 flex gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={mode === "add-update"}
                  onChange={() => {
                    setMode("add-update");
                    if (fileInputRef.current?.files?.[0]) void handleFile(fileInputRef.current.files[0]);
                  }}
                />
                Add + Update existing accounts
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={mode === "add-only"}
                  onChange={() => {
                    setMode("add-only");
                    if (fileInputRef.current?.files?.[0]) void handleFile(fileInputRef.current.files[0]);
                  }}
                />
                Add new accounts only
              </label>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleFile(file);
              }}
              className="mb-4 block w-full text-sm"
            />

            {fileName && plan && (
              <div className="rounded-lg border border-slate-200 p-4">
                <p className="text-sm text-slate-600">
                  <span className="font-medium text-slate-900">{fileName}</span> — {plan.toAdd.length} to add,{" "}
                  {plan.toUpdate.length} to update, {plan.errors.length} error{plan.errors.length === 1 ? "" : "s"}.
                </p>

                {plan.errors.length > 0 ? (
                  <div className="mt-3 max-h-64 overflow-y-auto rounded border border-rose-200">
                    <table className="w-full text-xs">
                      <thead className="bg-rose-50 text-rose-700">
                        <tr>
                          <th className="px-2 py-1.5 text-left">Row</th>
                          <th className="px-2 py-1.5 text-left">Field</th>
                          <th className="px-2 py-1.5 text-left">Issue</th>
                        </tr>
                      </thead>
                      <tbody>
                        {plan.errors.map((e, i) => (
                          <tr key={i} className="border-t border-rose-100">
                            <td className="px-2 py-1.5">{e.row}</td>
                            <td className="px-2 py-1.5">{e.field}</td>
                            <td className="px-2 py-1.5">{e.message}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p className="p-2 text-xs text-rose-700">
                      Fix these rows in your file and re-upload — no changes have been made yet.
                    </p>
                  </div>
                ) : (
                  <div className="mt-3 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setOpen(false);
                        reset();
                      }}
                      className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-cream-dim"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={committing || (plan.toAdd.length === 0 && plan.toUpdate.length === 0)}
                      onClick={commit}
                      className="rounded-lg bg-brand px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-60"
                    >
                      {committing ? "Importing…" : "Confirm Import"}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
