/*
  TypeScript shapes that mirror the database tables (see supabase/seed.sql).
  Keep these in sync as you build screens — they're your map of the backend.
*/

export interface Company {
  id: string;
  name: string;
  address: string | null;
  gstin: string | null;
  email: string | null;
  phone: string | null;
  pan: string | null;
  logo_url: string | null;
  bank_account_no: string | null;
  bank_name: string | null;
  bank_ifsc: string | null;
  bank_branch: string | null;
  terms_conditions: string | null;
}

export interface Customer {
  id: string;
  code: string;
  name: string;
  gstin: string | null;
  pan: string | null;
  contact_person: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  credit_limit: number;
  credit_days: number;
  opening_balance: number;
  created_at: string;
}

export interface GLAccount {
  id: string;
  code: string;
  name: string;
  type: "asset" | "liability" | "income" | "expense";
  parent_group: string | null;
}

export type InvoiceStatus = "open" | "partial" | "paid" | "overdue";

export interface Invoice {
  id: string;
  invoice_no: string;
  invoice_date: string;
  customer_id: string;
  due_date: string;
  subtotal: number;
  tax_amount: number;
  total: number;
  status: InvoiceStatus;
  notes: string | null;
  created_at: string;
  place_of_supply: string | null;
  reverse_charge: boolean;
  transporter_name: string | null;
  vehicle_no: string | null;
  transporter_doc_no: string | null;
  transporter_doc_date: string | null;
  eway_bill_no: string | null;
  eway_bill_date: string | null;
  irn: string | null;
  ack_no: string | null;
  ack_date: string | null;
  shipping_name: string | null;
  shipping_gstin: string | null;
  shipping_address: string | null;
  discount_total: number;
}

export interface InvoiceItem {
  id: string;
  invoice_id: string;
  description: string;
  qty: number;
  rate: number;
  amount: number;
  hsn_sac: string | null;
  unit: string | null;
  discount: number;
  tax_rate: number;
}

export type ReceiptMode = "cash" | "cheque" | "upi" | "neft";

export interface Receipt {
  id: string;
  receipt_no: string;
  receipt_date: string;
  customer_id: string;
  amount: number;
  mode: ReceiptMode;
  reference: string | null;
  created_at: string;
}

export interface ReceiptAllocation {
  id: string;
  receipt_id: string;
  invoice_id: string;
  amount: number;
}

export interface ReminderTemplate {
  id: string;
  name: string;
  subject: string;
  body: string;
}

export interface ReminderLog {
  id: string;
  invoice_id: string | null;
  to_email: string | null;
  subject: string | null;
  body: string | null;
  status: string;
  sent_at: string;
}
