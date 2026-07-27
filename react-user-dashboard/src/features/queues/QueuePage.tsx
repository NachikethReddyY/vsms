/* eslint-disable @typescript-eslint/no-unused-vars */
// react-user-dashboard/src/features/queues/QueuePage.tsx
import { useCallback, useEffect, useState } from "react";
import { queueService, QueueItem } from "../../services/queueService";
import QueueTable from "./QueueTable";
import "./queue.styles.css";

interface QueuePageProps {
  eventId: string;
}

export default function QueuePage({ eventId }: QueuePageProps) {
  const [queueItems, setQueueItems] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchQueueData = useCallback(async () => {
    try {
      setLoading(true);
      const data = await queueService.getQueue(eventId);
      setQueueItems(data);
      setError("");
    } catch (_err: unknown) {
      setError("Failed to load live participant queue. Please try again.");
    } finally {
      setLoading(false);
    }
  });

  useEffect(() => {
    if (eventId) {
      fetchQueueData();
    }
  }, [eventId, fetchQueueData]);

  const handleAdvance = async (queueId: string) => {
    try {
      await queueService.advanceQueue(queueId);
      fetchQueueData();
    } catch (_err: unknown) {
      alert("Failed to advance participant queue position.");
    }
  };

  if (loading) {
    return <div aria-live="polite" className="queue-container">Loading live queue status...</div>;
  }

  if (error) {
    return <div className="queue-container" style={{ color: "red" }}>{error}</div>;
  }

  return (
    <div className="queue-container">
      <h2 className="queue-heading">Live Participant Queue</h2>
      <p className="queue-subtext">Track live station assignments and manage wait times seamlessly.</p>
      <QueueTable queueItems={queueItems} onAdvance={handleAdvance} />
    </div>
  );
}