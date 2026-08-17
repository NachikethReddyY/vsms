import apiClient from '../../utils/apiClient';
import {
  getOfflineParticipantRoute,
  getOfflineQueueStatus,
  queueOfflineQueueAction,
  queueOfflineRouteOverride,
} from '../screening/offlineSync';
import { getStoredSession } from '../../utils/session';

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
  totals: Record<QueueStatus, number>;
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
  currentStation: RegistrationRouteState['steps'][number] | null;
  queue: {
    queueEntryId: string;
    stationId: string;
    queueNumber: number;
    status: 'WAITING' | 'CALLED' | 'IN_PROGRESS';
  } | null;
};

export const queueApi = {
  async getEventQueueStatus(eventId: string) {
    const ownerId = getStoredSession()?.user.id;
    const local = ownerId ? await getOfflineQueueStatus(ownerId, eventId) : null;
    if (local) return local;
    const { data } = await apiClient.get<EventQueueStatus>(`/queues/events/${eventId}`);
    return data;
  },

  async getParticipantRoute(eventId: string, registrationId: string) {
    const ownerId = getStoredSession()?.user.id;
    const local = ownerId ? await getOfflineParticipantRoute(ownerId, eventId, registrationId) : null;
    if (local) return local;
    const { data } = await apiClient.get<{ status: 'success'; data: RegistrationRouteState }>(`/queues/events/${eventId}/participants/${registrationId}/route`);
    return data.data;
  },

  async replaceParticipantRoute(eventId: string, registrationId: string, request: { stationIds: string[]; reasonCode: RouteOverrideReason; expectedVersion: number; skipActive?: boolean }) {
    const ownerId = getStoredSession()?.user.id;
    if (ownerId && await getOfflineParticipantRoute(ownerId, eventId, registrationId)) {
      return queueOfflineRouteOverride(ownerId, eventId, registrationId, request);
    }
    const { data } = await apiClient.patch<{ status: 'success'; data: RegistrationRouteState }>(`/queues/events/${eventId}/participants/${registrationId}/route`, request);
    return data.data;
  },

  async updatePriority(eventId: string, queueId: string, isPriority: boolean, notes: string | null) {
    const ownerId = getStoredSession()?.user.id;
    if (ownerId && await getOfflineQueueStatus(ownerId, eventId)) {
      const entry = await queueOfflineQueueAction(ownerId, eventId, queueId, 'PRIORITY', { isPriority, notes });
      return { id: entry.id, isPriority: entry.isPriority, priorityNotes: entry.priorityNotes ?? null };
    }
    const { data } = await apiClient.patch<PriorityUpdateResult>(
      `/events/${eventId}/entries/${queueId}/priority`,
      { isPriority, ...(notes && notes.trim() ? { notes: notes.trim() } : {}) },
    );
    return data;
  },

  async callQueueEntry(eventId: string, queueId: string) {
    const ownerId = getStoredSession()?.user.id;
    if (ownerId && await getOfflineQueueStatus(ownerId, eventId)) {
      return queueOfflineQueueAction(ownerId, eventId, queueId, 'CALL');
    }
    const { data } = await apiClient.patch<QueueEntry>(`/events/${eventId}/entries/${queueId}/call`);
    return data;
  },

  async startQueueEntry(eventId: string, queueId: string) {
    const ownerId = getStoredSession()?.user.id;
    if (ownerId && await getOfflineQueueStatus(ownerId, eventId)) {
      return queueOfflineQueueAction(ownerId, eventId, queueId, 'START');
    }
    const { data } = await apiClient.patch<QueueEntry>(`/events/${eventId}/entries/${queueId}/start`);
    return data;
  },

  async skipQueueEntry(eventId: string, queueId: string) {
    const ownerId = getStoredSession()?.user.id;
    if (ownerId && await getOfflineQueueStatus(ownerId, eventId)) {
      return queueOfflineQueueAction(ownerId, eventId, queueId, 'SKIP');
    }
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
