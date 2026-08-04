import type { AuthSession } from "../types";

const SESSION_KEY = "vsms_staff_session";

function canUseStorage() {
  return typeof window !== "undefined";
}

export function getStoredSession(): AuthSession | null {
  if (!canUseStorage()) return null;
  let raw: string | null;
  try { raw = window.sessionStorage.getItem(SESSION_KEY); } catch { return null; }
  if (!raw) return null;
  try {
    const session = JSON.parse(raw) as AuthSession;
    if (!session.user?.id || !Number.isFinite(session.expiresAt) || session.expiresAt <= Date.now()) {
      clearStoredSession();
      return null;
    }
    return session;
  } catch {
    clearStoredSession();
    return null;
  }
}

export function setStoredSession(session: AuthSession) {
  if (!canUseStorage()) return;
  try { window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch { /* Memory-only session remains active. */ }
}

export function clearStoredSession() {
  if (!canUseStorage()) return;
  try { window.sessionStorage.removeItem(SESSION_KEY); } catch { /* Storage is already unavailable. */ }
}
