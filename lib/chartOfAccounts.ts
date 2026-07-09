import type { GLAccount } from "@/lib/types";

/*
  The default Chart of Accounts for the AR Manager. This is the single source of
  truth for the standard ledger accounts: `scripts/seed-gl-accounts.mjs` (initial
  seed) and `scripts/migrate-gl-v-series.mjs` (V-series migration) both push this
  into the live `gl_accounts` table, and the GL Master screen's Add Account form
  reuses `PARENT_GROUPS` for suggestions.

  To add more accounts later, just add entries here (unique `code`) — new codes
  should follow the "V" + 4-digit zero-padded format, but in practice new
  accounts get their code auto-assigned by the `next_gl_account_number()` RPC
  (see supabase/migrations/002_gl_v_series.sql), not typed by hand.

  `gl_accounts.type` only allows asset | liability | income | expense, so Equity
  accounts (credit-normal, like liabilities) are stored as type "liability" and
  kept distinguishable via `parent_group: "Equity"`.

  `parentName`, when set, names another entry in this same list whose `code`
  should be used as this entry's `parent_account_id` during migration/seeding
  (e.g. a contra-asset account pointing back at the asset it offsets).
*/

export interface ChartOfAccountEntry extends Omit<GLAccount, "id" | "parent_account_id"> {
  description: string;
  /** Name of another entry in this list to link as parent_account_id, if any. */
  parentName?: string;
}

export const CHART_OF_ACCOUNTS: ChartOfAccountEntry[] = [
  // ---------------------------------------------------------------- ASSETS
  // -- Current Assets
  { code: "V0001", name: "Cash on Hand", type: "asset", parent_group: "Current Assets", description: "Physical cash held at business locations for day-to-day transactions." },
  { code: "V0002", name: "Petty Cash", type: "asset", parent_group: "Current Assets", description: "Small cash fund for minor incidental office expenses." },
  { code: "V0003", name: "Main Bank Account", type: "asset", parent_group: "Current Assets", description: "Primary operating bank account for receipts and payments." },
  { code: "V0004", name: "Savings Bank Account", type: "asset", parent_group: "Current Assets", description: "Interest-bearing bank account for surplus funds." },
  { code: "V0005", name: "Short-Term Investments", type: "asset", parent_group: "Current Assets", description: "Marketable securities and deposits maturing within a year." },
  { code: "V0006", name: "Accounts Receivable", type: "asset", parent_group: "Current Assets", description: "Amounts owed by customers for goods or services delivered on credit." },
  { code: "V0007", name: "Allowance for Doubtful Accounts", type: "asset", parent_group: "Current Assets", description: "Contra-asset reserve for receivables expected to be uncollectible.", parentName: "Accounts Receivable" },
  { code: "V0008", name: "Inventory", type: "asset", parent_group: "Current Assets", description: "Goods held for sale in the ordinary course of business." },
  { code: "V0009", name: "Raw Materials", type: "asset", parent_group: "Current Assets", description: "Unprocessed materials awaiting use in production." },
  { code: "V0010", name: "Work in Progress", type: "asset", parent_group: "Current Assets", description: "Partially completed goods still in the production process." },
  { code: "V0011", name: "Finished Goods", type: "asset", parent_group: "Current Assets", description: "Completed goods ready for sale." },
  { code: "V0012", name: "Prepaid Expenses", type: "asset", parent_group: "Current Assets", description: "Payments made in advance for goods or services not yet received." },
  { code: "V0013", name: "Employee Advances", type: "asset", parent_group: "Current Assets", description: "Salary or expense advances issued to employees, recoverable later." },
  { code: "V0014", name: "GST/VAT Receivable", type: "asset", parent_group: "Current Assets", description: "Input tax paid on purchases, recoverable from tax authorities." },
  { code: "V0015", name: "Input Tax Credit", type: "asset", parent_group: "Current Assets", description: "Credit for tax paid on inputs, usable to offset output tax liability." },
  { code: "V0016", name: "Advance Tax Paid", type: "asset", parent_group: "Current Assets", description: "Income tax paid in advance against the current year's liability." },

  // -- Fixed Assets
  { code: "V0017", name: "Land", type: "asset", parent_group: "Fixed Assets", description: "Cost of land owned by the business; not depreciated." },
  { code: "V0018", name: "Buildings", type: "asset", parent_group: "Fixed Assets", description: "Cost of owned office, factory, or warehouse buildings." },
  { code: "V0019", name: "Machinery", type: "asset", parent_group: "Fixed Assets", description: "Cost of production and operational machinery." },
  { code: "V0020", name: "Plant & Equipment", type: "asset", parent_group: "Fixed Assets", description: "Cost of plant and heavy equipment used in operations." },
  { code: "V0021", name: "Furniture & Fixtures", type: "asset", parent_group: "Fixed Assets", description: "Cost of office furniture, fittings, and fixtures." },
  { code: "V0022", name: "Computers", type: "asset", parent_group: "Fixed Assets", description: "Cost of desktops, laptops, and related IT hardware." },
  { code: "V0023", name: "Office Equipment", type: "asset", parent_group: "Fixed Assets", description: "Cost of general office equipment such as printers and scanners." },
  { code: "V0024", name: "Vehicles", type: "asset", parent_group: "Fixed Assets", description: "Cost of company-owned vehicles." },
  { code: "V0025", name: "Leasehold Improvements", type: "asset", parent_group: "Fixed Assets", description: "Cost of improvements made to leased premises." },
  { code: "V0026", name: "Intangible Assets", type: "asset", parent_group: "Fixed Assets", description: "Cost of non-physical assets such as software, patents, and licenses." },

  // -- Accumulated Depreciation (contra-asset, one per applicable fixed asset)
  { code: "V0027", name: "Accumulated Depreciation - Buildings", type: "asset", parent_group: "Accumulated Depreciation", description: "Contra-asset tracking accumulated depreciation on buildings.", parentName: "Buildings" },
  { code: "V0028", name: "Accumulated Depreciation - Machinery", type: "asset", parent_group: "Accumulated Depreciation", description: "Contra-asset tracking accumulated depreciation on machinery.", parentName: "Machinery" },
  { code: "V0029", name: "Accumulated Depreciation - Plant & Equipment", type: "asset", parent_group: "Accumulated Depreciation", description: "Contra-asset tracking accumulated depreciation on plant & equipment.", parentName: "Plant & Equipment" },
  { code: "V0030", name: "Accumulated Depreciation - Furniture & Fixtures", type: "asset", parent_group: "Accumulated Depreciation", description: "Contra-asset tracking accumulated depreciation on furniture & fixtures.", parentName: "Furniture & Fixtures" },
  { code: "V0031", name: "Accumulated Depreciation - Computers", type: "asset", parent_group: "Accumulated Depreciation", description: "Contra-asset tracking accumulated depreciation on computers.", parentName: "Computers" },
  { code: "V0032", name: "Accumulated Depreciation - Office Equipment", type: "asset", parent_group: "Accumulated Depreciation", description: "Contra-asset tracking accumulated depreciation on office equipment.", parentName: "Office Equipment" },
  { code: "V0033", name: "Accumulated Depreciation - Vehicles", type: "asset", parent_group: "Accumulated Depreciation", description: "Contra-asset tracking accumulated depreciation on vehicles.", parentName: "Vehicles" },
  { code: "V0034", name: "Accumulated Depreciation - Leasehold Improvements", type: "asset", parent_group: "Accumulated Depreciation", description: "Contra-asset tracking accumulated depreciation on leasehold improvements.", parentName: "Leasehold Improvements" },
  { code: "V0035", name: "Accumulated Amortization - Intangible Assets", type: "asset", parent_group: "Accumulated Depreciation", description: "Contra-asset tracking accumulated amortization on intangible assets.", parentName: "Intangible Assets" },

  // -------------------------------------------------------------------- LIABILITIES
  // -- Current Liabilities
  { code: "V0036", name: "Accounts Payable", type: "liability", parent_group: "Current Liabilities", description: "Amounts owed to suppliers for goods or services purchased on credit." },
  { code: "V0037", name: "Trade Creditors", type: "liability", parent_group: "Current Liabilities", description: "Short-term amounts owed to trade suppliers." },
  { code: "V0038", name: "Accrued Expenses", type: "liability", parent_group: "Current Liabilities", description: "Expenses incurred but not yet invoiced or paid." },
  { code: "V0039", name: "Salaries Payable", type: "liability", parent_group: "Current Liabilities", description: "Employee salaries earned but not yet paid." },
  { code: "V0040", name: "Payroll Taxes Payable", type: "liability", parent_group: "Current Liabilities", description: "Payroll taxes withheld or accrued, due to tax authorities." },
  { code: "V0041", name: "GST/VAT Payable", type: "liability", parent_group: "Current Liabilities", description: "Output tax collected from customers, payable to tax authorities." },
  { code: "V0042", name: "Sales Tax Payable", type: "liability", parent_group: "Current Liabilities", description: "Sales tax collected, due to tax authorities." },
  { code: "V0043", name: "Income Tax Payable", type: "liability", parent_group: "Current Liabilities", description: "Corporate income tax accrued and due within the year." },
  { code: "V0044", name: "Customer Deposits", type: "liability", parent_group: "Current Liabilities", description: "Advance deposits received from customers against future orders." },
  { code: "V0045", name: "Unearned Revenue", type: "liability", parent_group: "Current Liabilities", description: "Payments received in advance for goods or services not yet delivered." },
  { code: "V0046", name: "Short-Term Loans", type: "liability", parent_group: "Current Liabilities", description: "Loans and borrowings due for repayment within one year." },
  { code: "V0047", name: "Credit Card Payable", type: "liability", parent_group: "Current Liabilities", description: "Outstanding balance on company credit cards." },
  { code: "V0048", name: "Interest Payable", type: "liability", parent_group: "Current Liabilities", description: "Interest accrued but not yet paid on borrowings." },

  // -- Long-Term Liabilities
  { code: "V0049", name: "Bank Loans", type: "liability", parent_group: "Long-Term Liabilities", description: "Long-term borrowings from banks, repayable beyond one year." },
  { code: "V0050", name: "Lease Liabilities", type: "liability", parent_group: "Long-Term Liabilities", description: "Long-term obligations under finance or operating leases." },
  { code: "V0051", name: "Mortgage Payable", type: "liability", parent_group: "Long-Term Liabilities", description: "Long-term debt secured against owned property." },
  { code: "V0052", name: "Deferred Tax Liability", type: "liability", parent_group: "Long-Term Liabilities", description: "Income tax payable in future periods due to timing differences." },
  { code: "V0053", name: "Bonds Payable", type: "liability", parent_group: "Long-Term Liabilities", description: "Long-term debt securities issued by the business." },

  // -------------------------------------------------------------------------- EQUITY
  // Stored as type "liability" (credit-normal, like liabilities) — gl_accounts.type has
  // no "equity" option — but kept distinguishable via parent_group "Equity".
  { code: "V0054", name: "Owner's Capital", type: "liability", parent_group: "Equity", description: "Capital contributed by the business owner(s)." },
  { code: "V0055", name: "Share Capital", type: "liability", parent_group: "Equity", description: "Nominal value of shares issued to shareholders." },
  { code: "V0056", name: "Additional Paid-In Capital", type: "liability", parent_group: "Equity", description: "Amount received from shareholders in excess of share nominal value." },
  { code: "V0057", name: "Retained Earnings", type: "liability", parent_group: "Equity", description: "Cumulative profits retained in the business from prior years." },
  { code: "V0058", name: "Current Year Earnings", type: "liability", parent_group: "Equity", description: "Net profit or loss accumulated for the current financial year.", parentName: "Retained Earnings" },
  { code: "V0059", name: "Reserves & Surplus", type: "liability", parent_group: "Equity", description: "General reserves set aside from profits for future use." },
  { code: "V0060", name: "Drawings / Owner Withdrawals", type: "liability", parent_group: "Equity", description: "Cash or assets withdrawn by the owner for personal use." },

  // ------------------------------------------------------------------------- REVENUE
  { code: "V0061", name: "Product Sales", type: "income", parent_group: "Revenue", description: "Revenue from the sale of goods." },
  { code: "V0062", name: "Service Revenue", type: "income", parent_group: "Revenue", description: "Revenue from services rendered to customers." },
  { code: "V0063", name: "Subscription Revenue", type: "income", parent_group: "Revenue", description: "Recurring revenue from subscription-based offerings." },
  { code: "V0064", name: "Consulting Revenue", type: "income", parent_group: "Revenue", description: "Revenue from consulting and advisory engagements." },
  { code: "V0065", name: "Commission Income", type: "income", parent_group: "Revenue", description: "Income earned as commission on sales or referrals." },
  { code: "V0066", name: "Rental Income", type: "income", parent_group: "Revenue", description: "Income earned from renting out property or equipment." },
  { code: "V0067", name: "Interest Income", type: "income", parent_group: "Revenue", description: "Interest earned on bank deposits and investments." },
  { code: "V0068", name: "Dividend Income", type: "income", parent_group: "Revenue", description: "Dividends received from investments in other entities." },
  { code: "V0069", name: "Other Operating Revenue", type: "income", parent_group: "Revenue", description: "Operating revenue not classified elsewhere." },
  { code: "V0070", name: "Late Payment Fee Income", type: "income", parent_group: "Revenue", description: "Fees charged to customers for overdue payments." },

  // ---------------------------------------------------------------- COST OF GOODS SOLD
  { code: "V0071", name: "Material Cost", type: "expense", parent_group: "Cost of Goods Sold", description: "Cost of raw materials consumed in production." },
  { code: "V0072", name: "Direct Labour", type: "expense", parent_group: "Cost of Goods Sold", description: "Wages of labour directly involved in production." },
  { code: "V0073", name: "Manufacturing Overheads", type: "expense", parent_group: "Cost of Goods Sold", description: "Indirect production costs such as factory utilities and supervision." },
  { code: "V0074", name: "Freight In", type: "expense", parent_group: "Cost of Goods Sold", description: "Freight and shipping costs on incoming purchases." },
  { code: "V0075", name: "Purchase Discounts", type: "expense", parent_group: "Cost of Goods Sold", description: "Discounts received from suppliers, reducing cost of goods sold." },
  { code: "V0076", name: "Inventory Adjustments", type: "expense", parent_group: "Cost of Goods Sold", description: "Write-offs or adjustments for inventory shrinkage and damage." },
  { code: "V0077", name: "Import Duties", type: "expense", parent_group: "Cost of Goods Sold", description: "Customs duties and import charges on purchased materials." },

  // ------------------------------------------------------------------- OPERATING EXPENSES
  { code: "V0078", name: "Salaries & Wages", type: "expense", parent_group: "Operating Expenses", description: "Regular salaries and wages paid to employees." },
  { code: "V0079", name: "Bonus Expense", type: "expense", parent_group: "Operating Expenses", description: "Performance bonuses paid to employees." },
  { code: "V0080", name: "Employer Contributions", type: "expense", parent_group: "Operating Expenses", description: "Employer's share of statutory benefits such as provident fund." },
  { code: "V0081", name: "Rent", type: "expense", parent_group: "Operating Expenses", description: "Rent paid for office, warehouse, or retail premises." },
  { code: "V0082", name: "Utilities", type: "expense", parent_group: "Operating Expenses", description: "Electricity, water, and other utility expenses." },
  { code: "V0083", name: "Telephone", type: "expense", parent_group: "Operating Expenses", description: "Landline and mobile telephone expenses." },
  { code: "V0084", name: "Internet", type: "expense", parent_group: "Operating Expenses", description: "Internet connectivity expenses." },
  { code: "V0085", name: "Postage & Courier", type: "expense", parent_group: "Operating Expenses", description: "Postal and courier delivery charges." },
  { code: "V0086", name: "Office Supplies", type: "expense", parent_group: "Operating Expenses", description: "General consumable office supplies." },
  { code: "V0087", name: "Printing & Stationery", type: "expense", parent_group: "Operating Expenses", description: "Printing and stationery expenses." },
  { code: "V0088", name: "Repairs & Maintenance", type: "expense", parent_group: "Operating Expenses", description: "Upkeep and repair of office and equipment." },
  { code: "V0089", name: "Cleaning & Janitorial", type: "expense", parent_group: "Operating Expenses", description: "Cleaning services and janitorial supplies." },
  { code: "V0090", name: "Travel Expense", type: "expense", parent_group: "Operating Expenses", description: "Employee travel costs for business purposes." },
  { code: "V0091", name: "Meals & Entertainment", type: "expense", parent_group: "Operating Expenses", description: "Client and staff meals and entertainment expenses." },
  { code: "V0092", name: "Fuel Expense", type: "expense", parent_group: "Operating Expenses", description: "Fuel costs for company vehicles." },
  { code: "V0093", name: "Vehicle Expense", type: "expense", parent_group: "Operating Expenses", description: "Maintenance and running costs of company vehicles." },
  { code: "V0094", name: "Insurance", type: "expense", parent_group: "Operating Expenses", description: "Business insurance premiums." },
  { code: "V0095", name: "Professional Fees", type: "expense", parent_group: "Operating Expenses", description: "Fees paid to external professional service providers." },
  { code: "V0096", name: "Legal Fees", type: "expense", parent_group: "Operating Expenses", description: "Fees paid for legal services." },
  { code: "V0097", name: "Audit Fees", type: "expense", parent_group: "Operating Expenses", description: "Fees paid for statutory and internal audits." },
  { code: "V0098", name: "Bank Charges", type: "expense", parent_group: "Operating Expenses", description: "Bank service fees and transaction charges." },
  { code: "V0099", name: "Merchant Fees", type: "expense", parent_group: "Operating Expenses", description: "Payment gateway and card processing fees." },
  { code: "V0100", name: "Software Licenses", type: "expense", parent_group: "Operating Expenses", description: "Costs of licensed software used in operations." },
  { code: "V0101", name: "Cloud Services", type: "expense", parent_group: "Operating Expenses", description: "Cloud hosting and infrastructure costs." },
  { code: "V0102", name: "IT Expenses", type: "expense", parent_group: "Operating Expenses", description: "General information technology support and maintenance costs." },
  { code: "V0103", name: "Marketing", type: "expense", parent_group: "Operating Expenses", description: "General marketing expenses." },
  { code: "V0104", name: "Advertising", type: "expense", parent_group: "Operating Expenses", description: "Paid advertising and promotional campaigns." },
  { code: "V0105", name: "Training", type: "expense", parent_group: "Operating Expenses", description: "Employee training and development costs." },
  { code: "V0106", name: "Recruitment", type: "expense", parent_group: "Operating Expenses", description: "Costs of hiring and recruiting new employees." },
  { code: "V0107", name: "Employee Welfare", type: "expense", parent_group: "Operating Expenses", description: "Staff welfare and benefits expenses." },
  { code: "V0108", name: "Depreciation Expense", type: "expense", parent_group: "Operating Expenses", description: "Periodic depreciation charged on fixed assets." },
  { code: "V0109", name: "Amortization Expense", type: "expense", parent_group: "Operating Expenses", description: "Periodic amortization charged on intangible assets." },
  { code: "V0110", name: "Bad Debt Expense", type: "expense", parent_group: "Operating Expenses", description: "Receivables written off as uncollectible." },
  { code: "V0111", name: "Miscellaneous Expense", type: "expense", parent_group: "Operating Expenses", description: "Minor operating expenses not classified elsewhere." },

  // ------------------------------------------------------------------------- OTHER INCOME
  { code: "V0112", name: "Gain on Asset Sale", type: "income", parent_group: "Other Income", description: "Gain realized on the sale or disposal of fixed assets." },
  { code: "V0113", name: "Foreign Exchange Gain", type: "income", parent_group: "Other Income", description: "Gains from favorable foreign currency exchange rate movements." },
  { code: "V0114", name: "Miscellaneous Income", type: "income", parent_group: "Other Income", description: "Other non-operating income not classified elsewhere." },

  // ------------------------------------------------------------------------ OTHER EXPENSES
  { code: "V0115", name: "Interest Expense", type: "expense", parent_group: "Other Expenses", description: "Interest paid on loans and borrowings." },
  { code: "V0116", name: "Foreign Exchange Loss", type: "expense", parent_group: "Other Expenses", description: "Losses from unfavorable foreign currency exchange rate movements." },
  { code: "V0117", name: "Loss on Asset Disposal", type: "expense", parent_group: "Other Expenses", description: "Loss realized on the sale or disposal of fixed assets." },
  { code: "V0118", name: "Penalties & Fines", type: "expense", parent_group: "Other Expenses", description: "Penalties and fines paid to regulatory or tax authorities." },
  { code: "V0119", name: "Extraordinary Expenses", type: "expense", parent_group: "Other Expenses", description: "Non-recurring, unusual expenses outside normal operations." },
];

/** Ordered list of the standard parent groups, for the Add-account form's suggestions. */
export const PARENT_GROUPS = Array.from(new Set(CHART_OF_ACCOUNTS.map((a) => a.parent_group))) as string[];

/** code -> description lookup. Kept for any UI that wants a description before a
 *  live `description` column value has loaded, but the DB column is now the
 *  source of truth (see supabase/migrations/002_gl_v_series.sql). */
export const ACCOUNT_DESCRIPTIONS: Record<string, string> = Object.fromEntries(
  CHART_OF_ACCOUNTS.map((a) => [a.code, a.description])
);

/** Account types allowed by gl_accounts.type (DB check constraint). */
export const ACCOUNT_TYPES = ["asset", "liability", "income", "expense"] as const;

/**
 * The 8 "GL Group" labels used in the Add/Edit account forms — finer-grained
 * than gl_accounts.type (which only has 4 values), so each maps to a DB type
 * plus the parent_group values that belong under it. Category/Sub-category
 * dropdowns filter PARENT_GROUPS down to `categories` for the selected group.
 */
export interface GLGroupDef {
  label: string;
  type: GLAccount["type"];
  /** parent_group values offered once this GL Group is selected. */
  categories: string[];
}

export const GL_GROUPS: GLGroupDef[] = [
  { label: "Asset", type: "asset", categories: ["Current Assets", "Fixed Assets", "Accumulated Depreciation"] },
  { label: "Liability", type: "liability", categories: ["Current Liabilities", "Long-Term Liabilities"] },
  { label: "Equity", type: "liability", categories: ["Equity"] },
  { label: "Revenue", type: "income", categories: ["Revenue"] },
  { label: "COGS", type: "expense", categories: ["Cost of Goods Sold"] },
  { label: "Expense", type: "expense", categories: ["Operating Expenses"] },
  { label: "Other Income", type: "income", categories: ["Other Income"] },
  { label: "Other Expense", type: "expense", categories: ["Other Expenses"] },
];

/** Finds the GL Group whose type+categories match an account (for editing existing rows). */
export function glGroupForAccount(account: Pick<GLAccount, "type" | "parent_group">): GLGroupDef | undefined {
  return (
    GL_GROUPS.find((g) => g.type === account.type && g.categories.includes(account.parent_group ?? "")) ??
    GL_GROUPS.find((g) => g.type === account.type)
  );
}
