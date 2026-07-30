import { useState } from "react";
import { CheckCircleIcon, ClockIcon, ShieldCheckIcon } from "@heroicons/react/24/outline";

interface QueueItem {
  id: string;
  ticketNumber: string;
  status: "WAITING" | "IN_SERVICE" | "COMPLETED" | "NO_SHOW" | "CANCELLED";
  station: string;
  waitTime: string;
  position: number;
  participant: {
    fullName: string;
    age: number;
    idNumber: string;
  };
}

interface QueueTableProps {
  paginatedQueue: QueueItem[];
  filteredQueueLength: number;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  selectedStation: string;
  setSelectedStation: (station: string) => void;
  statusFilter: string;
  setStatusFilter: (status: string) => void;
  currentPage: number;
  setCurrentPage: (page: number) => void;
  totalPages: number;
  pageSize: number;
  onCall: (id: string) => void;
  onRemove: (id: string) => void;
}

export function QueueTable({
  paginatedQueue,
  filteredQueueLength,
  searchQuery,
  setSearchQuery,
  selectedStation,
  setSelectedStation,
  statusFilter,
  setStatusFilter,
  currentPage,
  setCurrentPage,
  totalPages,
  pageSize,
  onCall,
  onRemove,
}: QueueTableProps) {
  // Track which row is expanded to view the inspector manual station checklist
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
            placeholder="Search by ticket, name, or ID..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-xl border border-[#DCDAD2] bg-white px-3.5 py-2 text-xs text-[#1A1916] placeholder-[#8C8A81] focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
          />
        </div>

        <div className="flex items-center gap-2.5 w-full sm:w-auto justify-end">
          <select
            value={selectedStation}
            onChange={(e) => setSelectedStation(e.target.value)}
            className="rounded-xl border border-[#DCDAD2] bg-white px-3 py-2 text-xs text-[#1A1916] focus:outline-none"
          >
            <option value="ALL">All Stations</option>
            <option value="Visual Acuity">Visual Acuity</option>
            <option value="Refraction">Refraction</option>
            <option value="Colour Vision">Colour Vision</option>
            <option value="Eye Health">Eye Health</option>
            <option value="Clinical Review">Clinical Review</option>
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-xl border border-[#DCDAD2] bg-white px-3 py-2 text-xs text-[#1A1916] focus:outline-none"
          >
            <option value="ALL">All Statuses</option>
            <option value="WAITING">Waiting</option>
            <option value="COMPLETED">Completed</option>
            <option value="NO_SHOW">No Show</option>
          </select>
        </div>
      </div>

      {/* Table Structure */}
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-[#EEEDEA] bg-[#FCFCFB] text-[11px] font-semibold text-[#7A7870] uppercase tracking-wider">
              <th className="py-3 px-4">Queue Pos</th>
              <th className="py-3 px-4">Ticket ID</th>
              <th className="py-3 px-4">Participant</th>
              <th className="py-3 px-4">Station</th>
              <th className="py-3 px-4">Wait Time</th>
              <th className="py-3 px-4">Status</th>
              <th className="py-3 px-4 text-center">Inspector Stations</th>
              <th className="py-3 px-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#EEEDEA] text-xs text-[#26251E]">
            {paginatedQueue.length > 0 ? (
              paginatedQueue.map((item) => {
                const isExpanded = expandedRowId === item.id;
                
                return (
                  <>
                    <tr key={item.id} className="hover:bg-[#FDFDFC] transition-colors">
                      <td className="py-3.5 px-4 font-mono text-[#7A7870]">#{item.position}</td>
                      <td className="py-3.5 px-4 font-mono font-semibold text-[#1A1916]">{item.ticketNumber}</td>
                      <td className="py-3.5 px-4">
                        <div className="font-semibold text-[#1A1916]">{item.participant.fullName}</div>
                        <div className="text-[11px] text-[#7A7870]">{item.participant.age} yrs · {item.participant.idNumber}</div>
                      </td>
                      <td className="py-3.5 px-4 font-medium text-[#4A4843]">{item.station}</td>
                      <td className="py-3.5 px-4 tabular-nums text-[#7A7870]">{item.waitTime}</td>
                      <td className="py-3.5 px-4">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold tracking-wide ${
                          item.status === "WAITING" ? "bg-blue-50 text-blue-700" :
                          item.status === "COMPLETED" ? "bg-emerald-50 text-emerald-700" :
                          "bg-amber-50 text-amber-700"
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
                          onClick={() => onCall(item.id)}
                          className="font-medium text-blue-600 hover:text-blue-800 cursor-pointer"
                        >
                          Call
                        </button>
                        <button 
                          onClick={() => onRemove(item.id)}
                          className="font-medium text-rose-600 hover:text-rose-800 cursor-pointer"
                        >
                          Remove
                        </button>
                      </td>
                    </tr>

                    {/* Expandable Station Checklist Drawer per Row */}
                    {isExpanded && (
                      <tr className="bg-[#F9F9F8]">
                        <td colSpan={8} className="px-6 py-4 border-b border-[#EEEDEA]">
                          <div className="space-y-3">
                            <div className="text-[11px] font-bold text-[#1A1916] uppercase tracking-wider flex items-center gap-1.5">
                              <ShieldCheckIcon className="w-4 h-4 text-blue-600" />
                              <span>Station Checklist for {item.participant.fullName}</span>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
                              {["Visual Acuity", "Refraction", "Colour Vision", "Eye Health", "Clinical Review"].map((stName, idx) => {
                                const isDone = idx < 2; // Mock state
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
                <td colSpan={8} className="py-12 text-center text-[#7A7870]">
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
          Showing <span className="font-semibold text-[#1A1916]">{paginatedQueue.length}</span> of <span className="font-semibold text-[#1A1916]">{filteredQueueLength}</span> entries
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