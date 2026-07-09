-- ============================================================================
-- AR Manager — GST tax-invoice fields (Print Preview template)
-- Run ONCE in your Supabase project (SQL Editor → paste → Run), same as seed.sql.
-- Purely additive: nullable/defaulted columns only, existing rows and queries
-- (including teammates' select("*")) keep working unchanged.
-- ============================================================================

alter table company
  add column if not exists pan               text,
  add column if not exists logo_url          text,
  add column if not exists bank_account_no   text,
  add column if not exists bank_name         text,
  add column if not exists bank_ifsc         text,
  add column if not exists bank_branch       text,
  add column if not exists terms_conditions  text;

alter table invoices
  add column if not exists place_of_supply     text,
  add column if not exists reverse_charge      boolean not null default false,
  add column if not exists transporter_name    text,
  add column if not exists vehicle_no          text,
  add column if not exists transporter_doc_no  text,
  add column if not exists transporter_doc_date date,
  add column if not exists eway_bill_no        text,
  add column if not exists eway_bill_date      date,
  add column if not exists irn                 text,
  add column if not exists ack_no              text,
  add column if not exists ack_date            date,
  add column if not exists shipping_name       text,
  add column if not exists shipping_gstin      text,
  add column if not exists shipping_address    text,
  add column if not exists discount_total      numeric(14,2) not null default 0;

alter table invoice_items
  add column if not exists hsn_sac  text,
  add column if not exists unit     text default 'Nos',
  add column if not exists discount numeric(14,2) not null default 0,
  add column if not exists tax_rate numeric(5,2) not null default 18;

update company set
  pan              = coalesce(pan, 'AAACV1234F'),
  bank_account_no  = coalesce(bank_account_no, '123456789012'),
  bank_name        = coalesce(bank_name, 'ICICI Bank'),
  bank_ifsc        = coalesce(bank_ifsc, 'ICIC0001234'),
  bank_branch      = coalesce(bank_branch, 'Pune Camp'),
  terms_conditions = coalesce(terms_conditions,
    'E & OE' || chr(10) ||
    'Goods once sold will not be taken back.' || chr(10) ||
    'Interest @ 18% p.a. will be charged if the payment is not made within the stipulated time.' || chr(10) ||
    'Subject to Pune jurisdiction only.');
