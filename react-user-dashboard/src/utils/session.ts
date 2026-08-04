import type { AuthSession } from "../types";

const SESSION_KEY = "vsms_staff_session";
export const REFERRAL_ISSUE_STORAGE_PREFIX = "vsms.referral-issue:";

function canUseStorage() {
  return typeof window !== "undefined";
}

export function getStoredSession(): AuthSession | null {
  if (!canUseStorage()) return null;
  const raw = window.sessionStorage.getItem(SESSION_KEY);
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
  window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearStoredReferralIssues() {
  if (!canUseStorage()) return;
  try {
    const keys = Array.from({ length: window.sessionStorage.length }, (_, index) => window.sessionStorage.key(index))
      .filter((key): key is string => Boolean(key?.startsWith(REFERRAL_ISSUE_STORAGE_PREFIX)));
    keys.forEach((key) => window.sessionStorage.removeItem(key));
  } catch {
    // Storage can be unavailable in hardened/private browser contexts. Session cleanup must remain safe.
  }
}

export function clearStoredSession() {
  if (!canUseStorage()) return;
  try {
    window.sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // Continue so referral recovery metadata is still given its own cleanup attempt.
  }
  clearStoredReferralIssues();
}
