import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import apiClient, { getApiError } from "../utils/apiClient";
import type { EventSummary } from "../types";
import { AppShell, LoadingState } from "../components/ui";
import { useAuth } from "../auth/AuthProvider";

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
        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <p className="text-sm text-slate-500">Welcome</p>
          <h2 className="text-xl font-semibold">{session?.user.fullName}</h2>
          <p className="mt-1 text-sm text-slate-600">Select an open event to register, search, or review participants.</p>
        </section>
        {isLoading ? <LoadingState label="Loading active events…" /> : null}
        {error ? <div className="rounded-xl bg-red-50 p-4 text-sm text-red-800">{error}</div> : null}
        <section className="grid gap-4 lg:grid-cols-2">
          {events.map((event) => (
            <article key={event.id} className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold">{event.eventName}</h3>
                  <p className="text-sm text-slate-600">{event.location} · {new Date(event.eventDate).toLocaleDateString()}</p>
                  <p className="mt-2 text-sm">{event._count?.eventRegistrations ?? 0} registered</p>
                </div>
                <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-900">{event.status}</span>
              </div>
              <div className="mt-4 flex flex-wrap gap-3">
                <Link className="rounded-xl bg-slate-900 px-4 py-2 text-sm text-white" to={`/events/${event.id}/register`}>Register participant</Link>
                <Link className="rounded-xl border border-slate-300 px-4 py-2 text-sm" to={`/participants/search?eventId=${event.id}`}>Search participant</Link>
                <Link className="rounded-xl border border-slate-300 px-4 py-2 text-sm" to={`/events/${event.id}/registrations`}>View registrations</Link>
              </div>
            </article>
          ))}
        </section>
      </div>
    </AppShell>
  );
}
