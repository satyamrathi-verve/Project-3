-- ============================================================================
-- AR Manager — GL journal postings (double-entry for invoices & receipts)
-- Run ONCE in your Supabase project (SQL Editor → paste → Run), same as seed.sql.
-- Purely additive: a new table + two "add column if not exists" statements, so
-- it's safe even if supabase/migrations/002_gl_v_series.sql (which adds the same
-- two gl_accounts columns) runs before or after this one.
-- ============================================================================

alter table gl_accounts
  add column if not exists opening_balance numeric(14,2) not null default 0,
  add column if not exists current_balance numeric(14,2) not null default 0;

create table if not exists gl_journal_entries (
  id uuid primary key default gen_random_uuid(),
  entry_date date not null,
  reference_type text not null check (reference_type in ('invoice', 'receipt', 'opening_balance')),
  reference_id uuid not null,
  gl_account_id uuid not null references gl_accounts(id),
  debit numeric(14,2) not null default 0,
  credit numeric(14,2) not null default 0,
  description text,
  created_at timestamptz not null default now()
);

create index if not exists gl_journal_entries_reference_idx
  on gl_journal_entries (reference_type, reference_id);
create index if not exists gl_journal_entries_account_idx
  on gl_journal_entries (gl_account_id);

alter table gl_journal_entries enable row level security;
create policy anon_all on gl_journal_entries for all to anon, authenticated using (true) with check (true);
