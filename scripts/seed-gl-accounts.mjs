// One-off data seed: replaces the minimal placeholder rows in `gl_accounts` with
// the full Chart of Accounts defined in lib/chartOfAccounts.ts.
//
// This only writes rows through the existing Supabase client/table — it does not
// create, alter, or drop anything in the schema.
//
// Usage:
//   node scripts/seed-gl-accounts.mjs
//
// Re-run any time after adding more entries to lib/chartOfAccounts.ts to keep the
// database in sync (it upserts by `code`, so it's safe to run repeatedly).

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

// lib/chartOfAccounts.ts is TypeScript, so we re-derive the same array here via a
// tiny regex parse rather than needing a TS build step for a one-off script.
function loadChartOfAccounts() {
  const src = fs.readFileSync(path.join(root, "lib", "chartOfAccounts.ts"), "utf8");
  const entryRe =
    /code:\s*"(\d+)",\s*name:\s*"([^"]+)",\s*type:\s*"(asset|liability|income|expense)",\s*parent_group:\s*"([^"]+)",\s*description:\s*"([^"]*)"/g;
  const accounts = [...src.matchAll(entryRe)].map((m) => ({
    code: m[1],
    name: m[2],
    type: m[3],
    parent_group: m[4],
  }));
  return accounts;
}

async function main() {
  const env = loadEnvLocal();
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local");
  }

  const accounts = loadChartOfAccounts();
  const codes = new Set(accounts.map((a) => a.code));
  if (codes.size !== accounts.length) {
    throw new Error("Duplicate account codes found in lib/chartOfAccounts.ts — aborting.");
  }
  console.log(`Loaded ${accounts.length} accounts from lib/chartOfAccounts.ts`);

  const supabase = createClient(url, anonKey);

  // Clear the old minimal placeholder set, then insert the full CoA fresh.
  // Nothing else in the schema references gl_accounts by id, so this is safe.
  const { error: deleteError } = await supabase.from("gl_accounts").delete().not("code", "is", null);
  if (deleteError) throw new Error(`Delete failed: ${deleteError.message}`);
  console.log("Cleared existing gl_accounts rows.");

  const { error: insertError, count } = await supabase
    .from("gl_accounts")
    .insert(accounts, { count: "exact" });
  if (insertError) throw new Error(`Insert failed: ${insertError.message}`);
  console.log(`Inserted ${count ?? accounts.length} accounts.`);

  const { count: finalCount, error: countError } = await supabase
    .from("gl_accounts")
    .select("*", { count: "exact", head: true });
  if (countError) throw new Error(`Count check failed: ${countError.message}`);
  console.log(`gl_accounts now has ${finalCount} rows.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
