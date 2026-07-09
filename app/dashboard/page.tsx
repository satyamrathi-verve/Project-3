import { supabase, isConfigured } from "@/lib/supabase";
import { PageHeader } from "@/components/PageHeader";
import { NotConfigured } from "@/components/NotConfigured";
import { DataTable, type Column } from "@/components/DataTable";
import type { Invoice, ReceiptAllocation } from "@/lib/types";

// Always fetch fresh — multiple teammates are punching test data concurrently.
export const dynamic = "force-dynamic";

interface InvoiceRow extends Invoice {
  customerName: string;
  outstanding: number;
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}

const STATUS_STYLES: Record<string, string> = {
  open: "bg-blue-50 text-blue-700",
  partial: "bg-amber-50 text-amber-700",
  paid: "bg-emerald-50 text-emerald-700",
  overdue: "bg-red-50 text-red-700",
};

async function loadDashboardData() {
  if (!supabase) return null;

  const [{ count: customerCount }, { data: customers }, { data: invoices }, { data: allocations }] =
    await Promise.all([
      supabase.from("customers").select("id", { count: "exact", head: true }),
      supabase.from("customers").select("id, name"),
      supabase.from("invoices").select("*").order("invoice_date", { ascending: false }),
      supabase.from("receipt_allocations").select("invoice_id, amount"),
    ]);

  const customerNameById = new Map((customers ?? []).map((c) => [c.id as string, c.name as string]));

  const allocatedByInvoice = new Map<string, number>();
  for (const a of (allocations ?? []) as ReceiptAllocation[]) {
    allocatedByInvoice.set(a.invoice_id, (allocatedByInvoice.get(a.invoice_id) ?? 0) + a.amount);
  }

  const today = new Date().toISOString().slice(0, 10);

  const invoiceRows: InvoiceRow[] = ((invoices ?? []) as Invoice[]).map((inv) => {
    const allocated = allocatedByInvoice.get(inv.id) ?? 0;
    return {
      ...inv,
      customerName: customerNameById.get(inv.customer_id) ?? "Unknown customer",
      outstanding: Math.max(0, inv.total - allocated),
    };
  });

  // Overdue = open/partial and past due date with something still owed —
  // same definition CLAUDE.md uses for the AR Ageing report.
  const overdueCount = invoiceRows.filter(
    (inv) => (inv.status === "open" || inv.status === "partial") && inv.due_date < today && inv.outstanding > 0
  ).length;

  const totalOutstanding = invoiceRows.reduce((sum, inv) => sum + inv.outstanding, 0);

  return {
    customerCount: customerCount ?? 0,
    invoiceCount: invoiceRows.length,
    overdueCount,
    totalOutstanding,
    recentInvoices: invoiceRows.slice(0, 8),
  };
}

function Tile({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-2 text-2xl font-bold text-slate-900 ${accent ?? ""}`}>{value}</p>
    </div>
  );
}

export default async function DashboardPage() {
  if (!isConfigured) {
    return (
      <>
        <PageHeader title="Dashboard" subtitle="The at-a-glance overview for the finance team." />
        <NotConfigured />
      </>
    );
  }

  const data = await loadDashboardData();

  const columns: Column<InvoiceRow>[] = [
    { key: "invoice_no", header: "Invoice #" },
    { key: "customerName", header: "Customer" },
    {
      key: "invoice_date",
      header: "Date",
      render: (row) => new Date(row.invoice_date).toLocaleDateString("en-IN"),
    },
    {
      key: "total",
      header: "Total",
      className: "text-right",
      render: (row) => formatCurrency(row.total),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => (
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${
            STATUS_STYLES[row.status] ?? "bg-slate-100 text-slate-600"
          }`}
        >
          {row.status}
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader title="Dashboard" subtitle="The at-a-glance overview for the finance team." />

      {!data ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-700">
          Couldn&apos;t load dashboard data. Check the Supabase connection and try again.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Tile label="Customers" value={data.customerCount.toLocaleString("en-IN")} />
            <Tile label="Invoices" value={data.invoiceCount.toLocaleString("en-IN")} />
            <Tile
              label="Overdue"
              value={data.overdueCount.toLocaleString("en-IN")}
              accent={data.overdueCount > 0 ? "text-red-600" : undefined}
            />
            <Tile label="Total Outstanding" value={formatCurrency(data.totalOutstanding)} accent="text-brand" />
          </div>

          <div className="mt-6">
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Recent Invoices</h3>
            <DataTable columns={columns} rows={data.recentInvoices} empty="No invoices yet." />
          </div>
        </>
      )}
    </>
  );
}
