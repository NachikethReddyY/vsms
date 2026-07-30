import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import apiClient, { getApiError } from "../../utils/apiClient";
import { UserGroupIcon, PlayIcon } from "@heroicons/react/24/outline";
import QueueStatsCards from "./components/QueueStatsCards";
import QueueTable from "./components/QueueTable";

interface QueueItem {
  id: string;
  queueNo: number;
  participantName: string;
  status: "WAITING" | "SERVING" | "COMPLETED";
}

export default function QueueDashboardPage() {
  const { eventId } = useParams<{ eventId: string }>();
  const [currentServing, setCurrentServing] = useState<number>(3);
  const [queueList, setQueueList] = useState<QueueItem[]>([
    { id: "1", queueNo: 1, participantName: "Jane Doe", status: "COMPLETED" },
    { id: "2", queueNo: 2, participantName: "John Smith", status: "COMPLETED" },
    { id: "3", queueNo: 3, participantName: "Alice Johnson", status: "SERVING" },
    { id: "4", queueNo: 4, participantName: "Bob Brown", status: "WAITING" },
    { id: "5", queueNo: 5, participantName: "Charlie Green", status: "WAITING" },
  ]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    if (!eventId) return;
    const fetchQueue = async () => {
      try {
        setLoading(true);
        const res = await apiClient.get(`/queue/event/${eventId}`);
        if (res.data?.success) {
          setQueueList(res.data.data);
        }
      } catch (err) {
        setError(getApiError(err, "Failed to load queue data."));
      } finally {
        setLoading(false);
      }
    };
    fetchQueue();
  }, [eventId]);

  const handleNextInLine = async () => {
    try {
      const nextNum = currentServing + 1;
      setCurrentServing(nextNum);
      setQueueList((prev) =>
        prev.map((item) => {
          if (item.queueNo === currentServing) return { ...item, status: "COMPLETED" };
          if (item.queueNo === nextNum) return { ...item, status: "SERVING" };
          return item;
        })
      );
    } catch (err) {
      setError(getApiError(err, "Failed to advance queue."));
    }
  };

  const totalWaiting = queueList.filter((q) => q.status === "WAITING").length;
  const completedToday = queueList.filter((q) => q.status === "COMPLETED").length;

  return (
    <main className="p-6 max-w-5xl mx-auto">
      <header className="flex flex-col md:flex-row md:items-center justify-between mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <UserGroupIcon className="w-7 h-7 text-blue-600" /> Live Queue Dashboard
          </h1>
          <p className="text-sm text-gray-500">Manage real-time station traffic for Event ID: {eventId}</p>
        </div>
        <button
          onClick={handleNextInLine}
          className="flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl text-sm transition-colors shadow-sm cursor-pointer"
        >
          <PlayIcon className="w-4 h-4" /> Call Next Participant
        </button>
      </header>

      {error && <div className="mb-4 p-3 bg-red-50 text-red-600 rounded-lg text-xs">⚠️ {error}</div>}

      <QueueStatsCards
        currentServing={currentServing}
        totalWaiting={totalWaiting}
        completedToday={completedToday}
      />

      <QueueTable queueList={queueList} loading={loading} />
    </main>
  );
}