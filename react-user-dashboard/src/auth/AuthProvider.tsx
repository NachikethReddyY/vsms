import { createContext, useContext, useEffect, useMemo, useState, type PropsWithChildren } from "react";
import type { AuthSession } from "../types";
import { beginLogout, getCsrfToken, refreshAuthSession, setSessionTokens } from "../utils/apiClient";
import { clearLogoutPending, clearStoredSession, getStoredSession, isLogoutPending, setStoredSession } from "../utils/session";

interface AuthContextValue {
  session: AuthSession | null;
  isAuthenticated: boolean;
  isBootstrapping: boolean;
  setSession: (session: AuthSession) => void;
  clearSession: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSessionState] = useState<AuthSession | null>(() => getStoredSession());
  const [isBootstrapping, setIsBootstrapping] = useState(true);

  useEffect(() => {
    let active = true;
    const restore = async () => {
      if (!getCsrfToken() || isLogoutPending()) {
        if (active) setIsBootstrapping(false);
        return;
      }
      try {
        const restored = await refreshAuthSession();
        if (active) setSessionState(restored);
      } catch (error) {
        if ((error as { response?: unknown })?.response !== undefined) {
          setSessionTokens(null);
          clearStoredSession();
          if (active) setSessionState(null);
        }
      } finally {
        if (active) setIsBootstrapping(false);
      }
    };
    void restore();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!session) return undefined;
    const timer = window.setTimeout(() => {
      setSessionTokens(null);
      clearStoredSession();
      setSessionState(null);
    }, Math.max(0, session.expiresAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [session]);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      isAuthenticated: Boolean(session?.user?.id && session.expiresAt > Date.now()),
      isBootstrapping,
      setSession(nextSession) {
        clearLogoutPending();
        setStoredSession(nextSession);
        setSessionState(nextSession);
      },
      clearSession() {
        beginLogout();
        setSessionState(null);
      },
    }),
    [isBootstrapping, session]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// This hook intentionally lives beside its provider so the context stays private.
// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }

  return context;
}
