import { useEffect, useMemo, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "./AuthProvider";
import { CognitoLoginRedirect } from "./CognitoRoutes";
import { isLogoutPending } from "../utils/session";
import { getCurrentAccount, type AccountProfile } from "../features/stage4Api";

export function ProtectedRoute() {
  const { isAuthenticated, isBootstrapping, session } = useAuth();
  const location = useLocation();

  const accountState = session?.user.approvalState;
  const accessState = session?.user.accessState;
  const lifecyclePath = location.pathname.startsWith('/account');
  const rawSessionUser = session?.user;
  const sessionUser = rawSessionUser as ({ roles?: string[]; eventMemberships?: AccountProfile["eventMemberships"]; memberships?: AccountProfile["memberships"] } | undefined);
  const [confirmedMemberships, setConfirmedMemberships] = useState<AccountProfile["eventMemberships"] | null>(null);
  const sessionMemberships = useMemo(() => {
    const user = rawSessionUser as ({ eventMemberships?: AccountProfile["eventMemberships"]; memberships?: AccountProfile["memberships"] } | undefined);
    return rawSessionUser && ("eventMemberships" in rawSessionUser || "memberships" in rawSessionUser)
      ? (user?.eventMemberships || user?.memberships || [])
      : null;
  }, [rawSessionUser]);

  useEffect(() => {
    let alive = true;
    if (sessionMemberships || lifecyclePath || accountState !== 'APPROVED' || accessState !== 'ENABLED' || sessionUser?.roles?.includes('ADMINISTRATOR')) {
      setConfirmedMemberships(null);
      return () => { alive = false; };
    }
    void getCurrentAccount().then((value) => {
      if (!alive) return;
      const account = (value && typeof value === 'object' && 'account' in value ? value.account : value) as AccountProfile;
      setConfirmedMemberships(account.eventMemberships || account.memberships || []);
    }).catch(() => { if (alive) setConfirmedMemberships(null); });
    return () => { alive = false; };
  }, [accountState, accessState, lifecyclePath, sessionMemberships, sessionUser?.roles]);

  const memberships = sessionMemberships || confirmedMemberships;
  const hasActiveMembership = memberships?.some((membership) => membership.status !== 'REMOVED' && !membership.removedAt);
  const confirmedUnassigned = memberships !== null && !hasActiveMembership && !sessionUser?.roles?.includes('ADMINISTRATOR');

  if (isBootstrapping) {
    return <div role="status" aria-live="polite">Restoring your session…</div>;
  }

  if (!isAuthenticated) {
    if (isLogoutPending()) return <Navigate to="/" replace />;
    return <CognitoLoginRedirect returnTo={`${location.pathname}${location.search}`} />;
  }

  if ((accountState === 'PENDING' || accountState === 'REJECTED' || accessState === 'SUSPENDED' || accessState === 'DISABLED' || (accountState === 'APPROVED' && accessState === 'ENABLED' && confirmedUnassigned)) && !lifecyclePath) {
    return <Navigate to="/account/state" replace />;
  }

  return <Outlet />;
}
