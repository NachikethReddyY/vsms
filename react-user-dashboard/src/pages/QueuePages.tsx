import { useState, useMemo } from "react";
import { useParams } from "react-router-dom";
import { AppShell, LoadingState } from "../components/ui";
import { QueueHeader } from "../components/queue/QueueHeader";
import { NowServingCard } from "../components/queue/NowServingCard";
import { QueueTable } from "../components/queue/QueueTable";

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

const generateMockQueue = (count: number): QueueItem[] => {
  const stations = ["Visual Acuity", "Refraction", "Colour Vision", "Eye Health", "Clinical Review"];
  const firstNames = ["Evelyn", "Marcus", "Aaliyah", "David", "Sarah", "Liam", "Sophia", "Noah", "Olivia", "James"];
  const lastNames = ["Ng", "Vance", "Chen", "Miller", "Jenkins", "Smith", "Patel", "Johnson", "Brown", "Taylor"];
  
  const items: QueueItem[] = [];
  for (let i = 1; i <= count; i++) {
    const fName = firstNames[(i * 7) % firstNames.length];
    const lName = lastNames[(i * 13) % lastNames.length];
    const station = stations[i % stations.length];
    
    items.push({
      id: `q-${100 + i}`,
      ticketNumber: `VSMS-240719-${String(i).padStart(3, "0")}`,
      status: i === 1 ? "IN_SERVICE" : i < 15 ? "WAITING" : i % 3 === 0 ? "COMPLETED" : "WAITING",
      station,
      waitTime: `${Math.floor((i * 3) % 45) + 2}m`,
      position: i,
      participant: {
        fullName: `${fName} ${lName}`,
        age: 20 + (i % 60),
        idNumber: `ID-${883900 + i}`,
      },
    });
  }
  return items;
};

export function QueuePage() {
  const { eventId } = useParams<{ eventId: string }>();
  const [isLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedStation, setSelectedStation] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 12;

  const [queueList, setQueueList] = useState<QueueItem[]>(() => generateMockQueue(500));

  const currentServing = useMemo(() => {
    return queueList.find((item) => item.status === "IN_SERVICE") || null;
  }, [queueList]);

  const filteredQueue = useMemo(() => {
    return queueList.filter((item) => {
      if (item.status === "IN_SERVICE") return false;
      const matchesSearch = 
        item.ticketNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.participant.fullName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.participant.idNumber.toLowerCase().includes(searchQuery.toLowerCase());
      
      const matchesStation = selectedStation === "ALL" || item.station === selectedStation;
      const matchesStatus = statusFilter === "ALL" || item.status === statusFilter;

      return matchesSearch && matchesStation && matchesStatus;
    });
  }, [queueList, searchQuery, selectedStation, statusFilter]);

  const paginatedQueue = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredQueue.slice(start, start + pageSize);
  }, [filteredQueue, currentPage]);

  const totalPages = Math.ceil(filteredQueue.length / pageSize) || 1;

  const handleNextInQueue = () => {
    const nextWaitingIndex = queueList.findIndex((item) => item.status === "WAITING");
    if (nextWaitingIndex === -1) return;

    setQueueList((prev) =>
      prev.map((item, idx) => {
        if (item.status === "IN_SERVICE") return { ...item, status: "COMPLETED" };
        if (idx === nextWaitingIndex) return { ...item, status: "IN_SERVICE" };
        return item;
      })
    );
  };

  const handleUpdateStatus = (id: string, newStatus: QueueItem["status"]) => {
    setQueueList((prev) =>
      prev.map((item) => (item.id === id ? { ...item, status: newStatus } : item))
    );
  };

  if (isLoading) {
    return (
      <AppShell title="">
        <LoadingState label="Loading queue records..." />
      </AppShell>
    );
  }

  const waitingCount = queueList.filter((i) => i.status === "WAITING").length;
  const completedCount = queueList.filter((i) => i.status === "COMPLETED").length;

  return (
    <AppShell title="">
      {/* Tightened max-width and reduced top padding/whitespace */}
      <div className="max-w-7xl mx-auto pb-16 px-6 pt-2 space-y-4">
        
        <QueueHeader
          eventId={eventId}
          totalCount={queueList.length}
          waitingCount={waitingCount}
          completedCount={completedCount}
          onCallNext={handleNextInQueue}
          currentServing={currentServing}
          onSignOff={() => {
            if (currentServing) {
              handleUpdateStatus(currentServing.id, "COMPLETED");
            }
          }}
        />

        <NowServingCard
          currentServing={currentServing}
          onComplete={(id) => handleUpdateStatus(id, "COMPLETED")}
          onNoShow={(id) => handleUpdateStatus(id, "NO_SHOW")}
        />

        <QueueTable
          paginatedQueue={paginatedQueue}
          filteredQueueLength={filteredQueue.length}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          selectedStation={selectedStation}
          setSelectedStation={setSelectedStation}
          statusFilter={statusFilter}
          setStatusFilter={setStatusFilter}
          currentPage={currentPage}
          setCurrentPage={setCurrentPage}
          totalPages={totalPages}
          pageSize={pageSize}
          onCall={(id) => handleUpdateStatus(id, "IN_SERVICE")}
          onRemove={(id) => handleUpdateStatus(id, "CANCELLED")}
        />

      </div>
    </AppShell>
  );
}