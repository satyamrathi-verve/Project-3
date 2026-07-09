// One-off data migration: renumbers every existing gl_accounts row onto the new
// V0001-style sequence, backfills the new columns (opening_balance,
// current_balance, status, description, created_at) added by
// supabase/migrations/002_gl_v_series.sql, and links contra-asset accounts
// (e.g. "Accumulated Depreciation - Buildings") to their parent account via
// parent_account_id.
//
// PREREQUISITE: supabase/migrations/002_gl_v_series.sql must already have been
// run in the Supabase SQL Editor — this script cannot create columns/functions
// itself (the anon key it uses can only read/write rows, not run DDL).
//
// Usage:
//   node scripts/migrate-gl-v-series.mjs
//
// Safe to re-run: accounts already on a V-number are left as-is (matched by
// name against lib/chartOfAccounts.ts, or already V-numbered) so re-running
// after a partial failure won't double-renumber anything.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

function loadEnvLocal() {
  const text = fs.readFileSync(path.join(root, ".env.local"), "utf8");
  const env = {};
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
  }
  return env;
}

// Re-derive the CHART_OF_ACCOUNTS array from the TS source without a build
// step, same lightweight approach as scripts/seed-gl-accounts.mjs.
function loadChartOfAccounts() {
  const src = fs.readFileSync(path.join(root, "lib", "chartOfAccounts.ts"), "utf8");
  const entryRe =
    /\{ code: "(V\d{4})", name: "([^"]+)", type: "(asset|liability|income|expense)", parent_group: "([^"]+)", description: "((?:[^"\\]|\\.)*)"(?:, parentName: "([^"]+)")? \}/g;
  return [...src.matchAll(entryRe)].map((m) => ({
    code: m[1],
    name: m[2],
    type: m[3],
    parent_group: m[4],
    description: m[5].replace(/\\"/g, '"'),
    parentName: m[6] ?? null,
  }));
}

async function main() {
  const env = loadEnvLocal();
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error("Missing Supabase env vars in .env.local");

  const supabase = createClient(url, anonKey);
  const chart = loadChartOfAccounts();
  console.log(`Loaded ${chart.length} reference accounts from lib/chartOfAccounts.ts`);

  // Preflight: confirm the SQL migration has actually been run.
  const preflight = await supabase.from("gl_accounts").select("id,status,opening_balance").limit(1);
  if (preflight.error) {
    console.error("Preflight check failed:", preflight.error.message);
    console.error(
      "\nThis usually means supabase/migrations/002_gl_v_series.sql hasn't been run yet.\n" +
        "Open your Supabase project → SQL Editor → paste that file → Run, then re-run this script."
    );
    process.exit(1);
  }
  const rpcPreflight = await supabase.rpc("next_gl_account_number");
  if (rpcPreflight.error) {
    console.error("RPC preflight check failed:", rpcPreflight.error.message);
    console.error("The next_gl_account_number() function is missing — run the SQL migration first.");
    process.exit(1);
  }
  // We just consumed one V-number to test the RPC exists — note it, it's harmless
  // (V-numbers are identifiers, not required to be contiguous with zero gaps from
  // the start; "no reuse after deletion" is the actual invariant we guarantee).
  console.log(`RPC check OK (consumed ${rpcPreflight.data} as a smoke test).`);

  const { data: existing, error: fetchError } = await supabase.from("gl_accounts").select("*").order("code");
  if (fetchError) throw new Error(fetchError.message);
  console.log(`Found ${existing.length} existing accounts in the database.`);

  const alreadyMigrated = existing.filter((a) => /^V\d{4}$/.test(a.code));
  const toMigrate = existing.filter((a) => !/^V\d{4}$/.test(a.code));
  console.log(`${alreadyMigrated.length} already on a V-number, ${toMigrate.length} to migrate.`);

  // Match by name against the reference chart first (preserves the intended
  // order/description), then any leftover accounts (manually added by a team
  // member with a custom code) go last, ordered by their old code.
  const chartByName = new Map(chart.map((c) => [c.name, c]));
  const matched = toMigrate.filter((a) => chartByName.has(a.name));
  const unmatched = toMigrate.filter((a) => !chartByName.has(a.name)).sort((a, b) => a.code.localeCompare(b.code));

  matched.sort((a, b) => chart.findIndex((c) => c.name === a.name) - chart.findIndex((c) => c.name === b.name));

  const nameToNewId = new Map(alreadyMigrated.map((a) => [a.name, a.id])); // in case of a partial re-run
  const startTime = Date.now();
  let staggerMs = -(matched.length + unmatched.length) * 1000;

  for (const account of [...matched, ...unmatched]) {
    const ref = chartByName.get(account.name);
    const { data: newCode, error: rpcError } = await supabase.rpc("next_gl_account_number");
    if (rpcError) throw new Error(`RPC failed for "${account.name}": ${rpcError.message}`);

    const update = {
      code: newCode,
      status: "active",
      created_at: new Date(startTime + staggerMs).toISOString(),
      ...(ref ? { description: ref.description, opening_balance: 0, current_balance: 0 } : {}),
    };
    staggerMs += 1000;

    const { error: updateError } = await supabase.from("gl_accounts").update(update).eq("id", account.id);
    if (updateError) throw new Error(`Update failed for "${account.name}": ${updateError.message}`);

    nameToNewId.set(account.name, account.id);
    console.log(`  ${account.code} -> ${newCode}  ${account.name}`);
  }

  // Second pass: link contra-asset / sub accounts to their parent via parent_account_id.
  console.log("\nLinking parent accounts...");
  for (const entry of chart) {
    if (!entry.parentName) continue;
    const childId = nameToNewId.get(entry.name);
    const parentId = nameToNewId.get(entry.parentName);
    if (!childId || !parentId) {
      console.warn(`  Skipped link "${entry.name}" -> "${entry.parentName}" (one side not found).`);
      continue;
    }
    const { error } = await supabase.from("gl_accounts").update({ parent_account_id: parentId }).eq("id", childId);
    if (error) throw new Error(`Parent link failed for "${entry.name}": ${error.message}`);
    console.log(`  ${entry.name} -> parent: ${entry.parentName}`);
  }

  const { count, error: countError } = await supabase
    .from("gl_accounts")
    .select("*", { count: "exact", head: true });
  if (countError) throw new Error(countError.message);
  console.log(`\nDone. gl_accounts now has ${count} rows, all on the V-series.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
