import { useEffect, useState } from "react";
import { Navigate, Outlet, useLocation, useParams } from "react-router-dom";
import { getApiError } from "../utils/apiClient";
import * as stage4Api from "../features/stage4Api";
import { screeningApi, type StationType } from "../features/screening/screeningApi";
import { useAuth } from "./AuthProvider";

interface RoleGuardProps {
  allowedRoles: string[];
  deniedRoles?: string[];
}

type GuardState = "loading" | "allowed" | "forbidden" | "not-found";

function normalizeRole(role: stage4Api.MembershipRole | string | undefined) {
  const value = typeof role === "string" ? role : role?.role;
  return value === "REGISTRATION" ? "REGISTRATION_OFFICER" : value || "";
}

function activeEventRoles(memberships: stage4Api.Membership[] | undefined, eventId: string) {
  return (memberships || [])
    .filter((m) => (m.eventId === eventId || m.event?.eventId === eventId || m.event?.id === eventId) && m.status !== "REMOVED" && !m.removedAt)
    .flatMap((m) => (m.roles || []).map(normalizeRole));
}

function isNotFound(error: unknown) {
  const maybe = error as { response?: { status?: number }; message?: string };
  return maybe.response?.status === 404 || /404|not found/i.test(maybe.message || getApiError(error, ""));
}

export function RoleGuard({ allowedRoles, deniedRoles = [] }: RoleGuardProps) {
  const { session } = useAuth();
  const roles = session?.user.roles ?? [];
  const isAllowed = !deniedRoles.some((role) => roles.includes(role))
    && allowedRoles.some((role) => roles.includes(role));

  if (!isAllowed) return <Navigate to="/forbidden" replace />;
  return <Outlet />;
}

export function EventCapabilityGuard({ allowedRoles }: Pick<RoleGuardProps, "allowedRoles">) {
  const { session } = useAuth();
  const { eventId: routeEventId = "" } = useParams();
  const location = useLocation();
  // Participant pages preserve the selected event in the query string.
  const eventId = routeEventId || new URLSearchParams(location.search).get("eventId") || "";
  const [state, setState] = useState<GuardState>("loading");

  useEffect(() => {
    let alive = true;
    async function check() {
      if (!eventId) {
        setState("forbidden");
        return;
      }
      const sessionUser = session?.user as { eventMemberships?: stage4Api.Membership[]; memberships?: stage4Api.Membership[] } | undefined;
      const sessionEventRoles = activeEventRoles(sessionUser?.eventMemberships || sessionUser?.memberships, eventId);
      if (sessionEventRoles.some((role) => allowedRoles.includes(role))) {
        setState("allowed");
        return;
      }
      const eventResult = await Promise.allSettled([stage4Api.getEvent(eventId), stage4Api.getCurrentAccount()]);
      if (!alive) return;
      const [eventAccess, accountAccess] = eventResult;
      if (eventAccess.status === "fulfilled" && eventAccess.value.canManage && allowedRoles.includes("EVENT_MANAGER")) {
        setState("allowed");
        return;
      }
      if (accountAccess.status === "fulfilled") {
        const raw = accountAccess.value as { account?: stage4Api.AccountProfile } | stage4Api.AccountProfile;
        const account: stage4Api.AccountProfile | undefined = raw && typeof raw === "object" && "account" in raw ? raw.account : raw as stage4Api.AccountProfile;
        const fetchedRoles = activeEventRoles(account?.eventMemberships || account?.memberships, eventId);
        if (fetchedRoles.some((role) => allowedRoles.includes(role))) {
          setState("allowed");
          return;
        }
      }
      if (eventAccess.status === "rejected") {
        setState(isNotFound(eventAccess.reason) ? "not-found" : "forbidden");
        return;
      }
      setState("forbidden");
    }
    setState("loading");
    void check().catch((error) => {
      if (!alive) return;
      setState(isNotFound(error) ? "not-found" : "forbidden");
    });
    return () => { alive = false; };
  }, [allowedRoles, eventId, session]);

  if (state === "loading") return <div role="status" aria-live="polite">Checking event access…</div>;
  if (state === "not-found") return <Navigate to="/not-found" replace />;
  if (state === "forbidden") return <Navigate to="/forbidden" replace />;
  return <Outlet />;
}


export function StationDutyGuard({ stationType }: { stationType: StationType }) {
  const { eventId = "", stationId = "" } = useParams();
  const [state, setState] = useState<GuardState>("loading");

  useEffect(() => {
    let alive = true;
    async function check() {
      if (!eventId) {
        setState("forbidden");
        return;
      }
      try {
        const result = await screeningApi.listStations(eventId);
        if (!alive) return;
        setState(result.stations.some((station) => (
          station.stationType === stationType
          && station.isActive !== false
          && (stationType !== "CUSTOM" || !stationId || station.stationId === stationId)
        )) ? "allowed" : "forbidden");
      } catch (error) {
        if (!alive) return;
        setState(isNotFound(error) ? "not-found" : "forbidden");
      }
    }
    setState("loading");
    void check();
    return () => { alive = false; };
  }, [eventId, stationId, stationType]);

  if (state === "loading") return <div role="status" aria-live="polite">Checking station duty…</div>;
  if (state === "not-found") return <Navigate to="/not-found" replace />;
  if (state === "forbidden") return <Navigate to="/forbidden" replace />;
  return <Outlet />;
}
