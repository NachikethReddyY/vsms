import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import apiClient from "../utils/apiClient";
import type { EventSummary } from "../types";
import { AppShell, LoadingState } from "../components/ui";

export function DashboardPage() {
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function loadEvents() {
      try {
        const response = await apiClient.get("/events/active");
        if (active) {
          setEvents(response.data.events ?? []);
        }
      } catch (rawError: any) {
        if (active) {
          setError(rawError.response?.data?.error ?? "Unable to load events.");
        }
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    }

    void loadEvents();
    return () => {
      active = false;
    };
  }, []);

  return (
    <AppShell title="Registration dashboard">
      <div className="grid gap-6 lg:grid-cols-[1.3fr,0.7fr]">
        <section className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <h2 className="text-lg font-semibold">Active events</h2>
            <p className="mt-1 text-sm text-slate-600">Choose an event, then continue into participant search or creation.</p>
          </div>
          {isLoading ? <LoadingState label="Loading event list..." /> : null}
          {error ? <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div> : null}
          {!isLoading && events.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-600">
              No active events are currently available in the database.
            </div>
          ) : null}
          {events.map((event) => (
            <article key={event.id} className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold">{event.eventName}</h3>
                  <p className="text-sm text-slate-600">
                    {event.location} - {new Date(event.eventDate).toLocaleDateString()}
                  </p>
                </div>
                <span className="rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold text-white">{event.status}</span>
              </div>
              <div className="mt-4 flex flex-wrap gap-3">
                <Link className="rounded-xl bg-slate-900 px-4 py-2 text-sm text-white" to={`/events/${event.id}/register`}>
                  Start registration
                </Link>
                <Link className="rounded-xl border border-slate-300 px-4 py-2 text-sm text-slate-700" to={`/participants/search?eventId=${event.id}`}>
                  Search participant
                </Link>
              </div>
            </article>
          ))}
        </section>
        <aside className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <h2 className="text-lg font-semibold">Implementation notes</h2>
            <ul className="mt-3 space-y-2 text-sm text-slate-600">
              <li>Auth is routed through backend Cognito endpoints.</li>
              <li>Local Prisma users are created after verification and synced on login.</li>
              <li>Participant, consent, and registration flows are wired with plain pages first.</li>
            </ul>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <h2 className="text-lg font-semibold">Quick links</h2>
            <div className="mt-3 grid gap-2 text-sm">
              <Link to="/participants/new" className="rounded-xl border border-slate-300 px-3 py-2">
                Create participant directly
              </Link>
              <Link to="/cognito-test" className="rounded-xl border border-slate-300 px-3 py-2">
                Cognito test page
              </Link>
            </div>
          </div>
        </aside>
      </div>
    </AppShell>
  );
}
