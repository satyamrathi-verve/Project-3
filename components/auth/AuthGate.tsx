"use client";

import { useEffect, useState } from "react";
import { Nav } from "@/components/Nav";
import { SignInForm } from "@/components/auth/SignInForm";
import { getSession, type Session } from "@/lib/auth";

/*
  Gates the whole app behind the front-end-only demo Sign In (CLAUDE.md rule:
  no real auth backend). Renders nothing meaningful until the localStorage
  session check resolves, to avoid a flash of the signed-out screen.
*/
export function AuthGate({ children }: { children: React.ReactNode }) {
  const [session, setSessionState] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    setSessionState(getSession());
  }, []);

  if (session === undefined) {
    return <div className="h-screen w-screen bg-slate-900" />;
  }

  if (!session) {
    return <SignInForm onSuccess={setSessionState} />;
  }

  return (
    <div className="flex h-screen">
      <Nav session={session} />
      <main className="flex-1 overflow-y-auto bg-slate-50 p-8 dark:bg-slate-950">{children}</main>
    </div>
  );
}
