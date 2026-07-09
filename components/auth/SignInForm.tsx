"use client";

import { useEffect, useRef, useState } from "react";
import { AR360Logo } from "@/components/AR360Logo";
import { FormField, inputClass } from "@/components/FormField";
import { LoginBackground } from "@/components/auth/LoginBackground";
import {
  findAccount,
  isStrongPassword,
  isValidEmail,
  setSession,
  type Session,
} from "@/lib/auth";

type EmailStatus = "idle" | "checking" | "valid" | "invalid";

const EMAIL_CHECK_DELAY_MS = 500;
const SUBMIT_DELAY_MS = 500;

function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

export function SignInForm({ onSuccess }: { onSuccess: (session: Session) => void }) {
  const [email, setEmail] = useState("");
  const [emailStatus, setEmailStatus] = useState<EmailStatus>("idle");
  const [emailError, setEmailError] = useState<string | null>(null);

  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [forgotOpen, setForgotOpen] = useState(false);

  const matchedAccountRef = useRef<ReturnType<typeof findAccount>>(undefined);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const checkTokenRef = useRef(0);

  function runEmailCheck(candidate: string) {
    const token = ++checkTokenRef.current;
    const trimmed = candidate.trim();

    if (!trimmed) {
      setEmailStatus("idle");
      setEmailError(null);
      matchedAccountRef.current = undefined;
      return;
    }

    if (!isValidEmail(trimmed)) {
      setEmailStatus("invalid");
      setEmailError("Enter a valid email address.");
      matchedAccountRef.current = undefined;
      return;
    }

    setEmailStatus("checking");
    setEmailError(null);

    // Simulated lookup latency so the "automatic" check reads as a real check.
    setTimeout(() => {
      if (checkTokenRef.current !== token) return; // superseded by a newer check
      const account = findAccount(trimmed);
      matchedAccountRef.current = account;
      if (!account) {
        setEmailStatus("invalid");
        setEmailError("No account found with this email address.");
      } else {
        setEmailStatus("valid");
        setEmailError(null);
      }
    }, EMAIL_CHECK_DELAY_MS);
  }

  function handleEmailChange(value: string) {
    setEmail(value);
    setFormError(null);

    // Editing the email after a password field was revealed hides it again
    // and clears whatever was typed, per the intended flow.
    if (password) setPassword("");
    matchedAccountRef.current = undefined;
    setEmailStatus("idle");
    setEmailError(null);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runEmailCheck(value), 400);
  }

  function handleEmailBlur() {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    runEmailCheck(email);
  }

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const passwordVisible = emailStatus === "valid";
  const passwordFormatOk = isStrongPassword(password);
  const canSubmit = passwordVisible && passwordFormatOk && !submitting;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    setSubmitting(true);
    setFormError(null);

    setTimeout(() => {
      const account = matchedAccountRef.current;
      if (!account) {
        setSubmitting(false);
        setFormError("Invalid credentials. Please try again.");
        return;
      }
      if (account.password !== password) {
        setSubmitting(false);
        setFormError("Incorrect password.");
        return;
      }
      if (account.status === "disabled") {
        setSubmitting(false);
        setFormError("This account has been disabled. Contact your administrator.");
        return;
      }

      const session: Session = { email: account.email, name: account.name };
      setSession(session);
      setSubmitting(false);
      onSuccess(session);
    }, SUBMIT_DELAY_MS);
  }

  return (
    <div className="relative flex min-h-screen w-full items-center justify-center overflow-hidden bg-slate-900 p-4">
      <LoginBackground />

      {/* Login card */}
      <div className="relative z-10 w-full max-w-md rounded-2xl bg-white/95 p-8 shadow-2xl ring-1 ring-black/5 backdrop-blur">
        <div className="mb-6 flex flex-col items-center text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/verve-logo.png" alt="Verve Advisory" className="h-16 w-auto" />
          <AR360Logo className="mt-3 h-10" invertOnDark={false} />
          <p className="mt-1 text-xs text-slate-500">(360° AR management)</p>
          <p className="mt-3 text-sm text-slate-500">Welcome back. Sign in to continue.</p>
        </div>

        <form onSubmit={handleSubmit} noValidate>
          <FormField label="Email (User ID)">
            <div className="relative">
              <input
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => handleEmailChange(e.target.value)}
                onBlur={handleEmailBlur}
                className={`${inputClass} w-full py-2.5 pr-9`}
                aria-invalid={emailStatus === "invalid"}
                aria-describedby="email-status"
                placeholder="you@company.com"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
                {emailStatus === "checking" && <Spinner className="h-4 w-4 text-brand" />}
                {emailStatus === "valid" && (
                  <svg className="h-4 w-4 text-emerald-500" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                    <path
                      fillRule="evenodd"
                      d="M16.7 5.3a1 1 0 010 1.4l-7.5 7.5a1 1 0 01-1.4 0l-3.5-3.5a1 1 0 111.4-1.4L8.5 12l6.8-6.8a1 1 0 011.4 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                )}
              </span>
            </div>
            <span id="email-status" role="alert" className="min-h-[1.1rem] text-xs text-red-600">
              {emailError}
            </span>
          </FormField>

          <div
            className={`grid transition-[grid-template-rows] duration-300 ease-out ${
              passwordVisible ? "mt-3 grid-rows-[1fr]" : "grid-rows-[0fr]"
            }`}
          >
            <div className="overflow-hidden">
              <FormField label="Password">
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      setFormError(null);
                    }}
                    className={`${inputClass} w-full py-2.5 pr-16`}
                    aria-describedby="password-hint"
                    disabled={!passwordVisible}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-slate-400 hover:text-slate-600"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? "Hide" : "Show"}
                  </button>
                </div>
                <span id="password-hint" className="min-h-[1.1rem] text-xs text-slate-400">
                  {password && !passwordFormatOk
                    ? "8+ characters, upper & lower case, a number and a symbol."
                    : ""}
                </span>
              </FormField>

              <div className="mt-1 text-right">
                <button
                  type="button"
                  onClick={() => setForgotOpen((v) => !v)}
                  className="text-xs font-medium text-brand hover:underline"
                >
                  Forgot password?
                </button>
              </div>

              {forgotOpen && (
                <div className="mt-2 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
                  Password resets aren&apos;t available in this demo. Contact your administrator, or
                  use one of the demo logins below.
                </div>
              )}
            </div>
          </div>

          <div role="alert" className="mt-3 min-h-[1.1rem] text-sm font-medium text-red-600">
            {formError}
          </div>

          <button
            type="submit"
            disabled={!canSubmit}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-brand py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-40"
          >
            {submitting && <Spinner />}
            {submitting ? "Signing in…" : "Sign In"}
          </button>
        </form>

        <details className="mt-6 rounded-lg border border-slate-200 p-3 text-xs text-slate-500">
          <summary className="cursor-pointer select-none font-medium text-slate-600">Demo logins</summary>
          <ul className="mt-2 space-y-1">
            <li>
              <span className="font-medium text-slate-700">User:</span> user@verve.com / User@123
            </li>
            <li>
              <span className="font-medium text-slate-700">Disabled (for testing):</span> disabled@verve.com /
              Disabled@123
            </li>
          </ul>
        </details>
      </div>
    </div>
  );
}
