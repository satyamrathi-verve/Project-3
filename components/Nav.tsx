"use client";

import { useLayoutEffect, useRef, useState } from "react";
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

  Auto-hide: the sidebar rests as a slim icon rail and expands on hover (a
  slim rail rather than sliding fully off-screen, so there's always a visible,
  reachable strip to hover back onto — hiding completely would mean the user
  has to remember an invisible edge to trigger it). "Pin open" overrides that
  and keeps it expanded regardless of hover, for anyone doing heavy in-app
  navigation who doesn't want it collapsing on them.
*/
const LINKS: { href: string; label: string; built: boolean }[] = [
  { href: "/", label: "Home", built: true },
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
  { href: "/dashboard", label: "Dashboard", built: true },
];

const HEADER_GRADIENT = `linear-gradient(135deg, ${hexToRgba(colorForIndex(0), 0.1)}, ${hexToRgba(
  colorForIndex(2),
  0.1
)}, ${hexToRgba(colorForIndex(4), 0.1)}, ${hexToRgba(colorForIndex(6), 0.1)})`;

const PIN_KEY = "ar-manager-nav-pinned";
const HOVER_COLLAPSE_DELAY_MS = 300;

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
  const [pinned, setPinned] = useState(false);
  const [hovering, setHovering] = useState(false);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const expanded = pinned || hovering;

  const listRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<(HTMLElement | null)[]>([]);
  const [indicator, setIndicator] = useState({ top: 0, height: 0, ready: false });

  useLayoutEffect(() => {
    const activeIndex = LINKS.findIndex((l) => l.href === pathname);
    const targetIndex = hoveredIndex ?? (activeIndex >= 0 ? activeIndex : null);
    const el = targetIndex !== null ? itemRefs.current[targetIndex] : null;
    if (el) {
      setIndicator({ top: el.offsetTop, height: el.offsetHeight, ready: true });
    } else {
      setIndicator((s) => ({ ...s, ready: false }));
    }
  }, [hoveredIndex, pathname, expanded]);

  function handleMouseEnter() {
    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
    setHovering(true);
  }

  function handleMouseLeave() {
    setHoveredIndex(null);
    hideTimer.current = setTimeout(() => setHovering(false), HOVER_COLLAPSE_DELAY_MS);
  }

  function handleSignOut() {
    clearSession();
    window.location.href = "/";
  }

  const activeIndex = LINKS.findIndex((l) => l.href === pathname);
  const indicatorIsActive = (hoveredIndex ?? activeIndex) === activeIndex && activeIndex >= 0;
  const indicatorAccent = colorForIndex(hoveredIndex ?? (activeIndex >= 0 ? activeIndex : 0));

  return (
    <nav
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={`no-print flex h-full flex-col border-r border-slate-200 bg-white transition-[width] duration-300 ease-out dark:border-slate-800 dark:bg-slate-900 ${
        expanded ? "w-60" : "w-16"
      }`}
    >
      <div className="flex-1 overflow-y-auto p-4">
        {!expanded ? (
          <p className="mb-4 px-2 text-sm font-bold text-brand">V</p>
        ) : (
          <div className="-mx-4 -mt-4 mb-4 px-6 pb-4 pt-5" style={{ background: HEADER_GRADIENT }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/brand/verve-logo.png"
              alt="Verve Advisory"
              className="h-16 w-auto dark:brightness-0 dark:invert"
            />
            <div className="mt-2">
              <AR360Logo className="h-9" />
            </div>
            <p className="mt-1 text-xs font-medium text-slate-500 dark:text-slate-400">(360° AR management)</p>
          </div>
        )}

        <div ref={listRef} className="relative flex flex-col gap-1">
          {/* Sliding highlight — glides to whichever row is hovered, or the
              active page when nothing's hovered. transform (not top) keeps
              the glide on the GPU-accelerated path. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 rounded-lg transition-all duration-300 ease-out"
            style={{
              transform: `translateY(${indicator.top}px)`,
              height: indicator.height,
              opacity: indicator.ready ? 1 : 0,
              backgroundColor: indicatorIsActive ? undefined : hexToRgba(indicatorAccent, 0.08),
            }}
          >
            {indicatorIsActive && <div className="h-full w-full rounded-lg bg-brand" />}
            <div
              className="absolute inset-y-0 left-0 w-[3px] rounded-l-lg transition-colors duration-300 ease-out"
              style={{ backgroundColor: indicatorAccent }}
            />
          </div>

          {LINKS.map((l, i) => {
            const active = pathname === l.href;
            if (!l.built) {
              return (
                <span
                  key={l.href}
                  ref={(el) => {
                    itemRefs.current[i] = el;
                  }}
                  title={l.label}
                  onMouseEnter={() => setHoveredIndex(i)}
                  className="relative z-10 flex items-center justify-between rounded-lg px-3 py-2 text-base text-slate-400 dark:text-slate-600"
                >
                  {!expanded ? initials(l.label) : l.label}
                  {expanded && (
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-400 dark:bg-slate-800 dark:text-slate-500">
                      build me
                    </span>
                  )}
                </span>
              );
            }
            return (
              <Link
                key={l.href}
                href={l.href}
                title={l.label}
                ref={(el) => {
                  itemRefs.current[i] = el;
                }}
                onMouseEnter={() => setHoveredIndex(i)}
                className={`relative z-10 rounded-lg px-3 py-2 text-base font-medium transition-colors duration-300 ${
                  active ? "text-white" : "text-slate-900 dark:text-slate-100"
                }`}
              >
                {!expanded ? initials(l.label) : l.label}
              </Link>
            );
          })}
        </div>
      </div>
      <div className="flex flex-none flex-col gap-2 border-t border-slate-200 p-4 dark:border-slate-800">
        <ThemeToggle collapsed={!expanded} />
        <button
          onClick={() => setPinned((p) => !p)}
          title={pinned ? "Unpin (auto-hide on mouse leave)" : "Pin sidebar open"}
          className={`flex w-full items-center rounded-lg px-3 py-2 text-sm font-medium hover:bg-slate-100 dark:hover:bg-slate-800 ${
            pinned ? "text-brand" : "text-slate-500 dark:text-slate-400"
          } ${!expanded ? "justify-center" : "gap-2"}`}
        >
          <span aria-hidden>📌</span>
          {expanded && (pinned ? "Pinned open" : "Pin open")}
        </button>
        <button
          onClick={handleSignOut}
          title="Sign out"
          className={`flex w-full items-center rounded-lg px-3 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800 ${
            !expanded ? "justify-center" : "gap-2"
          }`}
        >
          {!expanded ? "S" : "Sign out"}
        </button>
      </div>
    </nav>
  );
}
