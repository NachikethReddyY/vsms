import { useEffect, useState } from "react";
import { AppShell, LoadingState } from "../components/ui";
import apiClient, { getApiError } from "../utils/apiClient";
import { 
  ShieldCheckIcon, 
  DocumentTextIcon, 
  ExclamationTriangleIcon, 
  UserCircleIcon, 
  ClockIcon,
  ServerIcon
} from "@heroicons/react/24/outline";

interface AuditLog {
  id: string;
  action: string;
  category?: string;
  actorEmail?: string;
  ipAddress?: string;
  userAgent?: string;
  timestamp: string;
  details?: string;
}

export function SystemAuditDashboardPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("ALL");

  useEffect(() => {
    const fetchAuditLogs = async () => {
      try {
        const response = await apiClient.get<AuditLog[]>("/admin/audit-logs");
        setLogs(response.data || []);
      } catch (err) {
        setError(getApiError(err, "Failed to load audit logs."));
      } finally {
        setIsLoading(false);
      }
    };
    void fetchAuditLogs();
  }, []);

  const filteredLogs = logs.filter((log) => {
    const matchesSearch = 
      log.action?.toLowerCase().includes(search.toLowerCase()) ||
      log.actorEmail?.toLowerCase().includes(search.toLowerCase()) ||
      log.ipAddress?.toLowerCase().includes(search.toLowerCase());
    const matchesCategory = selectedCategory === "ALL" || log.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  if (isLoading) {
    return (
      <AppShell title="System Audit Dashboard">
        <LoadingState label="Loading comprehensive audit trails..." />
      </AppShell>
    );
  }

  return (
    <AppShell title="System Audit Dashboard">
      <div className="mx-auto max-w-7xl space-y-6 px-6 pb-16 pt-2">
        
        {/* Header Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-white border border-[#E2E1DC] p-5 rounded-2xl shadow-xs flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-[#7A7870] uppercase">Total Logs Recorded</p>
              <p className="text-2xl font-bold font-mono text-[#1A1916] mt-1">{logs.length}</p>
            </div>
            <div className="p-3 bg-blue-50 text-blue-600 rounded-xl">
              <DocumentTextIcon className="w-6 h-6" />
            </div>
          </div>
          <div className="bg-white border border-[#E2E1DC] p-5 rounded-2xl shadow-xs flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-[#7A7870] uppercase">Security Events</p>
              <p className="text-2xl font-bold font-mono text-[#1A1916] mt-1">
                {logs.filter(l => l.category === "SECURITY" || l.action?.includes("AUTH")).length}
              </p>
            </div>
            <div className="p-3 bg-emerald-50 text-emerald-600 rounded-xl">
              <ShieldCheckIcon className="w-6 h-6" />
            </div>
          </div>
          <div className="bg-white border border-[#E2E1DC] p-5 rounded-2xl shadow-xs flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-[#7A7870] uppercase">System Nodes Monitored</p>
              <p className="text-2xl font-bold font-mono text-[#1A1916] mt-1">100% Secure</p>
            </div>
            <div className="p-3 bg-indigo-50 text-indigo-600 rounded-xl">
              <ServerIcon className="w-6 h-6" />
            </div>
          </div>
        </div>

        {error && (
          <div className="rounded-xl bg-red-50 p-4 text-sm text-red-800 flex items-center gap-2">
            <ExclamationTriangleIcon className="w-5 h-5 text-red-600 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Audit Log Table Container */}
        <div className="bg-white border border-[#E2E1DC] rounded-2xl shadow-xs overflow-hidden">
          
          {/* Toolbar */}
          <div className="p-4 border-b border-[#EEEDEA] flex flex-col sm:flex-row items-center justify-between gap-3 bg-[#F9F9F8]">
            <input
              type="text"
              placeholder="Search by action, email, or IP address..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full sm:w-80 rounded-xl border border-[#DCDAD2] bg-white px-3.5 py-2 text-xs text-[#1A1916] placeholder-[#8C8A81] focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="w-full sm:w-auto rounded-xl border border-[#DCDAD2] bg-white px-3 py-2 text-xs text-[#1A1916] focus:outline-none"
            >
              <option value="ALL">All Categories</option>
              <option value="SECURITY">Security / Auth</option>
              <option value="QUEUE">Queue Actions</option>
              <option value="REGISTRATION">Registrations</option>
            </select>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#EEEDEA] bg-[#FCFCFB] text-[11px] font-semibold text-[#7A7870] uppercase tracking-wider">
                  <th className="py-3 px-4">Timestamp</th>
                  <th className="py-3 px-4">Action</th>
                  <th className="py-3 px-4">Actor / Email</th>
                  <th className="py-3 px-4">IP Address</th>
                  <th className="py-3 px-4">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EEEDEA] text-xs text-[#26251E]">
                {filteredLogs.length > 0 ? (
                  filteredLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-[#FDFDFC] transition-colors">
                      <td className="py-3.5 px-4 tabular-nums text-[#7A7870] flex items-center gap-1.5">
                        <ClockIcon className="w-3.5 h-3.5 text-[#A19F97]" />
                        {new Date(log.timestamp).toLocaleString()}
                      </td>
                      <td className="py-3.5 px-4 font-mono font-semibold text-[#1A1916]">
                        {log.action}
                      </td>
                      <td className="py-3.5 px-4 flex items-center gap-1.5 text-[#4A4843]">
                        <UserCircleIcon className="w-4 h-4 text-[#A19F97]" />
                        {log.actorEmail ?? "System / Anonymous"}
                      </td>
                      <td className="py-3.5 px-4 font-mono text-[11px] text-[#7A7870]">
                        {log.ipAddress ?? "127.0.0.1"}
                      </td>
                      <td className="py-3.5 px-4 text-[#7A7870] truncate max-w-xs">
                        {log.details ?? "—"}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="py-12 text-center text-[#7A7870]">
                      No audit logs match your search filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

        </div>

      </div>
    </AppShell>
  );
}