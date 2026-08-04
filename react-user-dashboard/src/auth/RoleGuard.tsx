import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "./AuthProvider";

interface RoleGuardProps {
  allowedRoles: string[];
  deniedRoles?: string[];
}

export function RoleGuard({ allowedRoles, deniedRoles = [] }: RoleGuardProps) {
  const { session } = useAuth();
  const roles = session?.user.roles ?? [];
  const isAllowed = !deniedRoles.some((role) => roles.includes(role))
    && allowedRoles.some((role) => roles.includes(role));

  if (!isAllowed) {
    return <Navigate to="/events" replace />;
  }

  return <Outlet />;
}
