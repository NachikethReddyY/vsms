import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { NowServingCard } from "../components/queue/NowServingCard";
import { QueueHeader } from "../components/queue/QueueHeader";
import { QueueTable, type QueueItem, type QueueStatus } from "../components/queue/QueueTable";
import { AppShell, LoadingState } from "../components/ui";
import apiClient, { getApiError } from "../utils/apiClient";

interface RegistrationRecord {
  id: string;
  queueNumber: number | null;
  registrationStatus: QueueStatus;
  participant: {
    participantReference: string;
    firstName: string;
    lastName: string;
  };
}

interface RegistrationPage {
  registrations: RegistrationRecord[];
  pagination: { totalPages: number };
}

const PAGE_SIZE = 12;
const API_PAGE_SIZE = 100;

export function QueuePage() {
  const { eventId } = useParams<{ eventId: string }>();
  const [eventName, setEventName] = useState("");
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<QueueStatus | "ALL">("ALL");
  const [currentPage, setCurrentPage] = useState(1);

  const fetchQueue = useCallback(async () => {
    if (!eventId) return;
    try {
      const [eventResponse, firstPageResponse] = await Promise.all([
        apiClient.get(`/events/${eventId}`),
        apiClient.get<RegistrationPage>(`/events/${eventId}/registrations`, {
          params: { page: 1, pageSize: API_PAGE_SIZE },
        }),
      ]);
      const firstPage = firstPageResponse.data;
      const remainingPages = await Promise.all(
        Array.from({ length: Math.max(0, firstPage.pagination.totalPages - 1) }, (_, index) =>
          apiClient.get<RegistrationPage>(`/events/${eventId}/registrations`, {
            params: { page: index + 2, pageSize: API_PAGE_SIZE },
          }),
        ),
      );
      const registrations = [
        ...firstPage.registrations,
        ...remainingPages.flatMap((response) => response.data.registrations),
      ];

      setEventName(eventResponse.data.eventName ?? eventResponse.data.name ?? "");
      setQueue(registrations.map((registration) => ({
        id: registration.id,
        queueNumber: registration.queueNumber,
        status: registration.registrationStatus,
        participant: {
          fullName: `${registration.participant.firstName} ${registration.participant.lastName}`.trim(),
          reference: registration.participant.participantReference,
        },
      })));
      setError(null);
    } catch (requestError: unknown) {
      setError(getApiError(requestError, "Unable to load queue data."));
    } finally {
      setIsLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    void fetchQueue();
    const interval = window.setInterval(() => void fetchQueue(), 10_000);
    return () => window.clearInterval(interval);
  }, [fetchQueue]);

  const updateStatus = async (registrationId: string, status: QueueStatus, reason?: string) => {
    try {
      setActionLoading(registrationId);
      await apiClient.patch(`/registrations/${registrationId}/status`, { toStatus: status, reason });
      await fetchQueue();
    } catch (requestError: unknown) {
      setError(getApiError(requestError, "Failed to update queue status."));
    } finally {
      setActionLoading(null);
    }
  };

  const waiting = queue.filter((item) => item.status === "SIGNED_UP");
  const checkedIn = queue.filter((item) => item.status === "CHECKED_IN");
  const completed = queue.filter((item) => item.status === "COMPLETED");
  const currentServing = checkedIn[0] ?? null;

  const filteredQueue = useMemo(() => {
    const search = searchQuery.trim().toLowerCase();
    return queue.filter((item) => {
      const matchesStatus = statusFilter === "ALL" || item.status === statusFilter;
      const matchesSearch = !search
        || String(item.queueNumber ?? "").includes(search)
        || item.participant.fullName.toLowerCase().includes(search)
        || item.participant.reference.toLowerCase().includes(search);
      return matchesStatus && matchesSearch;
    });
  }, [queue, searchQuery, statusFilter]);

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

  return (
    <AppShell title={eventName ? `${eventName} — Live queue` : "Live queue"}>
      <div className="mx-auto max-w-7xl space-y-4 px-6 pb-16 pt-2">
        <QueueHeader
          eventId={eventId}
          eventName={eventName}
          totalCount={queue.length}
          waitingCount={waiting.length}
          checkedInCount={checkedIn.length}
          completedCount={completed.length}
          callNextDisabled={actionLoading !== null || waiting.length === 0}
          onCallNext={() => {
            if (waiting[0]) void updateStatus(waiting[0].id, "CHECKED_IN", "Called from queue dashboard");
          }}
        />

        {error && <div className="rounded-xl bg-red-50 p-4 text-sm text-red-800" role="alert">{error}</div>}

        <NowServingCard
          currentServing={currentServing}
          actionLoading={actionLoading}
          onComplete={(id) => void updateStatus(id, "COMPLETED", "Completed from queue dashboard")}
          onNoShow={(id) => void updateStatus(id, "CANCELLED", "No show")}
        />

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
          onStatusChange={(id, status, reason) => void updateStatus(id, status, reason)}
        />
      </div>
    </AppShell>
  );
}
