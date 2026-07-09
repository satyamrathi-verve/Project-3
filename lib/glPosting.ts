import { supabase } from "@/lib/supabase";

/*
  Double-entry posting engine for gl_journal_entries (see
  supabase/migration_gl_journal.sql). Invoice creation posts Debtors (Dr) vs
  Revenue + GST Payable (Cr); a receipt posts Cash/Bank (Dr) vs Debtors (Cr) —
  the exact pattern the team's own AccountingPreview component already
  documents. gl_accounts.current_balance is kept as a running total updated
  alongside each journal line (no DB trigger — this app only has the anon
  key, which can't create one), rather than only computed at read time, per
  the "real ledger postings, stored running total" approach that was chosen.

  Account lookups are by NAME, not code, since the live gl_accounts codes and
  the newer "V####" codes in lib/chartOfAccounts.ts can differ depending on
  whether the V-series migration has been run — names are stable either way.
*/

const ACCOUNT_NAMES = {
  debtors: "Accounts Receivable",
  cash: "Cash on Hand",
  bank: "Main Bank Account",
  revenue: "Service Revenue",
  gstPayable: "GST/VAT Payable",
  retainedEarnings: "Retained Earnings",
} as const;

const accountIdCache = new Map<string, string | null>();

async function getAccountId(name: string): Promise<string | null> {
  if (accountIdCache.has(name)) return accountIdCache.get(name) ?? null;
  const { data } = await supabase!.from("gl_accounts").select("id").eq("name", name).maybeSingle();
  const id = data?.id ?? null;
  accountIdCache.set(name, id);
  return id;
}

/** Signed balance movement for one line, per the account's normal-balance side. */
async function applyBalanceDelta(accountId: string, debit: number, credit: number) {
  const { data: acct } = await supabase!
    .from("gl_accounts")
    .select("type, current_balance")
    .eq("id", accountId)
    .single();
  if (!acct) return;
  const debitNormal = acct.type === "asset" || acct.type === "expense";
  const delta = debitNormal ? debit - credit : credit - debit;
  await supabase!
    .from("gl_accounts")
    .update({ current_balance: Number(acct.current_balance ?? 0) + delta })
    .eq("id", accountId);
}

async function postLine(
  entryDate: string,
  referenceType: "invoice" | "receipt" | "opening_balance",
  referenceId: string,
  accountId: string,
  debit: number,
  credit: number,
  description: string
) {
  await supabase!.from("gl_journal_entries").insert({
    entry_date: entryDate,
    reference_type: referenceType,
    reference_id: referenceId,
    gl_account_id: accountId,
    debit,
    credit,
    description,
  });
  await applyBalanceDelta(accountId, debit, credit);
}

/** Undoes a previous posting (reverses each line's balance effect, then deletes the rows) — used before re-posting an edited invoice/receipt. */
export async function reverseJournalFor(referenceType: "invoice" | "receipt" | "opening_balance", referenceId: string) {
  if (!supabase) return;
  const { data: lines } = await supabase
    .from("gl_journal_entries")
    .select("gl_account_id, debit, credit")
    .eq("reference_type", referenceType)
    .eq("reference_id", referenceId);

  for (const line of lines ?? []) {
    await applyBalanceDelta(line.gl_account_id, Number(line.credit), Number(line.debit)); // swapped = reversal
  }
  await supabase.from("gl_journal_entries").delete().eq("reference_type", referenceType).eq("reference_id", referenceId);
}

export async function postInvoiceJournal(invoice: {
  id: string;
  invoice_no: string;
  invoice_date: string;
  subtotal: number;
  tax_amount: number;
  total: number;
}) {
  if (!supabase) return;
  const [debtorsId, revenueId, gstId] = await Promise.all([
    getAccountId(ACCOUNT_NAMES.debtors),
    getAccountId(ACCOUNT_NAMES.revenue),
    getAccountId(ACCOUNT_NAMES.gstPayable),
  ]);
  if (!debtorsId || !revenueId) return; // core accounts missing — skip rather than post a lopsided entry

  const desc = `Invoice ${invoice.invoice_no}`;
  await postLine(invoice.invoice_date, "invoice", invoice.id, debtorsId, invoice.total, 0, desc);
  await postLine(invoice.invoice_date, "invoice", invoice.id, revenueId, 0, invoice.subtotal, desc);
  if (invoice.tax_amount > 0 && gstId) {
    await postLine(invoice.invoice_date, "invoice", invoice.id, gstId, 0, invoice.tax_amount, desc);
  }
}

export async function postReceiptJournal(receipt: {
  id: string;
  receipt_no: string;
  receipt_date: string;
  amount: number;
  mode: string;
}) {
  if (!supabase) return;
  const [debtorsId, cashId, bankId] = await Promise.all([
    getAccountId(ACCOUNT_NAMES.debtors),
    getAccountId(ACCOUNT_NAMES.cash),
    getAccountId(ACCOUNT_NAMES.bank),
  ]);
  const debitAccountId = receipt.mode === "cash" ? cashId : bankId;
  if (!debtorsId || !debitAccountId) return;

  const desc = `Receipt ${receipt.receipt_no}`;
  await postLine(receipt.receipt_date, "receipt", receipt.id, debitAccountId, receipt.amount, 0, desc);
  await postLine(receipt.receipt_date, "receipt", receipt.id, debtorsId, 0, receipt.amount, desc);
}

export async function postCustomerOpeningBalanceJournal(customer: {
  id: string;
  name: string;
  opening_balance: number;
  created_at: string;
}) {
  if (!supabase || !customer.opening_balance) return;
  const [debtorsId, retainedId] = await Promise.all([
    getAccountId(ACCOUNT_NAMES.debtors),
    getAccountId(ACCOUNT_NAMES.retainedEarnings),
  ]);
  if (!debtorsId || !retainedId) return;

  const date = customer.created_at.slice(0, 10);
  const desc = `Opening balance — ${customer.name}`;
  await postLine(date, "opening_balance", customer.id, debtorsId, customer.opening_balance, 0, desc);
  await postLine(date, "opening_balance", customer.id, retainedId, 0, customer.opening_balance, desc);
}
