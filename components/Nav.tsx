"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { clearSession, type Session } from "@/lib/auth";
import { AR360Logo } from "@/components/AR360Logo";
import { FinanceIcon, ledgerGridPath, calculatorPath, invoicePath } from "@/components/decor/financeIcons";

/*
  Left sidebar. Only "Home" exists to start with — everything else is the roadmap
  your team builds. Each unbuilt screen shows a "build me" tag. When you finish a
  screen, flip its `built` to true (and point `href` at the route you created) so it
  turns into a real link.
*/
const LINKS: { href: string; label: string; built: boolean }[] = [
  { href: "/signin", label: "Sign In", built: true },
  { href: "/masters/customers", label: "Customer Master", built: true },
  { href: "/masters/gl", label: "GL Master", built: true },
  { href: "/invoices", label: "Sales Invoices", built: true },
  { href: "/invoices/new", label: "Punch Invoice", built: true },
  { href: "/receipts", label: "Receipt Entry", built: true },
  { href: "/upload", label: "Upload Report", built: true },
  { href: "/reminders", label: "Reminder Template", built: true },
  { href: "/reminders/auto-shoot", label: "Auto Email Shoot", built: true },
  { href: "/reports/statement", label: "Customer Statement", built: true },
  { href: "/reports/ageing", label: "AR Ageing", built: true },
  { href: "/cashflow", label: "Cashflow Projection", built: true },
];

export function Nav({ session }: { session: Session }) {
  const pathname = usePathname();

  function handleSignOut() {
    clearSession();
    window.location.href = "/";
  }

  return (
    <nav className="no-print relative flex h-full w-60 flex-col overflow-hidden bg-gradient-to-b from-chrome-light via-chrome to-chrome-dark">
      {/* Scattered finance-icon backdrop, echoing the Sign In screen */}
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <div className="absolute left-[8%] top-[30%] w-28 -rotate-6 text-white opacity-[0.07]">
          <FinanceIcon path={ledgerGridPath} className="h-auto w-full" />
        </div>
        <div className="absolute right-[-10%] top-[55%] w-32 rotate-6 text-white opacity-[0.06]">
          <FinanceIcon path={calculatorPath} className="h-auto w-full" />
        </div>
        <div className="absolute bottom-[6%] left-[-6%] w-24 rotate-3 text-white opacity-[0.07]">
          <FinanceIcon path={invoicePath} className="h-auto w-full" />
        </div>
      </div>

      <div className="nav-scroll relative z-10 flex-1 overflow-y-auto p-4">
        <div className="-mx-4 -mt-4 mb-4 px-6 pb-4 pt-5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/verve-logo.png" alt="Verve Advisory" className="h-16 w-auto brightness-0 invert" />
          <div className="mt-2">
            <AR360Logo className="h-9" invert="always" />
          </div>
          <p className="mt-1 text-xs font-medium text-white/70">(360° AR management)</p>
        </div>

        {/* Distinct CTA (not just a regular list link) so there's always a
            one-click way back to the Dashboard from anywhere in the app. */}
        <Link
          href="/dashboard"
          className="mb-3 flex items-center justify-center gap-2 rounded-lg bg-accent px-3 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-accent-dark"
        >
          <span aria-hidden>📊</span> Back to Dashboard
        </Link>

        <div className="flex flex-col gap-1">
          {LINKS.map((l) => {
            const active = pathname === l.href;
            if (!l.built) {
              return (
                <span
                  key={l.href}
                  title={l.label}
                  className="flex items-center justify-between rounded-lg px-3 py-2 text-base text-white/40"
                >
                  {l.label}
                  <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white/50">
                    build me
                  </span>
                </span>
              );
            }
            return (
              <Link
                key={l.href}
                href={l.href}
                title={l.label}
                className={`rounded-lg px-3 py-2 text-base font-medium transition-colors ${
                  active ? "bg-white/15 text-white" : "text-white/85 hover:bg-white/10"
                }`}
              >
                {l.label}
              </Link>
            );
          })}
          <button
            onClick={handleSignOut}
            title="Sign out"
            className="rounded-lg px-3 py-2 text-left text-base font-medium text-white/85 transition-colors hover:bg-white/10"
          >
            Sign out
          </button>
        </div>
      </div>
    </nav>
  );
}
