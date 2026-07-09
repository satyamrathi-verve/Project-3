"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { clearSession, type Session } from "@/lib/auth";
import { colorForIndex, hexToRgba } from "@/lib/colors";
import { AR360Logo } from "@/components/AR360Logo";
import { ThemeToggle } from "@/components/ThemeToggle";

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
  { href: "/invoices", label: "Sales Invoices", built: true },
  { href: "/invoices/new", label: "Punch Invoice", built: true },
  { href: "/receipts", label: "Receipt Entry", built: true },
  { href: "/upload", label: "Upload Report", built: true },
  { href: "/reminders", label: "Reminder Template", built: true },
  { href: "/reminders/auto-shoot", label: "Auto Email Shoot", built: true },
  { href: "/reports/statement", label: "Customer Statement", built: true },
  { href: "/reports/ageing", label: "AR Ageing", built: true },
  { href: "/cashflow", label: "Cashflow Projection", built: true },
  { href: "/dashboard", label: "Dashboard", built: true },
];

const HEADER_GRADIENT = `linear-gradient(135deg, ${hexToRgba(colorForIndex(0), 0.1)}, ${hexToRgba(
  colorForIndex(2),
  0.1
)}, ${hexToRgba(colorForIndex(4), 0.1)}, ${hexToRgba(colorForIndex(6), 0.1)})`;

const COLLAPSE_KEY = "ar-manager-nav-collapsed";

function initials(label: string) {
  return label
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function Nav({ session }: { session: Session }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setCollapsed(localStorage.getItem(COLLAPSE_KEY) === "true");
  }, []);

  function toggleCollapsed() {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem(COLLAPSE_KEY, String(next));
  }

  function handleSignOut() {
    clearSession();
    window.location.href = "/";
  }

  return (
    <nav
      className={`no-print flex h-full flex-col border-r border-slate-200 bg-white transition-[width] dark:border-slate-800 dark:bg-slate-900 ${
        collapsed ? "w-16" : "w-60"
      }`}
    >
      <div className="flex-1 overflow-y-auto p-4">
        {collapsed ? (
          <p className="mb-4 px-2 text-sm font-bold text-brand">V</p>
        ) : (
          <div className="-mx-4 -mt-4 mb-4 px-6 pb-4 pt-5" style={{ background: HEADER_GRADIENT }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/verve-logo.png" alt="Verve Advisory" className="h-12 w-auto" />
            <div className="mt-2">
              <AR360Logo className="h-6" />
            </div>
            <p className="mt-1 text-xs font-medium text-slate-500 dark:text-slate-400">(360° AR management)</p>
          </div>
        )}
        <div className="flex flex-col gap-1">
          {LINKS.map((l, i) => {
            const active = pathname === l.href;
            if (!l.built) {
              return (
                <span
                  key={l.href}
                  title={l.label}
                  className="flex items-center justify-between rounded-lg px-3 py-2 text-base text-slate-400 dark:text-slate-600"
                >
                  {collapsed ? initials(l.label) : l.label}
                  {!collapsed && (
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-400 dark:bg-slate-800 dark:text-slate-500">
                      build me
                    </span>
                  )}
                </span>
              );
            }
            const accent = colorForIndex(i);
            return (
              <Link
                key={l.href}
                href={l.href}
                title={l.label}
                style={
                  active || collapsed
                    ? undefined
                    : { borderLeft: `3px solid ${accent}`, backgroundColor: hexToRgba(accent, 0.05) }
                }
                className={`rounded-lg px-3 py-2 text-base font-medium transition-colors ${
                  active
                    ? "bg-brand text-white"
                    : "text-slate-900 hover:brightness-95 dark:text-slate-100 dark:hover:brightness-125"
                }`}
              >
                {collapsed ? initials(l.label) : l.label}
              </Link>
            );
          })}
        </div>
      </div>
      <div className="flex flex-none flex-col gap-2 border-t border-slate-200 p-4 dark:border-slate-800">
        {!collapsed && (
          <div className="px-1 pb-1">
            <p className="truncate text-base font-medium text-slate-700 dark:text-slate-200">
              {session.name}
            </p>
            <p className="truncate text-sm text-slate-400 dark:text-slate-500">{session.email}</p>
          </div>
        )}
        <ThemeToggle collapsed={collapsed} />
        <button
          onClick={toggleCollapsed}
          title={collapsed ? "Expand" : "Collapse"}
          className={`flex w-full items-center rounded-lg px-3 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800 ${
            collapsed ? "justify-center" : "gap-2"
          }`}
        >
          <span aria-hidden>{collapsed ? "›" : "‹"}</span>
          {!collapsed && "Collapse"}
        </button>
        <button
          onClick={handleSignOut}
          title="Sign out"
          className={`flex w-full items-center rounded-lg px-3 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800 ${
            collapsed ? "justify-center" : "gap-2"
          }`}
        >
          {collapsed ? "S" : "Sign out"}
        </button>
      </div>
    </nav>
  );
}
