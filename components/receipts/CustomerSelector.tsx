"use client";

import { forwardRef, useMemo, useState } from "react";
import type { Customer } from "@/lib/types";
import { FormField, inputClass } from "@/components/FormField";

export const CustomerSelector = forwardRef<
  HTMLInputElement,
  {
    customers: Customer[];
    value: Customer | null;
    onChange: (customer: Customer) => void;
    disabled?: boolean;
    error?: string;
  }
>(function CustomerSelector({ customers, value, onChange, disabled, error }, ref) {
  const [query, setQuery] = useState(value ? `${value.code} — ${value.name}` : "");
  const [open, setOpen] = useState(false);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return customers.slice(0, 8);
    return customers.filter((c) => c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q)).slice(0, 8);
  }, [query, customers]);

  function select(c: Customer) {
    onChange(c);
    setQuery(`${c.code} — ${c.name}`);
    setOpen(false);
  }

  return (
    <div className="relative">
      <FormField label="Customer">
        <input
          ref={ref}
          className={`${inputClass} ${error ? "border-red-400" : ""}`}
          value={disabled && value ? `${value.code} — ${value.name}` : query}
          disabled={disabled}
          placeholder="Search by name or code… (press / to focus)"
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          aria-invalid={!!error}
          role="combobox"
          aria-expanded={open}
        />
      </FormField>
      {error && <p className="mt-1 text-xs font-medium text-red-600">{error}</p>}
      {open && !disabled && (
        <div className="absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-slate-200 bg-cream shadow-lg">
          {matches.length === 0 ? (
            <p className="px-3 py-2 text-sm text-slate-400">No matching customers.</p>
          ) : (
            matches.map((c) => (
              <button
                key={c.id}
                type="button"
                onMouseDown={() => select(c)}
                className="block w-full px-3 py-2 text-left text-sm hover:bg-cream-dim"
              >
                <span className="font-medium text-slate-700">{c.code}</span>{" "}
                <span className="text-slate-500">— {c.name}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
});
