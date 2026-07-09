import type { ReactNode } from "react";

/*
  Native <details>/<summary> gives accessible, keyboard-operable progressive
  disclosure for free — no JS state needed. Used to group the Receipt Entry
  page into scannable sections instead of one long form.
*/
export function CollapsibleSection({
  title,
  subtitle,
  defaultOpen = true,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  defaultOpen?: boolean;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <details open={defaultOpen} className="group mb-4 rounded-xl border border-slate-200 bg-cream">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 select-none">
        <div className="flex items-center gap-2">
          <svg
            className="h-3.5 w-3.5 flex-none text-slate-400 transition-transform group-open:rotate-90"
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M7 5l6 5-6 5V5z" />
          </svg>
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-600">{title}</h3>
            {subtitle && <p className="mt-0.5 text-xs text-slate-400">{subtitle}</p>}
          </div>
        </div>
        {action && (
          <div className="flex-none" onClick={(e) => e.preventDefault()}>
            {action}
          </div>
        )}
      </summary>
      <div className="border-t border-slate-100 p-5 pt-4">{children}</div>
    </details>
  );
}
