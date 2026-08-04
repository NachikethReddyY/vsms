import { Outlet, useLocation } from "react-router-dom";
import { useAuth } from "./AuthProvider";
import { CognitoLoginRedirect } from "./CognitoRoutes";

export function ProtectedRoute() {
  const { isAuthenticated } = useAuth();
  const location = useLocation();

  if (!isAuthenticated) {
    return <CognitoLoginRedirect returnTo={`${location.pathname}${location.search}`} />;
  }

  return <Outlet />;
}
