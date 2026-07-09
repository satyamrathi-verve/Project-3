"use client";

import { clearSession, getSession } from "@/lib/auth";

/*
  AuthGate (app/layout.tsx) already shows the Sign In screen for anyone without a
  session, for every route. So this page only ever renders when already signed in —
  it's a small "who am I" / sign-out card rather than a duplicate login form.
*/
export default function SignInPage() {
  const session = getSession();

  return (
    <div className="mx-auto max-w-md rounded-xl border border-slate-200 bg-white p-6 text-center">
      <p className="text-sm text-slate-500">You&apos;re already signed in as</p>
      <p className="mt-1 text-lg font-semibold text-slate-900">{session?.name}</p>
      <p className="text-xs text-slate-400">{session?.email}</p>
      <button
        type="button"
        onClick={() => {
          clearSession();
          window.location.href = "/";
        }}
        className="mt-4 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
      >
        Sign out
      </button>
    </div>
  );
}
