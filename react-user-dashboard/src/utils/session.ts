import type { AuthSession, PendingSignupProfile } from "../types";

const SESSION_KEY = "vsms_auth_session";
const PENDING_SIGNUP_KEY = "vsms_pending_signup";

function canUseStorage() {
  return typeof window !== "undefined";
}

export function getStoredSession(): AuthSession | null {
  if (!canUseStorage()) return null;
  const raw = window.localStorage.getItem(SESSION_KEY);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as AuthSession;
  } catch {
    window.localStorage.removeItem(SESSION_KEY);
    return null;
  }
}

export function setStoredSession(session: AuthSession) {
  if (!canUseStorage()) return;
  window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearStoredSession() {
  if (!canUseStorage()) return;
  window.localStorage.removeItem(SESSION_KEY);
}

export function getPendingSignupProfile(): PendingSignupProfile | null {
  if (!canUseStorage()) return null;
  const raw = window.sessionStorage.getItem(PENDING_SIGNUP_KEY);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as PendingSignupProfile;
  } catch {
    window.sessionStorage.removeItem(PENDING_SIGNUP_KEY);
    return null;
  }
}

export function setPendingSignupProfile(profile: PendingSignupProfile) {
  if (!canUseStorage()) return;
  window.sessionStorage.setItem(PENDING_SIGNUP_KEY, JSON.stringify(profile));
}

export function clearPendingSignupProfile() {
  if (!canUseStorage()) return;
  window.sessionStorage.removeItem(PENDING_SIGNUP_KEY);
}
