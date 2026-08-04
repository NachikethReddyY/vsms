import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "./AuthProvider";
import { CognitoLoginRedirect } from "./CognitoRoutes";
import { isLogoutPending } from "../utils/session";

export function ProtectedRoute() {
  const { isAuthenticated, isBootstrapping } = useAuth();
  const location = useLocation();

  if (isBootstrapping) {
    return <div role="status" aria-live="polite">Restoring your session…</div>;
  }

  if (!isAuthenticated) {
    if (isLogoutPending()) return <Navigate to="/" replace />;
    return <CognitoLoginRedirect returnTo={`${location.pathname}${location.search}`} />;
  }

  return <Outlet />;
}
