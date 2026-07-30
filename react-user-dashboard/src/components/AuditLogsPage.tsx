import { useEffect, useState } from "react";
import axios from "axios";

interface AuditLog {
  id: string;
  action: string;
  entity: string;
  details: string;
  ipAddress: string;
  createdAt: string;
  user?: { email: string; username: string };
}

export default function AuditLogsPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const fetchLogs = async () => {
      try {
        const response = await axios.get("/api/audit-logs", { withCredentials: true });
        setLogs(response.data.data);
      } catch (err) {
        setError("Failed to load audit logs or permission denied.");
      } finally {
        setLoading(false);
      }
    };

    fetchLogs();
  }, []);

  if (loading) return <div style={{ padding: "2rem" }}>Loading audit logs...</div>;
  if (error) return <div style={{ padding: "2rem", color: "red" }}>{error}</div>;

  return (
    <div style={{ padding: "2rem" }}>
      <h2>System Audit Trail</h2>
      <p>Append-only secure records of system activities.</p>

      {logs.length === 0 ? (
        <p>No audit records found.</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: "1rem" }}>
          <thead>
            <tr style={{ background: "#f5f5f5", textAlign: "left" }}>
              <th style={{ padding: "0.75rem" }}>Timestamp</th>
              <th style={{ padding: "0.75rem" }}>Action</th>
              <th style={{ padding: "0.75rem" }}>Entity</th>
              <th style={{ padding: "0.75rem" }}>User</th>
              <th style={{ padding: "0.75rem" }}>Details</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => (
              <tr key={log.id} style={{ borderBottom: "1px solid #ddd" }}>
                <td style={{ padding: "0.75rem" }}>{new Date(log.createdAt).toLocaleString()}</td>
                <td style={{ padding: "0.75rem" }}><strong>{log.action}</strong></td>
                <td style={{ padding: "0.75rem" }}>{log.entity}</td>
                <td style={{ padding: "0.75rem" }}>{log.user?.email || "System"}</td>
                <td style={{ padding: "0.75rem" }}><code>{log.details}</code></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}