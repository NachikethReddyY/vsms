import { createContext, useContext, useEffect, useMemo, useState, type PropsWithChildren } from "react";
import type { AuthSession } from "../types";
import { getCsrfToken, refreshAuthSession, setSessionTokens } from "../utils/apiClient";
import { clearStoredSession, getStoredSession, setStoredSession } from "../utils/session";

interface AuthContextValue {
  session: AuthSession | null;
  isAuthenticated: boolean;
  setSession: (session: AuthSession) => void;
  clearSession: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSessionState] = useState<AuthSession | null>(() => getStoredSession());

  useEffect(() => {
    if (!getCsrfToken()) {
      setSessionTokens(null);
      clearStoredSession();
      setSessionState(null);
      return;
    }
    refreshAuthSession()
      .then(setSessionState)
      .catch(() => {
        setSessionTokens(null);
        clearStoredSession();
        setSessionState(null);
      });
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      isAuthenticated: Boolean(session?.user?.id && session.expiresAt > Date.now()),
      setSession(nextSession) {
        setStoredSession(nextSession);
        setSessionState(nextSession);
      },
      clearSession() {
        setSessionTokens(null);
        clearStoredSession();
        setSessionState(null);
      },
    }),
    [session]
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
