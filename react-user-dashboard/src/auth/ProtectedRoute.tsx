import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "./AuthProvider";
import { CognitoLoginRedirect } from "./CognitoRoutes";
import { isLogoutPending } from "../utils/session";

export function ProtectedRoute() {
  const { isAuthenticated, isBootstrapping, session } = useAuth();
  const location = useLocation();

  const accountState = session?.user.approvalState;
  const accessState = session?.user.accessState;
  const lifecyclePath = location.pathname.startsWith('/account');

  if (isBootstrapping) {
    return <div role="status" aria-live="polite">Restoring your session…</div>;
  }

  if (!isAuthenticated) {
    if (isLogoutPending()) return <Navigate to="/" replace />;
    return <CognitoLoginRedirect returnTo={`${location.pathname}${location.search}`} />;
  }

  if ((accountState === 'PENDING' || accountState === 'REJECTED' || accessState === 'SUSPENDED' || accessState === 'DISABLED') && !lifecyclePath) {
    return <Navigate to="/account/state" replace />;
  }

  return <Outlet />;
}
