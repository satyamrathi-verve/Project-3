"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { clearSession, type Session } from "@/lib/auth";
import { colorForIndex, hexToRgba } from "@/lib/colors";

/*
  Left sidebar. Only "Home" exists to start with — everything else is the roadmap
  your team builds. Each unbuilt screen shows a "build me" tag. When you finish a
  screen, flip its `built` to true (and point `href` at the route you created) so it
  turns into a real link.
*/
const LINKS: { href: string; label: string; built: boolean }[] = [
  { href: "/", label: "Home", built: true },
  { href: "/signin", label: "Sign In", built: true },
  { href: "/masters/customers", label: "Customer Master", built: true },
  { href: "/masters/gl", label: "GL Master", built: false },
  { href: "/invoices", label: "Sales Invoices", built: false },
  { href: "/receipts", label: "Receipt Entry", built: false },
  { href: "/upload", label: "Upload Report", built: true },
  { href: "/reminders", label: "AR Followup", built: false },
  { href: "/reports/statement", label: "Customer Statement", built: false },
  { href: "/reports/ageing", label: "AR Ageing", built: true },
  { href: "/cashflow", label: "Cashflow Projection", built: false },
  { href: "/dashboard", label: "Dashboard", built: true },
];

const HEADER_GRADIENT = `linear-gradient(135deg, ${hexToRgba(colorForIndex(0), 0.1)}, ${hexToRgba(
  colorForIndex(2),
  0.1
)}, ${hexToRgba(colorForIndex(4), 0.1)}, ${hexToRgba(colorForIndex(6), 0.1)})`;

export function Nav({ session }: { session: Session }) {
  const pathname = usePathname();

  return (
    <nav className="no-print flex h-full w-60 flex-col gap-1 border-r border-slate-200 bg-white p-4">
      <div className="-mx-4 -mt-4 mb-4 px-6 pb-4 pt-5" style={{ background: HEADER_GRADIENT }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/verve-logo.png" alt="Verve Advisory" className="h-12 w-auto" />
        <h1 className="mt-2 text-xl font-bold text-slate-900">AR Manager</h1>
      </div>
      {LINKS.map((l, i) => {
        const active = pathname === l.href;
        if (!l.built) {
          return (
            <span
              key={l.href}
              className="flex items-center justify-between rounded-lg px-3 py-2 text-base text-slate-400"
            >
              {l.label}
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-400">
                build me
              </span>
            </span>
          );
        }
        const accent = colorForIndex(i);
        return (
          <Link
            key={l.href}
            href={l.href}
            style={active ? undefined : { borderLeft: `3px solid ${accent}`, backgroundColor: hexToRgba(accent, 0.05) }}
            className={`rounded-lg px-3 py-2 text-base font-medium transition-colors ${
              active ? "bg-brand text-white" : "text-slate-900 hover:brightness-95"
            }`}
          >
            {l.label}
          </Link>
        );
      })}

      <div className="mt-auto border-t border-slate-200 pt-3">
        <p className="truncate px-2 text-base font-medium text-slate-700">{session.name}</p>
        <p className="truncate px-2 text-sm text-slate-400">{session.email}</p>
        <button
          type="button"
          onClick={() => {
            clearSession();
            window.location.href = "/";
          }}
          className="mt-2 w-full rounded-lg px-3 py-2 text-left text-base font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
        >
          Sign out
        </button>
      </div>
    </nav>
  );
}
