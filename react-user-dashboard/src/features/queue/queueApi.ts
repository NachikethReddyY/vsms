import apiClient from '../../utils/apiClient';

export type QueueStatus = 'WAITING' | 'CALLED' | 'IN_PROGRESS' | 'COMPLETED' | 'SKIPPED' | 'CANCELLED';

export type StationType = 'VISUAL_ACUITY' | 'REFRACTION' | 'COLOUR_VISION' | 'EYE_HEALTH';

export interface QueueEntry {
  id: string;
  queueNumber: number;
  status: QueueStatus;
  isPriority: boolean;
  priorityNotes?: string | null;
  registrationId: string;
  participantDisplayName?: string;
  participantReference?: string | null;
  stationId: string;
  stationName?: string;
  stationType?: string;
  enteredAt?: string | null;
  calledAt?: string | null;
  startedAt?: string | null;
  leftQueueAt?: string | null;
  completedAt?: string | null;
}

export interface QueueStationWorkload {
  stationId: string;
  stationName: string;
  stationType: string;
  stationOrder: number;
  workload: Record<QueueStatus, number>;
  nextUp?: {
    queueId: string;
    queueNumber: number;
    registrationId: string;
    participantDisplayName?: string;
    isPriority?: boolean;
  } | null;
}

export interface EventQueueStatus {
  event: { eventId: string; name: string; status: string; venue: string | null };
  stations: QueueStationWorkload[];
  entries: QueueEntry[];
}

export interface PriorityUpdateResult {
  id: string;
  isPriority: boolean;
  priorityNotes: string | null;
}

export const queueApi = {
  async getEventQueueStatus(eventId: string) {
    const { data } = await apiClient.get<EventQueueStatus>(`/queues/events/${eventId}`);
    return data;
  },

  async updatePriority(eventId: string, queueId: string, isPriority: boolean, notes: string | null) {
    const { data } = await apiClient.patch<PriorityUpdateResult>(
      `/events/${eventId}/entries/${queueId}/priority`,
      { isPriority, ...(notes && notes.trim() ? { notes: notes.trim() } : {}) },
    );
    return data;
  },

  async callQueueEntry(eventId: string, queueId: string) {
    const { data } = await apiClient.patch<QueueEntry>(`/events/${eventId}/entries/${queueId}/call`);
    return data;
  },

  async startQueueEntry(eventId: string, queueId: string) {
    const { data } = await apiClient.patch<QueueEntry>(`/events/${eventId}/entries/${queueId}/start`);
    return data;
  },

  async completeQueueEntry(eventId: string, queueId: string) {
    const { data } = await apiClient.patch<QueueEntry>(`/events/${eventId}/entries/${queueId}/complete`);
    return data;
  },

  async skipQueueEntry(eventId: string, queueId: string) {
    const { data } = await apiClient.patch<QueueEntry>(`/events/${eventId}/entries/${queueId}/skip`);
    return data;
  },
};

export function sortWaitingByPriority(entries: QueueEntry[]): QueueEntry[] {
  return entries
    .filter((entry) => entry.status === 'WAITING')
    .sort((a, b) => {
      if (a.isPriority !== b.isPriority) return a.isPriority ? -1 : 1;
      if (a.queueNumber !== b.queueNumber) return a.queueNumber - b.queueNumber;
      return String(a.enteredAt || '').localeCompare(String(b.enteredAt || ''));
    });
}
