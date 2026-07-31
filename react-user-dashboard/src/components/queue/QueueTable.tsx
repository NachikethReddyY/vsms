import type { Dispatch, SetStateAction } from "react";

export type QueueStatus = "SIGNED_UP" | "CHECKED_IN" | "COMPLETED" | "CANCELLED";

export interface QueueItem {
  id: string;
  queueNumber: number | null;
  status: QueueStatus;
  participant: {
    fullName: string;
    reference: string;
  };
}

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
  onStatusChange: (id: string, status: QueueStatus, reason?: string) => void;
}

const statusLabel = (status: QueueStatus) => status.replace("_", " ").toLowerCase();

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
  onStatusChange,
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
          <option value="ALL">All statuses</option>
          <option value="SIGNED_UP">Waiting</option>
          <option value="CHECKED_IN">Checked in</option>
          <option value="COMPLETED">Completed</option>
          <option value="CANCELLED">Cancelled</option>
        </select>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-[#EEEDEA] bg-[#FCFCFB] text-xs uppercase tracking-wider text-[#7A7870]">
              <th className="px-4 py-3">Queue</th>
              <th className="px-4 py-3">Participant</th>
              <th className="px-4 py-3">Reference</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#EEEDEA]">
            {items.map((item) => (
              <tr key={item.id} className="hover:bg-[#FDFDFC]">
                <td className="px-4 py-3.5 font-mono font-semibold">#{item.queueNumber ?? "—"}</td>
                <td className="px-4 py-3.5 font-semibold">{item.participant.fullName}</td>
                <td className="px-4 py-3.5 font-mono text-[#7A7870]">{item.participant.reference}</td>
                <td className="px-4 py-3.5">
                  <span className="rounded-full bg-[#F3F2EE] px-2.5 py-1 text-xs font-semibold capitalize">
                    {statusLabel(item.status)}
                  </span>
                </td>
                <td className="px-4 py-3.5 text-right">
                  {item.status === "SIGNED_UP" && (
                    <button
                      type="button"
                      disabled={actionLoading === item.id}
                      onClick={() => onStatusChange(item.id, "CHECKED_IN", "Called from queue dashboard")}
                      className="font-semibold text-blue-600 disabled:opacity-50"
                    >
                      Call
                    </button>
                  )}
                  {item.status === "CHECKED_IN" && (
                    <span className="inline-flex gap-3">
                      <button
                        type="button"
                        disabled={actionLoading === item.id}
                        onClick={() => onStatusChange(item.id, "COMPLETED", "Completed from queue dashboard")}
                        className="font-semibold text-emerald-700 disabled:opacity-50"
                      >
                        Complete
                      </button>
                      <button
                        type="button"
                        disabled={actionLoading === item.id}
                        onClick={() => onStatusChange(item.id, "CANCELLED", "No show")}
                        className="font-semibold text-amber-700 disabled:opacity-50"
                      >
                        No show
                      </button>
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center text-[#7A7870]">
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
            onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
            className="rounded-lg border px-3 py-1.5 disabled:opacity-40"
          >
            Previous
          </button>
          <span>Page {currentPage} of {totalPages}</span>
          <button
            type="button"
            disabled={currentPage === totalPages}
            onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
            className="rounded-lg border px-3 py-1.5 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </footer>
    </section>
  );
}
