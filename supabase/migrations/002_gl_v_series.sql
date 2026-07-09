-- ============================================================================
-- GL Master: V-series account numbering + import/export support fields
-- Run ONCE in Supabase → SQL Editor → New query → paste → Run.
-- (The anon key the app uses cannot run DDL, so this step is manual — same as
-- the original supabase/seed.sql.)
--
-- Purely additive: new nullable/defaulted columns on gl_accounts, one new small
-- sequence table, and one RPC function. Nothing existing is dropped, renamed,
-- or made non-nullable, so no existing data or app code breaks.
-- ============================================================================

alter table gl_accounts
  add column if not exists parent_account_id uuid references gl_accounts(id) on delete set null,
  add column if not exists opening_balance numeric(14,2) not null default 0,
  add column if not exists current_balance numeric(14,2) not null default 0,
  add column if not exists status text not null default 'active' check (status in ('active', 'inactive')),
  add column if not exists description text,
  add column if not exists created_at timestamptz not null default now();

-- ---------- V-number sequence (V0001, V0002, ... V9999) ---------------------
-- A dedicated one-row counter table (rather than a Postgres SEQUENCE) so the
-- RPC below can format "V" + zero-padded digits atomically in one round trip.
create table if not exists gl_account_sequence (
  id          boolean primary key default true,
  next_number int not null default 1,
  constraint single_row check (id)
);
insert into gl_account_sequence (id, next_number) values (true, 1) on conflict (id) do nothing;

-- RLS enabled with NO policies: anon/authenticated get no direct access to this
-- table. The only way to advance it is the security-definer RPC function below,
-- which runs as the table owner and so bypasses RLS.
alter table gl_account_sequence enable row level security;

-- Atomically reserves and returns the next V-number, e.g. 'V0001'. Doing this
-- as a single atomic UPDATE...RETURNING (rather than read-then-write from the
-- client) avoids two people at the event grabbing the same number at once.
create or replace function next_gl_account_number()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  update gl_account_sequence set next_number = next_number + 1
    where id = true
    returning next_number - 1 into n;
  return 'V' || lpad(n::text, 4, '0');
end;
$$;

grant execute on function next_gl_account_number() to anon, authenticated;
