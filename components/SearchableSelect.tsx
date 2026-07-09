"use client";

import { useMemo, useState } from "react";
import { inputClass } from "@/components/FormField";

export interface SearchableSelectOption {
  value: string;
  label: string;
}

/** A text input that filters a dropdown of options as you type — for pickers
 *  with too many options (e.g. 100+ GL accounts) for a plain <select>. */
export function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = "Search…",
  emptyLabel = "None",
}: {
  value: string;
  onChange: (value: string) => void;
  options: SearchableSelectOption[];
  placeholder?: string;
  emptyLabel?: string;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const selected = options.find((o) => o.value === value);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query]);

  return (
    <div className="relative">
      <input
        className={`${inputClass} w-full`}
        value={open ? query : selected?.label ?? ""}
        placeholder={placeholder}
        onFocus={() => {
          setOpen(true);
          setQuery("");
        }}
        onChange={(e) => setQuery(e.target.value)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && (
        <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-800">
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              onChange("");
              setOpen(false);
            }}
            className="block w-full px-3 py-2 text-left text-sm text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700"
          >
            {emptyLabel}
          </button>
          {filtered.length === 0 ? (
            <p className="px-3 py-2 text-sm text-slate-400">No matches.</p>
          ) : (
            filtered.map((o) => (
              <button
                key={o.value}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
                className={`block w-full px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-700 ${
                  o.value === value ? "bg-brand/10 font-medium text-brand" : "text-slate-700 dark:text-slate-200"
                }`}
              >
                {o.label}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
