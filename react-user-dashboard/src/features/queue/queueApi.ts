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

export type RouteOverrideReason = 'STATION_UNAVAILABLE' | 'QUEUE_BALANCING' | 'PARTICIPANT_NEED' | 'EQUIPMENT_ISSUE' | 'OPERATIONAL_EXCEPTION';
export type RegistrationRouteState = {
  status: 'PENDING_CHECK_IN' | 'NO_SCREENING_STATIONS' | 'READY' | 'NEEDS_STAFF_ACTION' | 'REVIEW_READY';
  routeVersion: number;
  steps: Array<{
    stationId: string;
    stationName: string;
    stationType: string;
    position: number;
    state: 'COMPLETED' | 'CURRENT' | 'BLOCKED' | 'UPCOMING';
  }>;
};

export const queueApi = {
  async getEventQueueStatus(eventId: string) {
    const { data } = await apiClient.get<EventQueueStatus>(`/queues/events/${eventId}`);
    return data;
  },

  async getParticipantRoute(eventId: string, registrationId: string) {
    const { data } = await apiClient.get<{ status: 'success'; data: RegistrationRouteState }>(`/queues/events/${eventId}/participants/${registrationId}/route`);
    return data.data;
  },

  async replaceParticipantRoute(eventId: string, registrationId: string, request: { stationIds: string[]; reasonCode: RouteOverrideReason; expectedVersion: number }) {
    const { data } = await apiClient.patch<{ status: 'success'; data: RegistrationRouteState }>(`/queues/events/${eventId}/participants/${registrationId}/route`, request);
    return data.data;
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
