import type { GLAccount, GLAccountStatus } from "@/lib/types";
import { ACCOUNT_TYPES } from "@/lib/chartOfAccounts";
import { toCSV } from "@/lib/csv";

/*
  GL Master import/export: column definitions + all-or-nothing validation.
  Kept as plain functions (no React) so the rules are easy to test and reuse —
  e.g. a future .xlsx exporter would consume the same EXPORT_COLUMNS list
  instead of duplicating field order/formatting.
*/

export const IMPORT_TEMPLATE_HEADERS = [
  "V-Number",
  "Account Name",
  "Account Type",
  "Category/Sub-category",
  "Parent Account (V-Number)",
  "Opening Balance",
  "Description",
  "Status",
] as const;

export const EXPORT_HEADERS = [
  "V-Number",
  "Account Name",
  "Account Type",
  "Category/Sub-category",
  "Parent Account",
  "Opening Balance",
  "Current Balance",
  "Description",
  "Status",
  "Created Date",
] as const;

const TYPE_LABEL: Record<GLAccount["type"], string> = {
  asset: "Asset",
  liability: "Liability",
  income: "Income",
  expense: "Expense",
};

export function buildImportTemplateCSV(): string {
  const sampleRow = [
    "",
    "Foreign Currency Account",
    "Asset",
    "Current Assets",
    "",
    "0",
    "Bank account held in a foreign currency.",
    "Active",
  ];
  return toCSV([...IMPORT_TEMPLATE_HEADERS], [sampleRow]);
}

export function buildExportCSV(accounts: GLAccount[]): string {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const rows = accounts.map((a) => {
    const parent = a.parent_account_id ? byId.get(a.parent_account_id) : undefined;
    return [
      a.code,
      a.name,
      TYPE_LABEL[a.type],
      a.parent_group ?? "",
      parent?.code ?? "",
      a.opening_balance ?? 0,
      a.current_balance ?? 0,
      a.description ?? "",
      a.status === "inactive" ? "Inactive" : "Active",
      a.created_at ? a.created_at.slice(0, 10) : "",
    ];
  });
  return toCSV([...EXPORT_HEADERS], rows);
}

// ---------------------------------------------------------------- validation

export interface ValidationIssue {
  row: number; // 1-based data row (row 1 = first row after the header)
  field: string;
  message: string;
}

export interface ImportRowPlan {
  rowNumber: number;
  /** Resolved V-number, or null if it must be auto-assigned at commit time. */
  vNumber: string | null;
  action: "add" | "update";
  existingId?: string;
  name: string;
  type: GLAccount["type"];
  parent_group: string | null;
  parentAccountCode: string | null;
  opening_balance: number;
  description: string | null;
  status: GLAccountStatus;
}

export interface ImportPlan {
  toAdd: ImportRowPlan[];
  toUpdate: ImportRowPlan[];
  errors: ValidationIssue[];
}

export type ImportMode = "add-only" | "add-update";

const V_NUMBER_RE = /^V\d{4}$/i;

export function validateImportRows(
  rawRows: Record<string, string>[],
  existingAccounts: GLAccount[],
  mode: ImportMode
): ImportPlan {
  const errors: ValidationIssue[] = [];
  const toAdd: ImportRowPlan[] = [];
  const toUpdate: ImportRowPlan[] = [];

  const existingByCode = new Map(existingAccounts.map((a) => [a.code.toUpperCase(), a]));
  const seenInFile = new Set<string>();
  const allCodesInFile = new Set<string>(
    rawRows
      .map((r) => (r["V-Number"] ?? "").trim().toUpperCase())
      .filter((c) => V_NUMBER_RE.test(c))
  );

  rawRows.forEach((raw, idx) => {
    const rowNumber = idx + 1;
    const vNumberRaw = (raw["V-Number"] ?? "").trim();
    const name = (raw["Account Name"] ?? "").trim();
    const typeRaw = (raw["Account Type"] ?? "").trim();
    const category = (raw["Category/Sub-category"] ?? "").trim();
    const parentRaw = (raw["Parent Account (V-Number)"] ?? "").trim();
    const balanceRaw = (raw["Opening Balance"] ?? "").trim();
    const description = (raw["Description"] ?? "").trim();
    const statusRaw = (raw["Status"] ?? "").trim();

    let hasError = false;
    const fail = (field: string, message: string) => {
      errors.push({ row: rowNumber, field, message });
      hasError = true;
    };

    if (!name) fail("Account Name", "Account name is required.");

    const type = typeRaw.toLowerCase() as GLAccount["type"];
    if (!typeRaw) {
      fail("Account Type", "Account type is required.");
    } else if (!(ACCOUNT_TYPES as readonly string[]).includes(type)) {
      fail("Account Type", `"${typeRaw}" is not one of Asset, Liability, Income, Expense.`);
    }

    let vNumber: string | null = null;
    if (vNumberRaw) {
      if (!V_NUMBER_RE.test(vNumberRaw)) {
        fail("V-Number", `"${vNumberRaw}" is not a valid V-number (expected format V0001).`);
      } else {
        vNumber = vNumberRaw.toUpperCase();
        if (seenInFile.has(vNumber)) {
          fail("V-Number", `Duplicate V-number "${vNumber}" within this file.`);
        }
        seenInFile.add(vNumber);
      }
    }

    let balance = 0;
    if (balanceRaw) {
      const parsed = Number(balanceRaw.replace(/,/g, ""));
      if (Number.isNaN(parsed)) {
        fail("Opening Balance", `"${balanceRaw}" is not a valid number.`);
      } else {
        balance = parsed;
      }
    }

    let status: GLAccountStatus = "active";
    if (statusRaw) {
      const normalized = statusRaw.toLowerCase();
      if (normalized !== "active" && normalized !== "inactive") {
        fail("Status", `"${statusRaw}" must be either Active or Inactive.`);
      } else {
        status = normalized;
      }
    }

    let parentAccountCode: string | null = null;
    if (parentRaw) {
      const parentUpper = parentRaw.toUpperCase();
      const existsInDb = existingByCode.has(parentUpper);
      const existsInFile = allCodesInFile.has(parentUpper);
      if (!existsInDb && !existsInFile) {
        fail(
          "Parent Account (V-Number)",
          `Parent account "${parentRaw}" was not found in existing accounts or elsewhere in this file.`
        );
      } else {
        parentAccountCode = parentUpper;
      }
    }

    const existing = vNumber ? existingByCode.get(vNumber) : undefined;
    if (existing) {
      if (mode === "add-only") {
        fail("V-Number", `Account "${vNumber}" already exists (import mode is "Add new accounts only").`);
      }
    }

    if (hasError) return;

    const plan: ImportRowPlan = {
      rowNumber,
      vNumber,
      action: existing ? "update" : "add",
      existingId: existing?.id,
      name,
      type,
      parent_group: category || null,
      parentAccountCode,
      opening_balance: balance,
      description: description || null,
      status,
    };

    if (plan.action === "update") toUpdate.push(plan);
    else toAdd.push(plan);
  });

  return { toAdd, toUpdate, errors };
}
