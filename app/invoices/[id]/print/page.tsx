import { InvoicePrint } from "@/components/InvoicePrint";

export default function InvoicePrintPage({ params }: { params: { id: string } }) {
  return <InvoicePrint invoiceId={params.id} />;
}
