import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AuthGate } from "@/components/auth/AuthGate";

const inter = Inter({ subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: "AR Manager — Verve",
  description: "Accounts Receivable manager",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <AuthGate>{children}</AuthGate>
      </body>
    </html>
  );
}
