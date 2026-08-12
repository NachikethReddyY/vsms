/* eslint-disable react-refresh/only-export-components */
import { Dispatch, FormEvent, SetStateAction, useState } from "react";
import type { QueueEntry } from "../../features/queue/queueApi";

export type QueueStatus = "WAITING" | "CALLED" | "IN_PROGRESS" | "COMPLETED" | "SKIPPED" | "CANCELLED";

export interface QueueItem {
  id: string;
  registrationId: string;
  queueNumber: number;
  status: QueueStatus;
  isPriority: boolean;
  priorityNotes: string | null;
  participantDisplayName: string;
  participantReference: string | null;
  stationName: string;
}

type QueueAction = "CALLED" | "STARTED" | "SKIPPED";

interface QueueTableProps {
  items: QueueItem[];
  filteredCount: number;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  statusFilter: QueueStatus | "ALL";
  setStatusFilter: (status: QueueStatus | "ALL") => void;
  currentPage: number;
  setCurrentPage: Dispatch<SetStateAction<number>>;
  totalPages: number;
  actionLoading: string | null;
  canManagePriority: boolean;
  canOverrideRoute: boolean;
  onAction: (id: string, action: QueueAction) => void;
  onSetPriority: (id: string, isPriority: boolean, notes: string | null) => void;
  onEditRoute: (registrationId: string) => void;
}

const statusLabel = (status: QueueStatus) => status.replace("_", " ").toLowerCase();

const STATUS_OPTIONS: Array<{ value: QueueStatus | "ALL"; label: string }> = [
  { value: "ALL", label: "All statuses" },
  { value: "WAITING", label: "Waiting" },
  { value: "CALLED", label: "Called" },
  { value: "IN_PROGRESS", label: "In progress" },
  { value: "COMPLETED", label: "Completed" },
  { value: "SKIPPED", label: "Skipped" },
  { value: "CANCELLED", label: "Cancelled" },
];

function StatusBadge({ status }: { status: QueueStatus }) {
  const palette: Record<QueueStatus, string> = {
    WAITING: "bg-[#F3F2EE] text-[#6B6970]",
    CALLED: "bg-blue-100 text-blue-800",
    IN_PROGRESS: "bg-emerald-100 text-emerald-800",
    COMPLETED: "bg-[#E7E5DE] text-[#57554F]",
    SKIPPED: "bg-amber-100 text-amber-800",
    CANCELLED: "bg-red-50 text-red-700",
  };
  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${palette[status]}`}>
      {statusLabel(status)}
    </span>
  );
}

function PriorityEditor({
  item,
  canManagePriority,
  actionLoading,
  onSetPriority,
}: {
  item: QueueItem;
  canManagePriority: boolean;
  actionLoading: string | null;
  onSetPriority: (id: string, isPriority: boolean, notes: string | null) => void;
}) {
  const [drafting, setDrafting] = useState(false);
  const [reason, setReason] = useState(item.priorityNotes || "");
  const [validationError, setValidationError] = useState<string | null>(null);

  if (!canManagePriority) {
    return item.isPriority ? (
      <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-800">Priority</span>
    ) : null;
  }

  if (drafting) {
    const confirm = (event: FormEvent) => {
      event.preventDefault();
      if (!reason.trim()) {
        setValidationError("A reason is required to mark this entry as priority.");
        return;
      }
      onSetPriority(item.id, true, reason.trim());
      setDrafting(false);
      setValidationError(null);
    };
    return (
      <form onSubmit={confirm} className="flex flex-col items-end gap-1.5">
        <input
          autoFocus
          type="text"
          aria-label={`Priority reason for queue ${item.queueNumber}`}
          placeholder="Reason required"
          value={reason}
          onChange={(event) => {
            setReason(event.target.value);
            if (validationError) setValidationError(null);
          }}
          className="w-40 rounded-lg border border-[#DCDAD2] px-2 py-1 text-xs"
        />
        {validationError && <p className="text-xs text-red-700">{validationError}</p>}
        <span className="flex gap-2">
          <button type="submit" disabled={actionLoading === item.id} className="text-xs font-semibold text-amber-800 disabled:opacity-50">
            Confirm priority
          </button>
          <button
            type="button"
            onClick={() => {
              setDrafting(false);
              setReason(item.priorityNotes || "");
              setValidationError(null);
            }}
            className="text-xs text-[#7A7870]"
          >
            Cancel
          </button>
        </span>
      </form>
    );
  }

  return (
    <span className="inline-flex gap-2">
      {item.isPriority && (
        <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-800">Priority</span>
      )}
      <button
        type="button"
        disabled={actionLoading === item.id}
        onClick={() => {
          if (item.isPriority) {
            onSetPriority(item.id, false, null);
          } else {
            setDrafting(true);
          }
        }}
        className="text-xs font-semibold text-amber-800 disabled:opacity-50"
      >
        {item.isPriority ? "Clear priority" : "Priority"}
      </button>
    </span>
  );
}

export function QueueTable({
  items,
  filteredCount,
  searchQuery,
  setSearchQuery,
  statusFilter,
  setStatusFilter,
  currentPage,
  setCurrentPage,
  totalPages,
  actionLoading,
  canManagePriority,
  canOverrideRoute,
  onAction,
  onSetPriority,
  onEditRoute,
}: QueueTableProps) {
  return (
    <section className="overflow-hidden rounded-2xl border border-[#E2E1DC] bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-[#EEEDEA] bg-[#F9F9F8] p-4 sm:flex-row sm:items-center sm:justify-between">
        <input
          type="search"
          aria-label="Search queue"
          placeholder="Search by queue, name, or reference"
          value={searchQuery}
          onChange={(event) => {
            setSearchQuery(event.target.value);
            setCurrentPage(1);
          }}
          className="w-full rounded-xl border border-[#DCDAD2] bg-white px-3.5 py-2 text-sm sm:max-w-sm"
        />
        <select
          aria-label="Filter queue by status"
          value={statusFilter}
          onChange={(event) => {
            setStatusFilter(event.target.value as QueueStatus | "ALL");
            setCurrentPage(1);
          }}
          className="rounded-xl border border-[#DCDAD2] bg-white px-3 py-2 text-sm"
        >
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-[#EEEDEA] bg-[#FCFCFB] text-xs uppercase tracking-wider text-[#7A7870]">
              <th className="px-4 py-3">Queue</th>
              <th className="px-4 py-3">Participant</th>
              <th className="px-4 py-3">Reference</th>
              <th className="px-4 py-3">Station</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Priority</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#EEEDEA]">
            {items.map((item) => (
              <tr key={item.id} className="hover:bg-[#FDFDFC]">
                <td className="px-4 py-3.5 font-mono font-semibold">#{item.queueNumber}</td>
                <td className="px-4 py-3.5 font-semibold">{item.participantDisplayName}</td>
                <td className="px-4 py-3.5 font-mono text-[#7A7870]">{item.participantReference || "—"}</td>
                <td className="px-4 py-3.5 text-[#57554F]">{item.stationName || "—"}</td>
                <td className="px-4 py-3.5">
                  <StatusBadge status={item.status} />
                </td>
                <td className="px-4 py-3.5">
                  <PriorityEditor
                    item={item}
                    canManagePriority={canManagePriority}
                    actionLoading={actionLoading}
                    onSetPriority={onSetPriority}
                  />
                </td>
                <td className="px-4 py-3.5 text-right">
                  {item.status === "WAITING" && (
                    <button
                      type="button"
                      disabled={actionLoading === item.id}
                      onClick={() => onAction(item.id, "CALLED")}
                      className="font-semibold text-blue-600 disabled:opacity-50"
                    >
                      Call
                    </button>
                  )}
                  {item.status === "CALLED" && (
                    <span className="inline-flex gap-3">
                      <button
                        type="button"
                        disabled={actionLoading === item.id}
                        onClick={() => onAction(item.id, "STARTED")}
                        className="font-semibold text-emerald-700 disabled:opacity-50"
                      >
                        Start
                      </button>
                      <button
                        type="button"
                        disabled={actionLoading === item.id}
                        onClick={() => onAction(item.id, "SKIPPED")}
                        className="font-semibold text-amber-700 disabled:opacity-50"
                      >
                        No show
                      </button>
                    </span>
                  )}
                  {item.status === "IN_PROGRESS" && <span className="text-xs text-[#7A7870]">Save result at station</span>}
                  {canOverrideRoute && ["WAITING", "CALLED", "IN_PROGRESS"].includes(item.status) && <button type="button" className="ml-3 min-h-11 font-semibold text-blue-700" onClick={() => onEditRoute(item.registrationId)}>Edit route</button>}
                  {["COMPLETED", "SKIPPED", "CANCELLED"].includes(item.status) && (
                    <span className="text-[#A5A29A]">—</span>
                  )}
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-[#7A7870]">
                  No matching queue records.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <footer className="flex items-center justify-between border-t border-[#EEEDEA] p-4 text-xs text-[#7A7870]">
        <span>{filteredCount} matching entries</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={currentPage === 1}
            onClick={() => setCurrentPage((page: number) => Math.max(1, page - 1))}
            className="rounded-lg border px-3 py-1.5 disabled:opacity-40"
          >
            Previous
          </button>
          <span>Page {currentPage} of {totalPages}</span>
          <button
            type="button"
            disabled={currentPage === totalPages}
            onClick={() => setCurrentPage((page: number) => Math.min(totalPages, page + 1))}
            className="rounded-lg border px-3 py-1.5 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </footer>
    </section>
  );
}

export function toQueueItems(entries: QueueEntry[]): QueueItem[] {
  return entries.map((entry) => ({
    id: entry.id,
    registrationId: entry.registrationId,
    queueNumber: entry.queueNumber,
    status: entry.status,
    isPriority: entry.isPriority,
    priorityNotes: entry.priorityNotes ?? null,
    participantDisplayName: entry.participantDisplayName || "Unnamed participant",
    participantReference: entry.participantReference ?? null,
    stationName: entry.stationName || "—",
  }));
}
