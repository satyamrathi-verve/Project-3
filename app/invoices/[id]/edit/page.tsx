import { PageHeader } from "@/components/PageHeader";
import { InvoiceForm } from "@/components/InvoiceForm";

export default function EditInvoicePage({ params }: { params: { id: string } }) {
  return (
    <>
      <PageHeader title="Edit Sales Invoice" subtitle="Update the invoice and its line items." />
      <InvoiceForm invoiceId={params.id} />
    </>
  );
}
