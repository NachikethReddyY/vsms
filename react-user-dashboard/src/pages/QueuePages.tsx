import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { NowServingCard } from "../components/queue/NowServingCard";
import { QueueHeader } from "../components/queue/QueueHeader";
import { QueueTable, toQueueItems, type QueueStatus } from "../components/queue/QueueTable";
import { StationWorkload } from "../components/queue/StationWorkload";
import { AppShell, LoadingState } from "../components/ui";
import { queueApi, sortWaitingByPriority, type EventQueueStatus } from "../features/queue/queueApi";
import { getApiError, getApiErrorCode } from "../utils/apiClient";

const PAGE_SIZE = 12;

const PERMISSION_ERROR_CODES = new Set(["CURRENT_DUTY_REQUIRED", "EVENT_ROLE_REQUIRED", "QUEUE_ACCESS_DENIED"]);

export function QueuePage() {
  const { eventId } = useParams<{ eventId: string }>();
  const { session } = useAuth();
  const roles = session?.user.roles ?? [];
  const canManagePriority = roles.includes("EVENT_MANAGER") || roles.includes("ADMINISTRATOR");

  const [status, setStatus] = useState<EventQueueStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<QueueStatus | "ALL">("ALL");
  const [currentPage, setCurrentPage] = useState(1);

  const isPermissionError = Boolean(errorCode && PERMISSION_ERROR_CODES.has(errorCode));

  const fetchQueue = useCallback(async () => {
    if (!eventId) return;
    try {
      const result = await queueApi.getEventQueueStatus(eventId);
      setStatus(result);
      setError(null);
      setErrorCode(null);
    } catch (requestError: unknown) {
      setError(getApiError(requestError, "Unable to load queue data."));
      setErrorCode(getApiErrorCode(requestError));
    } finally {
      setIsLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    void fetchQueue();
    const interval = window.setInterval(() => void fetchQueue(), 10_000);
    return () => window.clearInterval(interval);
  }, [fetchQueue]);

  const entries = useMemo(() => status?.entries ?? [], [status]);
  const queueItems = useMemo(() => toQueueItems(entries), [entries]);

  const nowServing = useMemo(
    () => entries.find((entry) => entry.status === "CALLED") ?? entries.find((entry) => entry.status === "IN_PROGRESS") ?? null,
    [entries],
  );

  const waiting = useMemo(() => sortWaitingByPriority(entries), [entries]);
  const waitingCount = entries.filter((entry) => entry.status === "WAITING").length;
  const calledCount = entries.filter((entry) => entry.status === "CALLED").length;
  const completedCount = entries.filter((entry) => entry.status === "COMPLETED").length;
  const activeCount = entries.filter((entry) => ["WAITING", "CALLED", "IN_PROGRESS"].includes(entry.status)).length;

  const runAction = async (id: string, action: () => Promise<unknown>) => {
    try {
      setActionLoading(id);
      await action();
      await fetchQueue();
    } catch (requestError: unknown) {
      setError(getApiError(requestError, "Failed to update the queue."));
    } finally {
      setActionLoading(null);
    }
  };

const handleAction = (id: string, action: "CALLED" | "STARTED" | "COMPLETED" | "SKIPPED") => {
    if (!eventId) return;
    const runners: Record<string, () => Promise<unknown>> = {
      CALLED: () => queueApi.callQueueEntry(eventId, id),
      STARTED: () => queueApi.startQueueEntry(eventId, id),
      COMPLETED: () => queueApi.completeQueueEntry(eventId, id),
      SKIPPED: () => queueApi.skipQueueEntry(eventId, id),
    };
    void runAction(id, runners[action]);
  };

  const handleSetPriority = (id: string, isPriority: boolean, notes: string | null) => {
    if (!eventId) return;
    void runAction(id, () => queueApi.updatePriority(eventId, id, isPriority, notes));
  };

  const callNext = () => {
    if (waiting[0]) handleAction(waiting[0].id, "CALLED");
  };

  const filteredQueue = useMemo(() => {
    const search = searchQuery.trim().toLowerCase();
    return queueItems.filter((item) => {
      const matchesStatus = statusFilter === "ALL" || item.status === statusFilter;
      const matchesSearch = !search
        || String(item.queueNumber).includes(search)
        || item.participantDisplayName.toLowerCase().includes(search)
        || (item.participantReference || "").toLowerCase().includes(search);
      return matchesStatus && matchesSearch;
    });
  }, [queueItems, searchQuery, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredQueue.length / PAGE_SIZE));
  const paginatedQueue = filteredQueue.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);

  if (isLoading) {
    return (
      <AppShell title="Live queue">
        <LoadingState label="Loading queue records..." />
      </AppShell>
    );
  }

  const eventName = status?.event.name ?? "";

  return (
    <AppShell title={eventName ? `${eventName} — Live queue` : "Live queue"}>
      <div className="mx-auto max-w-7xl space-y-4 px-6 pb-16 pt-2">
        {isPermissionError ? (
          <div className="rounded-xl bg-amber-50 p-5 text-sm text-amber-900" role="alert">
            <strong className="block font-semibold">You need an active queue duty to view this event&apos;s live queue.</strong>
            <span className="mt-1 block text-amber-800">
              {error}. Ask an event manager to assign you a REGISTRATION, SCREENER, or SUPPORT duty.
            </span>
          </div>
        ) : (
          <>
            <QueueHeader
              eventId={eventId}
              eventName={eventName}
              totalCount={activeCount}
              waitingCount={waitingCount}
              calledCount={calledCount}
              completedCount={completedCount}
              callNextDisabled={actionLoading !== null || waiting.length === 0}
              onCallNext={callNext}
            />

            {error && <div className="rounded-xl bg-red-50 p-4 text-sm text-red-800" role="alert">{error}</div>}

            <StationWorkload stations={status?.stations ?? []} />

            <NowServingCard
              nowServing={nowServing}
              actionLoading={actionLoading}
              onNoShow={(id) => handleAction(id, "SKIPPED")}
            />

            {entries.length === 0 ? (
              <section className="rounded-2xl border border-[#E2E1DC] bg-white p-10 text-center shadow-sm">
                <p className="text-sm font-semibold text-[#57554F]">The queue is empty</p>
                <p className="mt-1 text-sm text-[#7A7870]">
                  Join or hand off a participant to a station to start the queue.
                </p>
              </section>
            ) : (
              <QueueTable
                items={paginatedQueue}
                filteredCount={filteredQueue.length}
                searchQuery={searchQuery}
                setSearchQuery={setSearchQuery}
                statusFilter={statusFilter}
                setStatusFilter={setStatusFilter}
                currentPage={currentPage}
                setCurrentPage={setCurrentPage}
                totalPages={totalPages}
                actionLoading={actionLoading}
                canManagePriority={canManagePriority}
                onAction={handleAction}
                onSetPriority={handleSetPriority}
              />
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}

export default QueuePage;
