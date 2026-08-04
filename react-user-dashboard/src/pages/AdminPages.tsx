import { useEffect, useState } from "react";
import apiClient from "../utils/apiClient";
import { LoadingState } from "../components/ui";

type AuditEntry = {
  id: string;
  action: string;
  entityName: string;
  outcome: string;
  timestamp?: string;
  user?: { email?: string } | null;
};

type AuthAuditEntry = {
  id: string;
  eventType: string;
  outcome: string;
  timestamp?: string;
  user?: { email?: string } | null;
};

export function AuditLogsPage() {
  const [logs, setLogs] = useState<AuditEntry[] | null>(null);
  const [authLogs, setAuthLogs] = useState<AuthAuditEntry[] | null>(null);
  const [isRestricted, setIsRestricted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiClient
      .get("/admin/audit-logs")
      .then((response) => {
        setLogs(response.data.logs ?? []);
        setAuthLogs(response.data.authLogs ?? []);
      })
      .catch((err) => {
        if (err?.response?.status === 403) {
          setIsRestricted(true);
        } else {
          setError(err?.response?.data?.message || "Failed to load audit logs.");
        }
      });
  }, []);

  // Helper function to render status badges for outcomes
  const renderBadge = (outcome: string) => {
    const normalized = outcome.toLowerCase();
    const isSuccess = normalized.includes("success") || normalized.includes("allow");
    return (
      <span
        className={`inline-block rounded px-2 py-0.5 text-xs font-semibold tracking-wide uppercase ${
          isSuccess
            ? "bg-emerald-100 text-emerald-800 border border-emerald-200"
            : "bg-red-100 text-red-800 border border-red-200"
        }`}
      >
        {outcome}
      </span>
    );
  };

  // 1. Restricted View (User is not an Administrator)
  if (isRestricted) {
    return (
        <div className="page-frame narrow audit-hub flex min-h-[60vh] items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl border border-red-500/30 bg-red-950/10 p-8 text-center shadow-lg">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-red-500">
              RESTRICTED
            </h2>
            <p className="mt-2 text-sm text-slate-300 leading-relaxed">
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
        <div className="page-frame narrow audit-hub p-6 text-center text-sm font-medium text-red-500">
          {error}
        </div>
    );
  }

  // 3. Loading State
  if (!logs || !authLogs) {
    return <LoadingState label="Loading audit logs..." />;
  }

  // 4. Authorized View
  return (
      <div className="page-frame narrow audit-hub space-y-6">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Audit Logs Hub</h1>
          <p className="text-sm text-slate-500">
            Monitor administrative activities and authentication logs across the system.
          </p>
        </div>

        <div className="grid gap-6 xl:grid-cols-2">
          {/* Application Audit Logs Section */}
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h2 className="text-lg font-semibold text-slate-900">Application audit logs</h2>
              <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">
                {logs.length}
              </span>
            </div>

            <div className="mt-4 space-y-3">
              {logs.length > 0 ? (
                logs.map((entry) => (
                  <article key={entry.id} className="rounded-xl border border-slate-200 p-3 text-sm hover:border-slate-300 transition-colors">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-medium text-slate-900">{entry.action}</p>
                      {entry.outcome && renderBadge(entry.outcome)}
                    </div>
                    <p className="mt-1 text-xs text-slate-600">
                      <span className="font-semibold text-slate-800">{entry.entityName}</span> - {entry.user?.email ?? "unknown user"}
                    </p>
                    {entry.timestamp && (
                      <p className="mt-1.5 text-[11px] font-mono text-slate-400">{entry.timestamp}</p>
                    )}
                  </article>
                ))
              ) : (
                <p className="py-6 text-center text-sm text-slate-400">No application audit logs found.</p>
              )}
            </div>
          </section>

          {/* Authentication Audit Logs Section */}
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h2 className="text-lg font-semibold text-slate-900">Authentication audit logs</h2>
              <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">
                {authLogs.length}
              </span>
            </div>

            <div className="mt-4 space-y-3">
              {authLogs.length > 0 ? (
                authLogs.map((entry) => (
                  <article key={entry.id} className="rounded-xl border border-slate-200 p-3 text-sm hover:border-slate-300 transition-colors">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-medium text-slate-900">{entry.eventType}</p>
                      {entry.outcome && renderBadge(entry.outcome)}
                    </div>
                    <p className="mt-1 text-xs text-slate-600">
                      {entry.user?.email ?? "unknown user"}
                    </p>
                    {entry.timestamp && (
                      <p className="mt-1.5 text-[11px] font-mono text-slate-400">{entry.timestamp}</p>
                    )}
                  </article>
                ))
              ) : (
                <p className="py-6 text-center text-sm text-slate-400">No authentication audit logs found.</p>
              )}
            </div>
          </section>
        </div>
      </div>
  );
}
