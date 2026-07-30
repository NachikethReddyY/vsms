import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import apiClient, { getApiError } from "../utils/apiClient";
import type { EventSummary } from "../types";
import { AppShell, LoadingState } from "../components/ui";
import { useAuth } from "../auth/AuthProvider";

const eventStatusLabels: Record<string, string> = {
  DRAFT: "Draft",
  PUBLISHED: "Published",
  IN_PROGRESS: "In progress",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

export function DashboardPage() {
  const { session } = useAuth();
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiClient.get("/events/active")
      .then((response) => setEvents(response.data.events ?? []))
      .catch((requestError: unknown) => setError(getApiError(requestError, "Unable to load events.")))
      .finally(() => setIsLoading(false));
  }, []);

  return (
    <AppShell title="Registration dashboard">
      <div className="space-y-6">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 registration-surface">
          <p className="text-sm text-slate-500">Welcome</p>
          <h2 className="text-xl font-semibold">{session?.user.fullName}</h2>
          <p className="mt-1 text-sm text-slate-600">Select an open event to register, search, or review participants.</p>
        </section>
        {isLoading ? <LoadingState label="Loading active events…" /> : null}
        {error ? <div className="rounded-xl bg-red-50 p-4 text-sm text-red-800">{error}</div> : null}
        <section className="grid gap-4 lg:grid-cols-2">
          {events.map((event) => (
            <article key={event.id} className="rounded-2xl border border-slate-200 bg-white p-5 registration-surface">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold">{event.eventName}</h3>
                  <p className="text-sm text-slate-600">{event.location} · {new Date(event.eventDate).toLocaleDateString()}</p>
                  <p className="mt-2 text-sm">{event._count?.eventRegistrations ?? 0} registered</p>
                </div>
                <span className="event-status-badge">{eventStatusLabels[event.status] ?? event.status}</span>
              </div>
              <div className="mt-4 flex flex-wrap gap-3">
                <Link className="dashboard-primary-action" to={`/events/${event.id}/register`}>Register participant</Link>
                <Link className="secondary" to={`/participants/search?eventId=${event.id}`}>Search participant</Link>
                <Link className="secondary" to={`/events/${event.id}/registrations`}>View registrations</Link>
              </div>
            </article>
          ))}
        </section>
      </div>
    </AppShell>
  );
}
