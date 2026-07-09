// One-off backfill: posts GL journal entries for every invoice, receipt, and
// customer opening balance that already existed before the journal-posting
// engine (lib/glPosting.ts) went live, so GL Master's balances reflect the
// full transaction history, not just postings made from here on.
//
// This only writes rows through the existing Supabase client/tables (same
// anon key the app uses) — it does not create, alter, or drop anything.
// Requires supabase/migration_gl_journal.sql to have been run first.
//
// Safe to re-run: it skips any invoice/receipt/customer that already has a
// journal entry for it (checked by reference_type + reference_id).
//
// Usage:
//   node scripts/backfill-gl-journal.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

function loadEnvLocal() {
  const envPath = path.join(root, ".env.local");
  const text = fs.readFileSync(envPath, "utf8");
  const env = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    env[key] = value;
  }
  return env;
}

const env = loadEnvLocal();
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

const ACCOUNT_NAMES = {
  debtors: "Accounts Receivable",
  cash: "Cash on Hand",
  bank: "Main Bank Account",
  revenue: "Service Revenue",
  gstPayable: "GST/VAT Payable",
  retainedEarnings: "Retained Earnings",
};

async function getAccountId(name) {
  const { data, error } = await supabase.from("gl_accounts").select("id, type, current_balance").eq("name", name).maybeSingle();
  if (error) throw error;
  return data ?? null;
}

async function applyBalanceDelta(account, debit, credit) {
  const debitNormal = account.type === "asset" || account.type === "expense";
  const delta = debitNormal ? debit - credit : credit - debit;
  const next = Number(account.current_balance ?? 0) + delta;
  const { error } = await supabase.from("gl_accounts").update({ current_balance: next }).eq("id", account.id);
  if (error) throw error;
  account.current_balance = next; // keep the in-memory copy in sync across multiple lines in this run
}

async function postLine(entryDate, referenceType, referenceId, account, debit, credit, description) {
  const { error } = await supabase.from("gl_journal_entries").insert({
    entry_date: entryDate,
    reference_type: referenceType,
    reference_id: referenceId,
    gl_account_id: account.id,
    debit,
    credit,
    description,
  });
  if (error) throw error;
  await applyBalanceDelta(account, debit, credit);
}

async function alreadyPosted(referenceType, referenceId) {
  const { count, error } = await supabase
    .from("gl_journal_entries")
    .select("id", { count: "exact", head: true })
    .eq("reference_type", referenceType)
    .eq("reference_id", referenceId);
  if (error) throw error;
  return (count ?? 0) > 0;
}

async function main() {
  console.log("Looking up core GL accounts by name…");
  const [debtors, cash, bank, revenue, gstPayable, retainedEarnings] = await Promise.all([
    getAccountId(ACCOUNT_NAMES.debtors),
    getAccountId(ACCOUNT_NAMES.cash),
    getAccountId(ACCOUNT_NAMES.bank),
    getAccountId(ACCOUNT_NAMES.revenue),
    getAccountId(ACCOUNT_NAMES.gstPayable),
    getAccountId(ACCOUNT_NAMES.retainedEarnings),
  ]);
  for (const [label, acct] of Object.entries({ debtors, cash, bank, revenue, gstPayable, retainedEarnings })) {
    if (!acct) throw new Error(`GL account not found by name for "${label}" — check gl_accounts has been seeded.`);
  }
  console.log("  ✓ all core accounts found\n");

  // 1. Customer opening balances
  const { data: customers, error: custErr } = await supabase.from("customers").select("id, name, opening_balance, created_at");
  if (custErr) throw custErr;
  let openingPosted = 0;
  for (const c of customers ?? []) {
    if (!c.opening_balance || Number(c.opening_balance) === 0) continue;
    if (await alreadyPosted("opening_balance", c.id)) continue;
    const date = c.created_at.slice(0, 10);
    const desc = `Opening balance — ${c.name}`;
    await postLine(date, "opening_balance", c.id, debtors, Number(c.opening_balance), 0, desc);
    await postLine(date, "opening_balance", c.id, retainedEarnings, 0, Number(c.opening_balance), desc);
    openingPosted++;
  }
  console.log(`Opening balances posted: ${openingPosted}`);

  // 2. Invoices: Debtors (Dr) vs Revenue + GST Payable (Cr)
  const { data: invoices, error: invErr } = await supabase
    .from("invoices")
    .select("id, invoice_no, invoice_date, subtotal, tax_amount, total");
  if (invErr) throw invErr;
  let invoicesPosted = 0;
  for (const inv of invoices ?? []) {
    if (await alreadyPosted("invoice", inv.id)) continue;
    const desc = `Invoice ${inv.invoice_no}`;
    await postLine(inv.invoice_date, "invoice", inv.id, debtors, Number(inv.total), 0, desc);
    await postLine(inv.invoice_date, "invoice", inv.id, revenue, 0, Number(inv.subtotal), desc);
    if (Number(inv.tax_amount) > 0) {
      await postLine(inv.invoice_date, "invoice", inv.id, gstPayable, 0, Number(inv.tax_amount), desc);
    }
    invoicesPosted++;
  }
  console.log(`Invoices posted: ${invoicesPosted} of ${invoices?.length ?? 0}`);

  // 3. Receipts: Cash/Bank (Dr) vs Debtors (Cr)
  const { data: receipts, error: rcptErr } = await supabase
    .from("receipts")
    .select("id, receipt_no, receipt_date, amount, mode");
  if (rcptErr) throw rcptErr;
  let receiptsPosted = 0;
  for (const r of receipts ?? []) {
    if (await alreadyPosted("receipt", r.id)) continue;
    const debitAccount = r.mode === "cash" ? cash : bank;
    const desc = `Receipt ${r.receipt_no}`;
    await postLine(r.receipt_date, "receipt", r.id, debitAccount, Number(r.amount), 0, desc);
    await postLine(r.receipt_date, "receipt", r.id, debtors, 0, Number(r.amount), desc);
    receiptsPosted++;
  }
  console.log(`Receipts posted: ${receiptsPosted} of ${receipts?.length ?? 0}`);

  console.log("\nResulting balances:");
  for (const [label, acct] of Object.entries({ debtors, cash, bank, revenue, gstPayable, retainedEarnings })) {
    console.log(`  ${label}: ${acct.current_balance}`);
  }
}

main().catch((err) => {
  console.error("Backfill failed:", err.message ?? err);
  process.exit(1);
});
