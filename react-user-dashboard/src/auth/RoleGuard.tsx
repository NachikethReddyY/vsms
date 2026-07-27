import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "./AuthProvider";

interface RoleGuardProps {
  allowedRoles: string[];
}

export function RoleGuard({ allowedRoles }: RoleGuardProps) {
  const { session } = useAuth();
  const roles = session?.user.roles ?? [];
  const isAllowed = allowedRoles.some((role) => roles.includes(role));

  if (!isAllowed) {
    return <Navigate to="/account/security" replace />;
  }

  return <Outlet />;
}
