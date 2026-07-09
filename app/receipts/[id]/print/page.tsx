import { ReceiptPrint } from "@/components/ReceiptPrint";

export default function ReceiptPrintPage({ params }: { params: { id: string } }) {
  return <ReceiptPrint receiptId={params.id} />;
}
