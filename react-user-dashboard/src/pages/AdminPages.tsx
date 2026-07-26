import { useEffect, useState } from "react";
import apiClient from "../utils/apiClient";
import { AppShell, LoadingState } from "../components/ui";

export function AuditLogsPage() {
  const [logs, setLogs] = useState<any[] | null>(null);
  const [authLogs, setAuthLogs] = useState<any[] | null>(null);

  useEffect(() => {
    void apiClient.get("/admin/audit-logs").then((response) => {
      setLogs(response.data.logs ?? []);
      setAuthLogs(response.data.authLogs ?? []);
    });
  }, []);

  if (!logs || !authLogs) {
    return (
      <AppShell title="Audit logs">
        <LoadingState label="Loading audit logs..." />
      </AppShell>
    );
  }

  return (
    <AppShell title="Audit logs">
      <div className="grid gap-6 xl:grid-cols-2">
        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="text-lg font-semibold">Application audit logs</h2>
          <div className="mt-4 space-y-3">
            {logs.map((entry) => (
              <article key={entry.id} className="rounded-xl border border-slate-200 p-3 text-sm">
                <p className="font-medium">{entry.action}</p>
                <p className="text-slate-600">
                  {entry.entityName} - {entry.user?.email ?? "unknown user"}
                </p>
              </article>
            ))}
          </div>
        </section>
        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="text-lg font-semibold">Authentication audit logs</h2>
          <div className="mt-4 space-y-3">
            {authLogs.map((entry) => (
              <article key={entry.id} className="rounded-xl border border-slate-200 p-3 text-sm">
                <p className="font-medium">{entry.eventType}</p>
                <p className="text-slate-600">
                  {entry.user?.email ?? "unknown user"} - {entry.outcome}
                </p>
              </article>
            ))}
          </div>
        </section>
      </div>
    </AppShell>
  );
}
