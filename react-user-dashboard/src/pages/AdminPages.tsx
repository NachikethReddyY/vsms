import { useCallback, useEffect, useState } from "react";
import apiClient from "../utils/apiClient";
import { LoadingState } from "../components/ui";

type AuditEntry = {
  id: string;
  action: string;
  entityName: string | null;
  outcome: string;
  createdAt?: string;
  user?: { id: string; fullName?: string | null; email?: string | null } | null;
};

type AuthAuditEntry = {
  id: string;
  eventType: string;
  outcome: string;
  occurredAt?: string;
  user?: { id: string; fullName?: string | null; email?: string | null } | null;
};

type AuditListResponse = {
  logs: AuditEntry[];
  authLogs: AuthAuditEntry[];
  nextCursor: string | null;
  nextAuthCursor: string | null;
};

const OUTCOME_OPTIONS = ["SUCCESS", "FAILED", "DENIED"] as const;

const formatTimestamp = (value?: string) =>
  value ? new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "";

export function AuditLogsPage() {
  const [logs, setLogs] = useState<AuditEntry[]>([]);
  const [authLogs, setAuthLogs] = useState<AuthAuditEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [nextAuthCursor, setNextAuthCursor] = useState<string | null>(null);

  const [filters, setFilters] = useState({ entityName: "", action: "", eventType: "", outcome: "" });

  const [isRestricted, setIsRestricted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState<"logs" | "authLogs" | null>(null);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);

  const load = useCallback(async (overrides?: { cursor?: string; authCursor?: string; reset?: boolean }) => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiClient.get<AuditListResponse>("/admin/audit-logs", {
        params: {
          limit: 50,
          ...(filters.entityName ? { entityName: filters.entityName } : {}),
          ...(filters.action ? { action: filters.action } : {}),
          ...(filters.eventType ? { eventType: filters.eventType } : {}),
          ...(filters.outcome ? { outcome: filters.outcome } : {}),
          ...(overrides?.cursor ? { cursor: overrides.cursor } : {}),
          ...(overrides?.authCursor ? { authCursor: overrides.authCursor } : {}),
        },
      });
      const data = response.data;
      setLogs((previous) => (overrides?.reset ? (data.logs ?? []) : [...previous, ...(data.logs ?? [])]));
      setAuthLogs((previous) =>
        overrides?.reset ? (data.authLogs ?? []) : [...previous, ...(data.authLogs ?? [])]
      );
      setNextCursor(data.nextCursor);
      setNextAuthCursor(data.nextAuthCursor);
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      if (status === 403) {
        setIsRestricted(true);
      } else {
        setError(message || "Failed to load audit logs.");
      }
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    void load({ reset: true });
  }, [load]);

  const loadMore = useCallback(
    async (section: "logs" | "authLogs") => {
      const cursor = section === "logs" ? nextCursor : nextAuthCursor;
      if (!cursor) return;
      setLoadingMore(section);
      setLoadMoreError(null);
      try {
        const response = await apiClient.get<AuditListResponse>("/admin/audit-logs", {
          params: {
            limit: 50,
            ...(filters.entityName ? { entityName: filters.entityName } : {}),
            ...(filters.action ? { action: filters.action } : {}),
            ...(filters.eventType ? { eventType: filters.eventType } : {}),
            ...(filters.outcome ? { outcome: filters.outcome } : {}),
            ...(section === "logs" ? { cursor } : { authCursor: cursor }),
          },
        });
        const data = response.data;
        if (section === "logs") {
          setLogs((previous) => [...previous, ...(data.logs ?? [])]);
          setNextCursor(data.nextCursor);
        } else {
          setAuthLogs((previous) => [...previous, ...(data.authLogs ?? [])]);
          setNextAuthCursor(data.nextAuthCursor);
        }
      } catch (err: unknown) {
        const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
        setLoadMoreError(message || "Failed to load more records.");
      } finally {
        setLoadingMore(null);
      }
    },
    [filters, nextCursor, nextAuthCursor]
  );

  // Helper function to render status badges for outcomes
  const renderBadge = (outcome: string) => {
    const normalized = outcome.toLowerCase();
    const isSuccess = normalized.includes("success") || normalized.includes("allow");
    return (
      <span
        className={`inline-block rounded px-2 py-0.5 text-xs font-semibold tracking-wide uppercase ${
          isSuccess
            ? "bg-emerald-100 text-emerald-800 border border-emerald-200"
            : "bg-[color-mix(in_srgb,var(--red)_10%,var(--surface))] text-[var(--red)] border border-[color-mix(in_srgb,var(--red)_35%,var(--hairline))]"
        }`}
      >
        {outcome}
      </span>
    );
  };

  const renderFilters = () => (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <label className="block text-xs font-medium text-[var(--ink-2)]">
        Entity name
        <input
          type="text"
          value={filters.entityName}
          onChange={(event) => setFilters({ ...filters, entityName: event.target.value })}
          placeholder="e.g. Event, QRCodePass"
          className="mt-1 w-full rounded-lg border border-[var(--hairline-strong)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none"
        />
      </label>
      <label className="block text-xs font-medium text-[var(--ink-2)]">
        Action
        <input
          type="text"
          value={filters.action}
          onChange={(event) => setFilters({ ...filters, action: event.target.value })}
          placeholder="e.g. QUEUE_JOINED"
          className="mt-1 w-full rounded-lg border border-[var(--hairline-strong)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none"
        />
      </label>
      <label className="block text-xs font-medium text-[var(--ink-2)]">
        Event type
        <input
          type="text"
          value={filters.eventType}
          onChange={(event) => setFilters({ ...filters, eventType: event.target.value })}
          placeholder="e.g. LOGIN_SUCCESS"
          className="mt-1 w-full rounded-lg border border-[var(--hairline-strong)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none"
        />
      </label>
      <label className="block text-xs font-medium text-[var(--ink-2)]">
        Outcome
        <select
          value={filters.outcome}
          onChange={(event) => setFilters({ ...filters, outcome: event.target.value })}
          className="mt-1 w-full rounded-lg border border-[var(--hairline-strong)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none"
        >
          <option value="">All outcomes</option>
          {OUTCOME_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
    </div>
  );

  // 1. Restricted View (User is not an Administrator)
  if (isRestricted) {
    return (
        <div className="page-frame narrow audit-hub flex min-h-[60vh] items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl border border-[color-mix(in_srgb,var(--red)_35%,var(--hairline))] bg-[color-mix(in_srgb,var(--red)_8%,var(--surface))] p-8 text-center">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--red)]">
              RESTRICTED
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-[var(--ink-2)]">
              Audit logs are visible to Administrator accounts only.
              <br />
              Contact your event administrator if you need access.
            </p>
          </div>
        </div>
    );
  }

  // 2. Generic Error View
  if (error) {
    return (
        <div className="page-frame narrow audit-hub p-6 text-center text-sm font-medium text-[var(--red)]">
          {error}
        </div>
    );
  }

  // 3. Loading State
  if (loading) {
    return <LoadingState label="Loading audit logs..." />;
  }

  // 4. Authorized View
  return (
      <div className="page-frame narrow audit-hub space-y-6">
        <div>
          <h1 className="text-xl font-bold text-[var(--ink)]">Audit Logs Hub</h1>
          <p className="text-sm text-[var(--ink-2)]">
            Monitor administrative activities and authentication logs across the system.
          </p>
        </div>

        <section className="rounded-2xl border border-[var(--hairline)] bg-[var(--surface)] p-5">
          <h2 className="mb-3 text-sm font-semibold text-[var(--ink)]">Filters</h2>
          {renderFilters()}
        </section>

        <div className="grid gap-6 xl:grid-cols-2">
          {/* Application Audit Logs Section */}
          <section className="rounded-2xl border border-[var(--hairline)] bg-[var(--surface)] p-5">
            <div className="flex items-center justify-between border-b border-[var(--hairline-soft)] pb-3">
              <h2 className="text-lg font-semibold text-[var(--ink)]">Application audit logs</h2>
              <span className="rounded-full bg-[var(--surface-2)] px-2.5 py-0.5 text-xs font-medium text-[var(--ink-2)]">
                {logs.length}
              </span>
            </div>

            <div className="mt-4 space-y-3">
              {logs.length > 0 ? (
                logs.map((entry) => (
                  <article key={entry.id} className="rounded-xl border border-[var(--hairline)] p-3 text-sm transition-colors hover:border-[var(--hairline-strong)]">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-medium text-[var(--ink)]">{entry.action}</p>
                      {entry.outcome && renderBadge(entry.outcome)}
                    </div>
                    <p className="mt-1 text-xs text-[var(--ink-2)]">
                      <span className="font-semibold text-[var(--ink)]">{entry.entityName ?? "—"}</span> - {entry.user?.email ?? "unknown user"}
                    </p>
                    {formatTimestamp(entry.createdAt) && (
                      <p className="mt-1.5 text-[11px] font-mono text-[var(--muted)]">{formatTimestamp(entry.createdAt)}</p>
                    )}
                  </article>
                ))
              ) : (
                <p className="py-6 text-center text-sm text-[var(--muted)]">No application audit logs found.</p>
              )}
            </div>

            {nextCursor && (
              <button
                type="button"
                onClick={() => void loadMore("logs")}
                disabled={loadingMore === "logs"}
                className="mt-4 min-h-11 w-full rounded-lg border border-[var(--hairline-strong)] bg-[var(--canvas-soft)] px-4 py-2 text-sm font-medium text-[var(--ink-2)] hover:bg-[var(--surface-2)] disabled:opacity-50"
              >
                {loadingMore === "logs" ? "Loading more..." : "Load more"}
              </button>
            )}
          </section>

          {/* Authentication Audit Logs Section */}
          <section className="rounded-2xl border border-[var(--hairline)] bg-[var(--surface)] p-5">
            <div className="flex items-center justify-between border-b border-[var(--hairline-soft)] pb-3">
              <h2 className="text-lg font-semibold text-[var(--ink)]">Authentication audit logs</h2>
              <span className="rounded-full bg-[var(--surface-2)] px-2.5 py-0.5 text-xs font-medium text-[var(--ink-2)]">
                {authLogs.length}
              </span>
            </div>

            <div className="mt-4 space-y-3">
              {authLogs.length > 0 ? (
                authLogs.map((entry) => (
                  <article key={entry.id} className="rounded-xl border border-[var(--hairline)] p-3 text-sm transition-colors hover:border-[var(--hairline-strong)]">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-medium text-[var(--ink)]">{entry.eventType}</p>
                      {entry.outcome && renderBadge(entry.outcome)}
                    </div>
                    <p className="mt-1 text-xs text-[var(--ink-2)]">
                      {entry.user?.email ?? "unknown user"}
                    </p>
                    {formatTimestamp(entry.occurredAt) && (
                      <p className="mt-1.5 text-[11px] font-mono text-[var(--muted)]">{formatTimestamp(entry.occurredAt)}</p>
                    )}
                  </article>
                ))
              ) : (
                <p className="py-6 text-center text-sm text-[var(--muted)]">No authentication audit logs found.</p>
              )}
            </div>

            {nextAuthCursor && (
              <button
                type="button"
                onClick={() => void loadMore("authLogs")}
                disabled={loadingMore === "authLogs"}
                className="mt-4 min-h-11 w-full rounded-lg border border-[var(--hairline-strong)] bg-[var(--canvas-soft)] px-4 py-2 text-sm font-medium text-[var(--ink-2)] hover:bg-[var(--surface-2)] disabled:opacity-50"
              >
                {loadingMore === "authLogs" ? "Loading more..." : "Load more"}
              </button>
            )}
          </section>
        </div>

        {loadMoreError && (
          <p className="text-center text-sm font-medium text-[var(--red)]">{loadMoreError}</p>
        )}
      </div>
  );
}
