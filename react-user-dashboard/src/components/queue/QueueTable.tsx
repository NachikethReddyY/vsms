import { useState } from "react";
import { CheckCircleIcon, ClockIcon, ShieldCheckIcon } from "@heroicons/react/24/outline";

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
  setCurrentPage: (page: number) => void;
  totalPages: number;
  actionLoading: string | null;
  onStatusChange: (id: string, status: QueueStatus, reason?: string) => void;
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
  onStatusChange,
}: QueueTableProps) {
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);

  const toggleRow = (id: string) => {
    setExpandedRowId(expandedRowId === id ? null : id);
  };

  return (
    <div className="bg-white border border-[#E2E1DC] rounded-2xl shadow-xs overflow-hidden">
      
      {/* Filter Toolbar */}
      <div className="p-4 border-b border-[#EEEDEA] flex flex-col sm:flex-row items-center justify-between gap-3 bg-[#F9F9F8]">
        <div className="w-full sm:w-72">
          <input
            type="text"
            placeholder="Search queue number, name, or reference..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-xl border border-[#DCDAD2] bg-white px-3.5 py-2 text-xs text-[#1A1916] placeholder-[#8C8A81] focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
          />
        </div>

        <div className="flex items-center gap-2.5 w-full sm:w-auto justify-end">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as QueueStatus | "ALL")}
            className="rounded-xl border border-[#DCDAD2] bg-white px-3 py-2 text-xs text-[#1A1916] focus:outline-none"
          >
            <option value="ALL">All Statuses</option>
            <option value="SIGNED_UP">Signed Up</option>
            <option value="CHECKED_IN">Checked In</option>
            <option value="COMPLETED">Completed</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
        </div>
      </div>

      {/* Table Structure */}
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-[#EEEDEA] bg-[#FCFCFB] text-[11px] font-semibold text-[#7A7870] uppercase tracking-wider">
              <th className="py-3 px-4">Queue #</th>
              <th className="py-3 px-4">Participant</th>
              <th className="py-3 px-4">Status</th>
              <th className="py-3 px-4 text-center">Inspector Stations</th>
              <th className="py-3 px-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#EEEDEA] text-xs text-[#26251E]">
            {items.length > 0 ? (
              items.map((item) => {
                const isExpanded = expandedRowId === item.id;
                const isLoadingRow = actionLoading === item.id;
                
                return (
                  <>
                    <tr key={item.id} className="hover:bg-[#FDFDFC] transition-colors">
                      <td className="py-3.5 px-4 font-mono font-semibold text-[#1A1916]">
                        {item.queueNumber !== null ? `#${item.queueNumber}` : "—"}
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="font-semibold text-[#1A1916]">{item.participant.fullName}</div>
                        <div className="text-[11px] text-[#7A7870]">{item.participant.reference}</div>
                      </td>
                      <td className="py-3.5 px-4">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold tracking-wide ${
                          item.status === "SIGNED_UP" ? "bg-blue-50 text-blue-700" :
                          item.status === "CHECKED_IN" ? "bg-amber-50 text-amber-700" :
                          item.status === "COMPLETED" ? "bg-emerald-50 text-emerald-700" :
                          "bg-rose-50 text-rose-700"
                        }`}>
                          {item.status}
                        </span>
                      </td>

                      {/* Inspector Column Toggle Button */}
                      <td className="py-3.5 px-4 text-center">
                        <button
                          onClick={() => toggleRow(item.id)}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-[#DCDAD2] bg-white text-[11px] font-medium text-[#4A4843] hover:bg-[#F3F2EE] transition-all cursor-pointer"
                        >
                          <ShieldCheckIcon className="w-3.5 h-3.5 text-blue-600" />
                          <span>{isExpanded ? "Hide Stations" : "View Stations"}</span>
                        </button>
                      </td>

                      <td className="py-3.5 px-4 text-right space-x-3">
                        <button 
                          disabled={isLoadingRow}
                          onClick={() => onStatusChange(item.id, "CHECKED_IN", "Manual call from table")}
                          className="font-medium text-blue-600 hover:text-blue-800 disabled:opacity-50 cursor-pointer"
                        >
                          Call
                        </button>
                        <button 
                          disabled={isLoadingRow}
                          onClick={() => onStatusChange(item.id, "CANCELLED", "Marked cancelled from table")}
                          className="font-medium text-rose-600 hover:text-rose-800 disabled:opacity-50 cursor-pointer"
                        >
                          Cancel
                        </button>
                      </td>
                    </tr>

                    {/* Expandable Station Checklist Drawer per Row */}
                    {isExpanded && (
                      <tr className="bg-[#F9F9F8]">
                        <td colSpan={5} className="px-6 py-4 border-b border-[#EEEDEA]">
                          <div className="space-y-3">
                            <div className="text-[11px] font-bold text-[#1A1916] uppercase tracking-wider flex items-center gap-1.5">
                              <ShieldCheckIcon className="w-4 h-4 text-blue-600" />
                              <span>Station Checklist for {item.participant.fullName}</span>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
                              {["Visual Acuity", "Refraction", "Colour Vision", "Eye Health", "Clinical Review"].map((stName, idx) => {
                                const isDone = idx < 2; 
                                const isCurrent = idx === 2;

                                return (
                                  <div 
                                    key={idx} 
                                    className={`p-2.5 rounded-xl border flex items-center justify-between sm:flex-col sm:items-start sm:gap-2 ${
                                      isDone ? "bg-emerald-50/50 border-emerald-200 text-emerald-900" :
                                      isCurrent ? "bg-blue-50/70 border-blue-200 text-blue-900" :
                                      "bg-white border-[#EEEDEA] text-[#7A7870]"
                                    }`}
                                  >
                                    <div className="flex items-center gap-1.5">
                                      {isDone ? (
                                        <CheckCircleIcon className="w-3.5 h-3.5 text-emerald-600" />
                                      ) : isCurrent ? (
                                        <ClockIcon className="w-3.5 h-3.5 text-blue-600 animate-pulse" />
                                      ) : (
                                        <div className="w-3.5 h-3.5 rounded-full border border-dashed border-[#C2C0B6]" />
                                      )}
                                      <span className="text-[11px] font-semibold">{stName}</span>
                                    </div>
                                    <span className="text-[9px] uppercase font-bold px-1.5 py-0.5 rounded bg-white/60">
                                      {isDone ? "Done" : isCurrent ? "Active" : "Pending"}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })
            ) : (
              <tr>
                <td colSpan={5} className="py-12 text-center text-[#7A7870]">
                  No matching queue records found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Footer */}
      <div className="p-4 border-t border-[#EEEDEA] flex items-center justify-between bg-white text-xs text-[#7A7870]">
        <div>
          Showing <span className="font-semibold text-[#1A1916]">{items.length}</span> of <span className="font-semibold text-[#1A1916]">{filteredCount}</span> entries
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setCurrentPage(Math.max(currentPage - 1, 1))}
            disabled={currentPage === 1}
            className="px-3 py-1.5 rounded-lg border border-[#DCDAD2] bg-white text-[#26251E] disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#F9F9F8] transition-all"
          >
            Previous
          </button>
          <span className="px-2 font-medium text-[#1A1916]">
            Page {currentPage} of {totalPages}
          </span>
          <button
            onClick={() => setCurrentPage(Math.min(currentPage + 1, totalPages))}
            disabled={currentPage === totalPages}
            className="px-3 py-1.5 rounded-lg border border-[#DCDAD2] bg-white text-[#26251E] disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#F9F9F8] transition-all"
          >
            Next
          </button>
        </div>
      </div>

    </div>
  );
}