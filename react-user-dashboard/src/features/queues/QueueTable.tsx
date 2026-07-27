// ==========================================
// FRONTEND SUB-COMPONENT (TypeScript)
// ==========================================
// react-user-dashboard/src/features/queue/QueueTable.tsx

import { QueueItem } from "../../services/queueService";

interface QueueTableProps {
  queueItems: QueueItem[];
  onAdvance: (queueId: string) => void;
}

export default function QueueTable({ queueItems, onAdvance }: QueueTableProps) {
  if (queueItems.length === 0) {
    return (
      <div style={{ padding: "3rem", textAlign: "center", color: "#666" }}>
        <p>No participants currently checked into the queue.</p>
      </div>
    );
  }

  return (
    <table style={{ width: "100%", borderCollapse: "collapse", marginTop: "1rem" }}>
      <thead>
        <tr style={{ background: "#f5f5f5", textAlign: "left" }}>
          <th style={{ padding: "0.75rem" }}>Position</th>
          <th style={{ padding: "0.75rem" }}>Participant Name</th>
          <th style={{ padding: "0.75rem" }}>Current Station</th>
          <th style={{ padding: "0.75rem" }}>Status</th>
          <th style={{ padding: "0.75rem" }}>Actions</th>
        </tr>
      </thead>
      <tbody>
        {queueItems.map((item, index) => (
          <tr key={item.id} style={{ borderBottom: "1px solid #ddd" }}>
            <td style={{ padding: "0.75rem" }}>#{index + 1}</td>
            <td style={{ padding: "0.75rem" }}>
              <strong>{item.participant?.fullName || "Unknown"}</strong>
            </td>
            <td style={{ padding: "0.75rem" }}>
              {item.station?.name || "Pending Assignment"}
            </td>
            <td style={{ padding: "0.75rem" }}>
              <span
                style={{
                  padding: "0.25rem 0.5rem",
                  borderRadius: "4px",
                  fontSize: "0.85rem",
                  background:
                    item.status === "COMPLETED"
                      ? "#e6f4ea"
                      : item.status === "IN_PROGRESS"
                      ? "#e8f0fe"
                      : "#fef7e0",
                  color:
                    item.status === "COMPLETED"
                      ? "#137333"
                      : item.status === "IN_PROGRESS"
                      ? "#1a73e8"
                      : "#b06000",
                }}
              >
                {item.status}
              </span>
            </td>
            <td style={{ padding: "0.75rem" }}>
              <button
                onClick={() => onAdvance(item.id)}
                style={{
                  padding: "0.4rem 0.8rem",
                  cursor: "pointer",
                  background: "#1a73e8",
                  color: "#fff",
                  border: "none",
                  borderRadius: "4px",
                }}
              >
                Advance
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}