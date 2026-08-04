import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "./AuthProvider";
import { CognitoLoginRedirect } from "./CognitoRoutes";
import { isLogoutPending } from "../utils/session";

export function ProtectedRoute() {
  const { isAuthenticated } = useAuth();
  const location = useLocation();

  if (!isAuthenticated) {
    if (isLogoutPending()) return <Navigate to="/" replace />;
    return <CognitoLoginRedirect returnTo={`${location.pathname}${location.search}`} />;
  }

  return <Outlet />;
}
