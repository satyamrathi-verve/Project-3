"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase, isConfigured } from "@/lib/supabase";
import { PageHeader } from "@/components/PageHeader";
import { NotConfigured } from "@/components/NotConfigured";
import { inputClass } from "@/components/FormField";
import {
  fillPlaceholders,
  formatDate,
  daysOverdue,
  formatCurrency,
  ageingBucket,
  AGEING_BUCKET_STYLES,
  AGEING_BUCKET_ORDER,
  BUCKET_TEMPLATE_NAME,
  type AgeingBucket,
} from "@/lib/reminderUtils";
import type { ReminderTemplate } from "@/lib/types";

const PLACEHOLDERS = [
  "{customer}",
  "{amount}",
  "{days_overdue}",
  "{invoice_no}",
  "{invoice_date}",
  "{due_date}",
  "{company_name}",
  "{payment_link}",
];

interface InvoiceOption {
  id: string;
  invoice_no: string;
  invoice_date: string;
  due_date: string;
  total: number;
  customer_id: string;
  customer_name: string;
  customer_email: string | null;
}

const SAMPLE_FALLBACK = {
  customer: "Sterling Textiles Pvt Ltd",
  amount: "₹24,500",
  days_overdue: "18",
  invoice_no: "INV-10025",
  invoice_date: "08 Jun 2026",
  due_date: "08 Jul 2026",
  payment_link: "https://pay.example.com/inv-10025",
};

type Mode = "edit" | "preview";

export default function ReminderTemplatePage() {
  const [templates, setTemplates] = useState<ReminderTemplate[]>([]);
  const [activeBucket, setActiveBucket] = useState<AgeingBucket>("0-30");
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [initial, setInitial] = useState({ subject: "", body: "" });
  const [companyName, setCompanyName] = useState("Verve Advisory");
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<Mode>("edit");
  const [sending, setSending] = useState(false);
  const [sentMessage, setSentMessage] = useState<string | null>(null);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  const [invoiceOptions, setInvoiceOptions] = useState<InvoiceOption[]>([]);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string>("");
  const [liveSample, setLiveSample] = useState<Record<string, string> | null>(null);
  const [fetchingInvoice, setFetchingInvoice] = useState(false);

  const [invoiceQuery, setInvoiceQuery] = useState("");
  const [showInvoiceDropdown, setShowInvoiceDropdown] = useState(false);

  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const lastFocused = useRef<"subject" | "body">("body");

  useEffect(() => {
    if (!isConfigured || !supabase) {
      setLoading(false);
      return;
    }
    Promise.all([
      supabase.from("reminder_templates").select("*").order("name"),
      supabase.from("company").select("name").limit(1).maybeSingle(),
      supabase
        .from("invoices")
        .select("id, invoice_no, invoice_date, due_date, total, customer_id, customers(name, email)")
        .in("status", ["open", "partial", "overdue"])
        .order("due_date"),
    ]).then(([{ data: fetchedTemplates }, { data: company }, { data: invoices }]) => {
      const rows = (fetchedTemplates as ReminderTemplate[] | null) ?? [];
      setTemplates(rows);
      const defaultRow = rows.find((t) => t.name === BUCKET_TEMPLATE_NAME["0-30"]) ?? rows[0];
      if (defaultRow) {
        setActiveBucket("0-30");
        setTemplateId(defaultRow.id);
        setSubject(defaultRow.subject);
        setBody(defaultRow.body);
        setInitial({ subject: defaultRow.subject, body: defaultRow.body });
      }
      if (company?.name) setCompanyName(company.name);
      if (invoices) {
        setInvoiceOptions(
          invoices.map((inv: any) => ({
            id: inv.id,
            invoice_no: inv.invoice_no,
            invoice_date: inv.invoice_date,
            due_date: inv.due_date,
            total: inv.total,
            customer_id: inv.customer_id,
            customer_name: inv.customers?.name ?? "Unknown customer",
            customer_email: inv.customers?.email ?? null,
          }))
        );
      }
      setLoading(false);
    });
  }, []);

  const selectedInvoice = invoiceOptions.find((i) => i.id === selectedInvoiceId) ?? null;

  function selectBucket(bucket: AgeingBucket) {
    const row = templates.find((t) => t.name === BUCKET_TEMPLATE_NAME[bucket]);
    if (!row) return;
    setActiveBucket(bucket);
    setTemplateId(row.id);
    setSubject(row.subject);
    setBody(row.body);
    setInitial({ subject: row.subject, body: row.body });
    setSavedMessage(null);
  }

  useEffect(() => {
    if (!selectedInvoice || !supabase) {
      setLiveSample(null);
      return;
    }
    selectBucket(ageingBucket(daysOverdue(selectedInvoice.due_date)));
    setFetchingInvoice(true);
    supabase
      .from("receipt_allocations")
      .select("amount")
      .eq("invoice_id", selectedInvoice.id)
      .then(({ data: allocations }) => {
        const allocated = (allocations ?? []).reduce((sum, a) => sum + Number(a.amount), 0);
        const outstanding = Number(selectedInvoice.total) - allocated;
        setLiveSample({
          customer: selectedInvoice.customer_name,
          amount: formatCurrency(outstanding),
          days_overdue: String(daysOverdue(selectedInvoice.due_date)),
          invoice_no: selectedInvoice.invoice_no,
          invoice_date: formatDate(selectedInvoice.invoice_date),
          due_date: formatDate(selectedInvoice.due_date),
          payment_link: `https://pay.example.com/${selectedInvoice.invoice_no.toLowerCase()}`,
        });
        setFetchingInvoice(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedInvoice]);

  const sample = useMemo(
    () => ({ ...(liveSample ?? SAMPLE_FALLBACK), company_name: companyName }),
    [liveSample, companyName]
  );

  const filteredInvoices = useMemo(() => {
    const q = invoiceQuery.trim().toLowerCase();
    if (!q || selectedInvoiceId) return invoiceOptions;
    return invoiceOptions.filter(
      (inv) =>
        inv.invoice_no.toLowerCase().includes(q) || inv.customer_name.toLowerCase().includes(q)
    );
  }, [invoiceQuery, invoiceOptions, selectedInvoiceId]);

  const preview = {
    subject: fillPlaceholders(subject, sample),
    body: fillPlaceholders(body, sample),
  };

  function insertPlaceholder(token: string) {
    setMode("edit");
    if (lastFocused.current === "subject" && subjectRef.current) {
      const el = subjectRef.current;
      const start = el.selectionStart ?? subject.length;
      const end = el.selectionEnd ?? subject.length;
      const next = subject.slice(0, start) + token + subject.slice(end);
      setSubject(next);
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(start + token.length, start + token.length);
      });
    } else if (bodyRef.current) {
      const el = bodyRef.current;
      const start = el.selectionStart ?? body.length;
      const end = el.selectionEnd ?? body.length;
      const next = body.slice(0, start) + token + body.slice(end);
      setBody(next);
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(start + token.length, start + token.length);
      });
    }
  }

  function wrapBodySelection(before: string, after: string = before) {
    const el = bodyRef.current;
    if (!el) return;
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? body.length;
    const selected = body.slice(start, end) || "text";
    const next = body.slice(0, start) + before + selected + after + body.slice(end);
    setBody(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + before.length, start + before.length + selected.length);
    });
  }

  function applyLinePrefix(kind: "bullet" | "numbered") {
    const el = bodyRef.current;
    if (!el) return;
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;
    const lineStart = body.lastIndexOf("\n", start - 1) + 1;
    const lineEndIdx = body.indexOf("\n", end);
    const lineEnd = lineEndIdx === -1 ? body.length : lineEndIdx;
    const block = body.slice(lineStart, lineEnd);
    const lines = block.split("\n");
    const prefixed = lines
      .map((line, i) => (kind === "bullet" ? `• ${line}` : `${i + 1}. ${line}`))
      .join("\n");
    const next = body.slice(0, lineStart) + prefixed + body.slice(lineEnd);
    setBody(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(lineStart, lineStart + prefixed.length);
    });
  }

  function applyLink() {
    const el = bodyRef.current;
    if (!el) return;
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? body.length;
    const selected = body.slice(start, end) || "link text";
    const url = window.prompt("Link URL", "https://");
    if (!url) return;
    const inserted = `[${selected}](${url})`;
    const next = body.slice(0, start) + inserted + body.slice(end);
    setBody(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + inserted.length, start + inserted.length);
    });
  }

  function applyUndo() {
    bodyRef.current?.focus();
    document.execCommand("undo");
  }

  function applyRedo() {
    bodyRef.current?.focus();
    document.execCommand("redo");
  }

  async function handleSaveTemplate() {
    if (!supabase || !templateId || mode !== "edit") return;
    setSavingTemplate(true);
    setSavedMessage(null);
    const { error } = await supabase
      .from("reminder_templates")
      .update({ subject, body })
      .eq("id", templateId);
    setSavingTemplate(false);
    if (!error) {
      setInitial({ subject, body });
      setSavedMessage("Template saved.");
    }
  }

  async function handleSend() {
    if (!supabase || !templateId || !selectedInvoice || !selectedInvoice.customer_email) return;
    setSending(true);
    setSentMessage(null);
    await supabase.from("reminder_templates").update({ subject, body }).eq("id", templateId);
    const { error } = await supabase.from("reminder_log").insert({
      invoice_id: selectedInvoice.id,
      to_email: selectedInvoice.customer_email,
      subject: preview.subject,
      body: preview.body,
      status: "sent",
      sent_at: new Date().toISOString(),
    });
    setSending(false);
    if (!error) {
      setInitial({ subject, body });
      setMode("preview");
      setSentMessage(`Sent to ${selectedInvoice.customer_email}.`);
    }
  }

  const sendDisabled = sending || !templateId || !selectedInvoice || !selectedInvoice.customer_email;

  if (!isConfigured) {
    return (
      <>
        <PageHeader
          title="Reminder Template"
          subtitle="Configure the reminder email sent during AR follow-ups."
        />
        <NotConfigured />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Reminder Template"
        subtitle="Configure the reminder email sent during AR follow-ups."
      />

      {loading ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">Loading template…</p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-cream p-6 dark:border-slate-800 dark:bg-slate-900 lg:col-span-2">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                  Email template
                </h3>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  Create a professional reminder message for overdue invoices.
                </p>
              </div>
              <div className="flex flex-none items-center gap-2">
                <button
                  onClick={() => setMode("edit")}
                  className={
                    mode === "edit"
                      ? "rounded-lg border border-brand bg-brand/10 px-4 py-2 text-sm font-medium text-brand-dark dark:border-brand dark:bg-brand/20 dark:text-blue-300"
                      : "rounded-lg border border-slate-300 bg-cream px-4 py-2 text-sm font-medium text-slate-700 hover:bg-cream-dim dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                  }
                >
                  Edit Template
                </button>
                <button
                  onClick={() => {
                    setMode("preview");
                    setSavedMessage(null);
                  }}
                  className={
                    mode === "preview"
                      ? "rounded-lg border border-accent bg-accent/20 px-4 py-2 text-sm font-medium text-accent-dark dark:border-accent dark:bg-accent/30 dark:text-accent"
                      : "rounded-lg border border-accent/40 bg-accent/10 px-4 py-2 text-sm font-medium text-accent-dark hover:bg-accent/20 dark:border-accent/50 dark:bg-accent/20 dark:text-accent"
                  }
                >
                  Preview
                </button>
                <button
                  onClick={handleSend}
                  disabled={sendDisabled}
                  className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50"
                >
                  {sending ? "Sending…" : "Send"}
                </button>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {AGEING_BUCKET_ORDER.map((bucket) => {
                const styles = AGEING_BUCKET_STYLES[bucket];
                const active = bucket === activeBucket;
                const available = templates.some((t) => t.name === BUCKET_TEMPLATE_NAME[bucket]);
                return (
                  <button
                    key={bucket}
                    type="button"
                    disabled={!available}
                    onClick={() => selectBucket(bucket)}
                    className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40 ${
                      active
                        ? styles.badge
                        : "bg-slate-100 text-slate-500 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700"
                    }`}
                  >
                    <span className={`h-2 w-2 rounded-full ${styles.dot}`} />
                    {styles.label} overdue
                  </button>
                );
              })}
            </div>

            {mode === "edit" ? (
              <div className="mt-6 flex flex-col gap-4">
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Email subject
                  </span>
                  <input
                    ref={subjectRef}
                    className={inputClass}
                    value={subject}
                    onFocus={() => (lastFocused.current = "subject")}
                    onChange={(e) => setSubject(e.target.value)}
                  />
                </label>

                <div className="flex flex-col gap-1">
                  <span className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Email body
                  </span>
                  <div className="overflow-hidden rounded-lg border border-slate-300 dark:border-slate-700">
                    <div className="flex flex-wrap items-center gap-1 border-b border-slate-200 bg-cream-dim p-1.5 dark:border-slate-700 dark:bg-slate-800">
                      <button
                        type="button"
                        title="Bold"
                        onClick={() => wrapBodySelection("**")}
                        className="flex h-7 w-7 items-center justify-center rounded font-bold text-slate-600 hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-slate-700"
                      >
                        B
                      </button>
                      <button
                        type="button"
                        title="Italic"
                        onClick={() => wrapBodySelection("*")}
                        className="flex h-7 w-7 items-center justify-center rounded italic text-slate-600 hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-slate-700"
                      >
                        I
                      </button>
                      <button
                        type="button"
                        title="Underline"
                        onClick={() => wrapBodySelection("__")}
                        className="flex h-7 w-7 items-center justify-center rounded text-slate-600 underline hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-slate-700"
                      >
                        U
                      </button>
                      <span className="mx-1 h-5 w-px bg-slate-300 dark:bg-slate-600" />
                      <button
                        type="button"
                        title="Bullet list"
                        onClick={() => applyLinePrefix("bullet")}
                        className="flex h-7 w-7 items-center justify-center rounded text-slate-600 hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-slate-700"
                      >
                        ☰
                      </button>
                      <button
                        type="button"
                        title="Numbered list"
                        onClick={() => applyLinePrefix("numbered")}
                        className="flex h-7 w-7 items-center justify-center rounded text-xs font-semibold text-slate-600 hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-slate-700"
                      >
                        1.
                      </button>
                      <button
                        type="button"
                        title="Insert link"
                        onClick={applyLink}
                        className="flex h-7 items-center justify-center rounded px-2 text-[10px] font-semibold uppercase tracking-wide text-slate-600 hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-slate-700"
                      >
                        Link
                      </button>
                      <span className="mx-1 h-5 w-px bg-slate-300 dark:bg-slate-600" />
                      <button
                        type="button"
                        title="Undo"
                        onClick={applyUndo}
                        className="flex h-7 w-7 items-center justify-center rounded text-slate-600 hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-slate-700"
                      >
                        ↶
                      </button>
                      <button
                        type="button"
                        title="Redo"
                        onClick={applyRedo}
                        className="flex h-7 w-7 items-center justify-center rounded text-slate-600 hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-slate-700"
                      >
                        ↷
                      </button>
                    </div>
                    <textarea
                      ref={bodyRef}
                      className="min-h-[380px] w-full bg-cream px-3 py-2 text-sm leading-relaxed text-slate-800 outline-none dark:bg-slate-800 dark:text-slate-100"
                      value={body}
                      onFocus={() => (lastFocused.current = "body")}
                      onChange={(e) => setBody(e.target.value)}
                    />
                  </div>
                  <p className="text-xs text-slate-400 dark:text-slate-500">
                    Formatting inserts plain-text markers (**bold**, *italic*) — reminders are sent
                    as plain text.
                  </p>
                </div>
              </div>
            ) : (
              <div className="mt-6 rounded-lg border border-slate-200 bg-cream-dim p-5 dark:border-slate-700 dark:bg-slate-800">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
                  To
                </p>
                <p className="mt-1 text-sm font-medium text-slate-800 dark:text-slate-100">
                  {selectedInvoice
                    ? selectedInvoice.customer_email ?? "This customer has no email on file"
                    : "Select an invoice below to auto-fill the recipient"}
                </p>
                <p className="mt-4 text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
                  Subject
                </p>
                <p className="mt-1 text-sm font-medium text-slate-800 dark:text-slate-100">
                  {preview.subject}
                </p>
                <p className="mt-4 text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
                  Body
                </p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-300">
                  {preview.body}
                </p>
              </div>
            )}

            <div className="mt-4 flex items-center gap-3">
              <button
                onClick={handleSaveTemplate}
                disabled={mode !== "edit" || savingTemplate || !templateId}
                className="rounded-lg border border-slate-300 bg-cream px-4 py-2 text-sm font-medium text-slate-700 hover:bg-cream-dim disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                {savingTemplate ? "Saving…" : "Save"}
              </button>
              {savedMessage && (
                <span className="text-sm text-emerald-600 dark:text-emerald-400">{savedMessage}</span>
              )}
            </div>

            {sentMessage && (
              <p className="mt-3 text-sm text-emerald-600 dark:text-emerald-400">{sentMessage}</p>
            )}
          </div>

          <div className="flex flex-col gap-6">
            <div className="rounded-xl border border-slate-200 bg-cream p-6 dark:border-slate-800 dark:bg-slate-900">
              <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                Available Placeholders
              </h3>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Click any chip to insert it at the cursor position.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {PLACEHOLDERS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => insertPlaceholder(p)}
                    className="rounded-full border border-accent/30 bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent-dark hover:bg-accent/20 dark:border-accent/40 dark:bg-accent/20 dark:text-accent"
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-cream p-6 dark:border-slate-800 dark:bg-slate-900">
              <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                Who to send it to
              </h3>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Pick the overdue invoice you&apos;re chasing — the customer&apos;s email, amount owed,
                dates, and days overdue all fill in automatically.
              </p>
              <div className="relative mt-3">
                <input
                  className={`${inputClass} w-full`}
                  placeholder="Search by invoice no. or customer…"
                  value={invoiceQuery}
                  onFocus={() => setShowInvoiceDropdown(true)}
                  onChange={(e) => {
                    setInvoiceQuery(e.target.value);
                    setShowInvoiceDropdown(true);
                    if (selectedInvoiceId) setSelectedInvoiceId("");
                  }}
                  onBlur={() => setTimeout(() => setShowInvoiceDropdown(false), 150)}
                />
                {showInvoiceDropdown && (
                  <div className="absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-slate-200 bg-cream shadow-lg dark:border-slate-700 dark:bg-slate-800">
                    <button
                      type="button"
                      onMouseDown={() => {
                        setSelectedInvoiceId("");
                        setInvoiceQuery("");
                        setShowInvoiceDropdown(false);
                      }}
                      className="block w-full px-3 py-2 text-left text-sm text-slate-500 hover:bg-cream-dim dark:text-slate-400 dark:hover:bg-slate-700"
                    >
                      Sample data (no invoice selected)
                    </button>
                    {filteredInvoices.length === 0 ? (
                      <p className="px-3 py-2 text-sm text-slate-400 dark:text-slate-500">
                        No matching invoices.
                      </p>
                    ) : (
                      filteredInvoices.map((inv) => (
                        <button
                          key={inv.id}
                          type="button"
                          onMouseDown={() => {
                            setSelectedInvoiceId(inv.id);
                            setInvoiceQuery(`${inv.invoice_no} — ${inv.customer_name}`);
                            setShowInvoiceDropdown(false);
                          }}
                          className="block w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-cream-dim dark:text-slate-200 dark:hover:bg-slate-700"
                        >
                          {inv.invoice_no} — {inv.customer_name}
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
              {fetchingInvoice && (
                <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">Fetching invoice…</p>
              )}
              {selectedInvoice && !selectedInvoice.customer_email && (
                <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                  This customer has no email on file, so Send is disabled.
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
