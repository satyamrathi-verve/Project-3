import { PageHeader } from "@/components/PageHeader";
import { InvoiceForm } from "@/components/InvoiceForm";

export default function NewInvoicePage() {
  return (
    <>
      <PageHeader
        title="Punch a Sales Invoice"
        subtitle="Pick a customer, add line items, and the due date fills in from their credit terms."
      />
      <InvoiceForm />
    </>
  );
}
