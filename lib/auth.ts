/*
  Front-end-only demo auth (per CLAUDE.md: no real auth backend, no users table).
  Credentials live in code and the session is just a localStorage flag — this is
  intentionally not secure and must never be treated as real authentication.
*/

export type AccountStatus = "active" | "disabled";

export interface DemoAccount {
  email: string;
  password: string;
  name: string;
  status: AccountStatus;
}

export interface Session {
  email: string;
  name: string;
}

const SESSION_KEY = "ar_manager_session";

export const DEMO_ACCOUNTS: DemoAccount[] = [
  { email: "user@verve.com", password: "User@123", name: "Rahul Mehta", status: "active" },
  { email: "disabled@verve.com", password: "Disabled@123", name: "Suspended Account", status: "disabled" },
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const STRONG_PASSWORD_RE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/;

export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email.trim());
}

export function isStrongPassword(password: string): boolean {
  return STRONG_PASSWORD_RE.test(password);
}

export function findAccount(email: string): DemoAccount | undefined {
  const normalized = email.trim().toLowerCase();
  return DEMO_ACCOUNTS.find((a) => a.email.toLowerCase() === normalized);
}

export function getSession(): Session | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export function setSession(session: Session) {
  window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearSession() {
  window.localStorage.removeItem(SESSION_KEY);
}
