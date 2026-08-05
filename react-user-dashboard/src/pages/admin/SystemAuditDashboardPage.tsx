import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { AppShell, LoadingState } from "../../components/ui";
import apiClient, { getApiError } from "../../utils/apiClient";
import {
  ShieldCheckIcon,
  DocumentTextIcon,
  UserCircleIcon,
  ClockIcon,
  ServerIcon,
  LockClosedIcon,
} from "@heroicons/react/24/outline";

type AuditCategory = "SECURITY" | "REGISTRATION" | "QUEUE" | "OTHER";

interface AuditRow {
  id: string;
  action: string;
  category: AuditCategory;
  actorEmail: string;
  ipAddress: string;
  userAgent: string;
  timestamp: string;
  details: string;
}

interface AuditLogRecord {
  id: string;
  action?: string;
  entityName?: string | null;
  entityId?: string | null;
  outcome?: string;
  details?: unknown;
  newValue?: unknown;
  oldValue?: unknown;
  ipAddress?: string | null;
  deviceName?: string | null;
  createdAt?: string;
  user?: { email?: string | null; fullName?: string | null } | null;
}

interface AuthAuditRecord {
  id: string;
  eventType?: string;
  outcome?: string;
  failureCategory?: string | null;
  identifierHash?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  occurredAt?: string;
  user?: { email?: string | null; fullName?: string | null } | null;
}

interface AuditDashboardResponse {
  logs: AuditLogRecord[];
  authLogs: AuthAuditRecord[];
}

export function deriveCategory(action: string): AuditCategory {
  const normalized = action.toUpperCase();
  if (/(AUTH|LOGIN|LOGOUT|PASSWORD|DEVICE|DENIED|FORBIDDEN)/.test(normalized)) return "SECURITY";
  if (normalized.startsWith("REGISTRATION") || normalized.startsWith("DUPLICATE")) return "REGISTRATION";
  if (normalized.startsWith("QUEUE")) return "QUEUE";
  return "OTHER";
}

function truncateDetails(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function mapAuditRows(response: AuditDashboardResponse): AuditRow[] {
  const rows: AuditRow[] = [];
  for (const log of response.logs || []) {
    const action = log.action || "UNKNOWN";
    rows.push({
      id: log.id,
      action,
      category: deriveCategory(action),
      actorEmail: log.user?.email || log.user?.fullName || "System / Anonymous",
      ipAddress: log.ipAddress || "127.0.0.1",
      userAgent: log.deviceName || "Unknown",
      timestamp: log.createdAt || "",
      details: truncateDetails(log.details ?? log.newValue ?? log.oldValue ?? log.entityName ?? ""),
    });
  }
  for (const log of response.authLogs || []) {
    const action = log.eventType || "UNKNOWN";
    const parts = [log.outcome, log.failureCategory].filter(Boolean);
    rows.push({
      id: log.id,
      action,
      category: deriveCategory(action),
      actorEmail: log.user?.email || log.user?.fullName || "System / Anonymous",
      ipAddress: log.ipAddress || "127.0.0.1",
      userAgent: log.userAgent || "Unknown",
      timestamp: log.occurredAt || "",
      details: parts.join(" · ") || log.identifierHash || "",
    });
  }
  return rows.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

export function SystemAuditDashboardPage() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("ALL");

  useEffect(() => {
    let cancelled = false;
    const fetchAuditLogs = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const response = await apiClient.get<AuditDashboardResponse>("/admin/audit-logs");
        if (cancelled) return;
        setRows(mapAuditRows(response.data));
      } catch (err) {
        if (cancelled) return;
        if (axios.isAxiosError(err) && err.response?.status === 403) {
          setError("Admin access is required to view the audit trail. Contact an administrator.");
        } else {
          setError(getApiError(err, "Failed to load audit logs."));
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    void fetchAuditLogs();
    return () => {
      cancelled = true;
    };
  }, []);

  const securityCount = useMemo(() => rows.filter((row) => row.category === "SECURITY").length, [rows]);
  const registrationCount = useMemo(() => rows.filter((row) => row.category === "REGISTRATION").length, [rows]);

  const filteredLogs = rows.filter((log) => {
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
              <p className="text-2xl font-bold font-mono text-[#1A1916] mt-1">{rows.length}</p>
            </div>
            <div className="p-3 bg-blue-50 text-blue-600 rounded-xl">
              <DocumentTextIcon className="w-6 h-6" />
            </div>
          </div>
          <div className="bg-white border border-[#E2E1DC] p-5 rounded-2xl shadow-xs flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-[#7A7870] uppercase">Security Events</p>
              <p className="text-2xl font-bold font-mono text-[#1A1916] mt-1">{securityCount}</p>
            </div>
            <div className="p-3 bg-emerald-50 text-emerald-600 rounded-xl">
              <ShieldCheckIcon className="w-6 h-6" />
            </div>
          </div>
          <div className="bg-white border border-[#E2E1DC] p-5 rounded-2xl shadow-xs flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-[#7A7870] uppercase">Registration Events</p>
              <p className="text-2xl font-bold font-mono text-[#1A1916] mt-1">{registrationCount}</p>
            </div>
            <div className="p-3 bg-indigo-50 text-indigo-600 rounded-xl">
              <ServerIcon className="w-6 h-6" />
            </div>
          </div>
        </div>

        {error && (
          <div className="rounded-xl bg-red-50 p-4 text-sm text-red-800 flex items-center gap-2">
            <LockClosedIcon className="w-5 h-5 text-red-600 shrink-0" />
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
              <option value="OTHER">Other</option>
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
                    <tr key={`${log.id}-${log.timestamp}`} className="hover:bg-[#FDFDFC] transition-colors">
                      <td className="py-3.5 px-4 tabular-nums text-[#7A7870] flex items-center gap-1.5">
                        <ClockIcon className="w-3.5 h-3.5 text-[#A19F97]" />
                        {log.timestamp ? new Date(log.timestamp).toLocaleString() : "—"}
                      </td>
                      <td className="py-3.5 px-4 font-mono font-semibold text-[#1A1916]">
                        {log.action}
                      </td>
                      <td className="py-3.5 px-4 flex items-center gap-1.5 text-[#4A4843]">
                        <UserCircleIcon className="w-4 h-4 text-[#A19F97]" />
                        {log.actorEmail}
                      </td>
                      <td className="py-3.5 px-4 font-mono text-[11px] text-[#7A7870]">
                        {log.ipAddress}
                      </td>
                      <td className="py-3.5 px-4 text-[#7A7870] truncate max-w-xs" title={log.details}>
                        {log.details || "—"}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="py-12 text-center text-[#7A7870]">
                      {error
                        ? "Audit logs are unavailable."
                        : search || selectedCategory !== "ALL"
                          ? "No audit logs match your search filters."
                          : "No audit events recorded yet."}
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
