// react-user-dashboard/src/services/queueService.ts
import axios from "axios";

export interface QueueItem {
  id: string;
  eventId: string;
  participantId: string;
  stationId?: string | null;
  position: number;
  status: "WAITING" | "IN_PROGRESS" | "COMPLETED";
  participant?: {
    id: string;
    fullName: string;
    email: string;
  };
  station?: {
    id: string;
    name: string;
  };
}

export const queueService = {
  getQueue: async (eventId: string): Promise<QueueItem[]> => {
    const response = await axios.get(`/api/queue/${eventId}`, { withCredentials: true });
    return response.data.data;
  },

  advanceQueue: async (queueId: string, nextStationId?: string | null): Promise<QueueItem> => {
    const response = await axios.patch(
      `/api/queue/${queueId}/advance`,
      { nextStationId },
      { withCredentials: true }
    );
    return response.data.data;
  },
};