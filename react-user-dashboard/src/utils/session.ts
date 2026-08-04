import type { AuthSession } from "../types";

const SESSION_KEY = "vsms_staff_session";
const EVENT_CONTEXT_KEY = "vsms_event_id";
const LOGOUT_PENDING_KEY = "vsms_logout_pending";
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

export function isLogoutPending() {
  if (!canUseStorage()) return false;
  try {
    return window.sessionStorage.getItem(LOGOUT_PENDING_KEY) === "true";
  } catch {
    return false;
  }
}

export function markLogoutPending() {
  if (!canUseStorage()) return;
  try {
    window.sessionStorage.setItem(LOGOUT_PENDING_KEY, "true");
  } catch {
    // The in-memory logout guard still prevents a same-page reauthorization.
  }
}

export function clearLogoutPending() {
  if (!canUseStorage()) return;
  try {
    window.sessionStorage.removeItem(LOGOUT_PENDING_KEY);
  } catch {
    // A successful sign-in remains usable even if storage is unavailable.
  }
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
    window.sessionStorage.removeItem(EVENT_CONTEXT_KEY);
  } catch {
    // Continue so referral recovery metadata is still given its own cleanup attempt.
  }
  clearStoredReferralIssues();
}
