import { useEffect, useState, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import apiClient, { getApiError } from "../utils/apiClient";
import { AppShell, LoadingState } from "../components/ui";

interface QueueItem {
  id: string;
  ticketNumber: string;
  status: string;
  position: number;
  participant: {
    fullName: string;
    email?: string;
  };
}

interface EventQueueData {
  eventId: string;
  eventName: string;
  currentServing: QueueItem | null;
  queue: QueueItem[];
}

export function QueuePage() {
  const { eventId } = useParams<{ eventId: string }>();
  const [queueData, setQueueData] = useState<EventQueueData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchQueue = useCallback(async () => {
    try {
      const response = await apiClient.get(`/events/${eventId}/queue`);
      setQueueData(response.data);
      setError(null);
    } catch (requestError: unknown) {
      setError(getApiError(requestError, "Unable to load queue data."));
    } finally {
      setIsLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    fetchQueue();
    // Poll the queue status every 10 seconds to keep it synchronized in real-time
    const interval = setInterval(fetchQueue, 10000);
    return () => clearInterval(interval);
  }, [fetchQueue]);

  const handleNextInQueue = async () => {
    if (!eventId) return;
    try {
      setActionLoading("next");
      await apiClient.post(`/events/${eventId}/queue/next`);
      await fetchQueue();
    } catch (requestError: unknown) {
      setError(getApiError(requestError, "Failed to advance queue."));
    } finally {
      setActionLoading(null);
    }
  };

  const handleUpdateStatus = async (queueId: string, status: string) => {
    try {
      setActionLoading(queueId);
      await apiClient.patch(`/queue/${queueId}/status`, { status });
      await fetchQueue();
    } catch (requestError: unknown) {
      setError(getApiError(requestError, "Failed to update queue item status."));
    } finally {
      setActionLoading(null);
    }
  };

  if (isLoading) {
    return (
      <AppShell title="Live Queue">
        <LoadingState label="Loading queue details..." />
      </AppShell>
    );
  }

  return (
    <AppShell title={queueData?.eventName ? `${queueData.eventName} — Live Queue` : "Live Queue"}>
      <div className="space-y-6">
        {/* Navigation & Header Actions */}
        <div className="flex items-center justify-between">
          <Link
            to={`/events/${eventId}/registrations`}
            className="text-sm font-medium text-slate-600 hover:text-slate-900"
          >
            ← Back to Registrations
          </Link>
          <button
            onClick={handleNextInQueue}
            disabled={actionLoading === "next" || !queueData?.queue.length}
            className="dashboard-primary-action disabled:opacity-50"
          >
            {actionLoading === "next" ? "Calling..." : "Call Next Participant"}
          </button>
        </div>

        {error && (
          <div className="rounded-xl bg-red-50 p-4 text-sm text-red-800">
            {error}
          </div>
        )}

        {/* Currently Serving Banner */}
        <section className="rounded-2xl border border-blue-200 bg-blue-50 p-6 registration-surface">
          <p className="text-xs font-semibold uppercase tracking-wider text-blue-600">Now Serving</p>
          {queueData?.currentServing ? (
            <div className="mt-2 flex items-center justify-between">
              <div>
                <h2 className="text-3xl font-bold text-blue-900">
                  {queueData.currentServing.ticketNumber}
                </h2>
                <p className="mt-1 text-lg font-medium text-blue-800">
                  {queueData.currentServing.participant.fullName}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => handleUpdateStatus(queueData.currentServing!.id, "COMPLETED")}
                  disabled={actionLoading === queueData.currentServing.id}
                  className="rounded-xl bg-green-600 px-4 py-2 text-sm font-medium text-white shadow hover:bg-green-700 disabled:opacity-50"
                >
                  Complete
                </button>
                <button
                  onClick={() => handleUpdateStatus(queueData.currentServing!.id, "NO_SHOW")}
                  disabled={actionLoading === queueData.currentServing.id}
                  className="rounded-xl bg-amber-600 px-4 py-2 text-sm font-medium text-white shadow hover:bg-amber-700 disabled:opacity-50"
                >
                  No Show
                </button>
              </div>
            </div>
          ) : (
            <p className="mt-2 text-sm text-blue-700">No participant is currently being served.</p>
          )}
        </section>

        {/* Upcoming Queue List */}
        <section className="rounded-2xl border border-slate-200 bg-white p-5 registration-surface">
          <h3 className="text-lg font-semibold text-slate-800">Upcoming in Queue</h3>
          <div className="mt-4 divide-y divide-slate-100">
            {queueData?.queue && queueData.queue.length > 0 ? (
              queueData.queue.map((item, index) => (
                <div key={item.id} className="flex items-center justify-between py-3">
                  <div className="flex items-center gap-4">
                    <span className="text-sm font-semibold text-slate-400">#{index + 1}</span>
                    <div>
                      <p className="font-semibold text-slate-800">{item.ticketNumber}</p>
                      <p className="text-sm text-slate-600">{item.participant.fullName}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                      {item.status}
                    </span>
                    <button
                      onClick={() => handleUpdateStatus(item.id, "CANCELLED")}
                      disabled={actionLoading === item.id}
                      className="text-xs text-red-600 hover:underline disabled:opacity-50"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <p className="py-4 text-center text-sm text-slate-500">The queue is currently empty.</p>
            )}
          </div>
        </section>
      </div>
    </AppShell>
  );
}