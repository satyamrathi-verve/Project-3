"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { supabase, isConfigured } from "@/lib/supabase";
import type { GLAccount, GLAccountStatus } from "@/lib/types";
import { ACCOUNT_DESCRIPTIONS, PARENT_GROUPS } from "@/lib/chartOfAccounts";
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

const EMPTY_FORM = {
  name: "",
  type: "asset" as GLAccount["type"],
  parent_group: "",
  parent_account_id: "",
  opening_balance: "0",
  description: "",
  status: "active" as GLAccountStatus,
};

export default function GLMasterPage() {
  return <GLMasterScreen />;
}

function GLMasterScreen() {
  const { show: showToast } = useToast();
  const [accounts, setAccounts] = useState<GLAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!isConfigured || !supabase) {
      setLoading(false);
      return;
    }
    void loadAccounts();
  }, []);

  async function loadAccounts() {
    setLoading(true);
    setError(null);
    const { data, error } = await supabase!.from("gl_accounts").select("*").order("code");
    if (error) {
      setError(error.message);
    } else {
      setAccounts(data ?? []);
    }
    setLoading(false);
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

  async function handleAddAccount(e: FormEvent) {
    e.preventDefault();
    setFormError(null);

    const name = form.name.trim();
    if (!name) {
      setFormError("Name is required.");
      return;
    }
    const openingBalance = Number(form.opening_balance || "0");
    if (Number.isNaN(openingBalance)) {
      setFormError("Opening balance must be a number.");
      return;
    }

    setSaving(true);
    const { data: newCode, error: rpcError } = await supabase!.rpc("next_gl_account_number");
    if (rpcError) {
      setSaving(false);
      setFormError(
        rpcError.message.includes("Could not find the function")
          ? "V-number generator isn't set up yet — run supabase/migrations/002_gl_v_series.sql first."
          : rpcError.message
      );
      return;
    }

    const { error } = await supabase!.from("gl_accounts").insert({
      code: newCode,
      name,
      type: form.type,
      parent_group: form.parent_group.trim() || null,
      parent_account_id: form.parent_account_id || null,
      opening_balance: openingBalance,
      current_balance: openingBalance,
      description: form.description.trim() || null,
      status: form.status,
    });
    setSaving(false);

    if (error) {
      setFormError(error.message);
      return;
    }
    setForm(EMPTY_FORM);
    showToast("success", `Account ${newCode} — ${name} added.`);
    await loadAccounts();
  }

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
          {TYPE_LABEL[row.type]}
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
      key: "opening_balance",
      header: "Balance",
      className: "text-right",
      render: (row) => (row.opening_balance ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 }),
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
        action={<GLImportExportMenu accounts={accounts} onDownloadTemplate={handleDownloadTemplate} onImported={loadAccounts} />}
      />

      <form
        onSubmit={handleAddAccount}
        className="mb-6 grid gap-4 rounded-xl border border-slate-200 bg-white p-6 sm:grid-cols-2 lg:grid-cols-4"
      >
        <FormField label="Code">
          <input
            disabled
            value="Auto-generated on save"
            className={`${inputClass} cursor-not-allowed bg-slate-50 text-slate-400`}
          />
        </FormField>
        <FormField label="Name">
          <input
            className={inputClass}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="e.g. Foreign Currency Account"
          />
        </FormField>
        <FormField label="Type">
          <select
            className={inputClass}
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value as GLAccount["type"] })}
          >
            <option value="asset">Asset</option>
            <option value="liability">Liability</option>
            <option value="income">Income</option>
            <option value="expense">Expense</option>
          </select>
        </FormField>
        <FormField label="Group / Category">
          <input
            className={inputClass}
            value={form.parent_group}
            onChange={(e) => setForm({ ...form, parent_group: e.target.value })}
            placeholder="e.g. Current Assets"
            list="parent-group-options"
          />
          <datalist id="parent-group-options">
            {PARENT_GROUPS.map((g) => (
              <option key={g} value={g} />
            ))}
          </datalist>
        </FormField>
        <FormField label="Parent Account">
          <select
            className={inputClass}
            value={form.parent_account_id}
            onChange={(e) => setForm({ ...form, parent_account_id: e.target.value })}
          >
            <option value="">None</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} — {a.name}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="Opening Balance">
          <input
            type="number"
            step="0.01"
            className={inputClass}
            value={form.opening_balance}
            onChange={(e) => setForm({ ...form, opening_balance: e.target.value })}
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
        <FormField label="Description">
          <input
            className={inputClass}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="Optional"
          />
        </FormField>
        <div className="flex flex-col justify-end gap-1 lg:col-span-4">
          <button
            type="submit"
            disabled={saving}
            className="w-fit rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-dark disabled:opacity-60"
          >
            {saving ? "Adding…" : "Add account"}
          </button>
          {formError && <p className="text-xs text-rose-600">{formError}</p>}
        </div>
      </form>

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
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <button type="button" onClick={() => handleExport("filtered")} className="underline hover:text-brand">
            Export {search ? "filtered" : "shown"} ({filteredAccounts.length})
          </button>
          <span>·</span>
          <button type="button" onClick={() => handleExport("all")} className="underline hover:text-brand">
            Export all ({accounts.length})
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">Loading accounts…</p>
      ) : (
        <DataTable columns={columns} rows={filteredAccounts} empty="No GL accounts match." />
      )}
    </>
  );
}

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
        className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
      >
        Import
      </button>

      {open && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-slate-200 bg-white p-6">
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
                      className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
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
