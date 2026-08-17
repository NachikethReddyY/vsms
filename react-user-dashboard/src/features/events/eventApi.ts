import apiClient from '../../utils/apiClient';
import type { components } from '../../generated/api';
import type { StationType } from '../screening/screeningApi';
import { getOfflineEvent, isNetworkError, listOfflineEvents } from '../screening/offlineSync';
import { getStoredSession } from '../../utils/session';

export type EventStation = Omit<components['schemas']['EventStation'], 'stationType'> & {
  stationType: StationType;
};
export type EventRecord = Omit<components['schemas']['Event'], 'shifts' | 'eventStations'> & {
  shifts: components['schemas']['Shift'][];
  eventStations: EventStation[];
  eventTeam?: string[];
  scope?: 'DEVICE_LOCAL' | 'SERVER';
};
export type EventStatus = components['schemas']['EventStatus'];
export type StaffAssignment = components['schemas']['StaffAssignment'];
export type StaffAssignmentRole = components['schemas']['StaffAssignmentRole'];
export type StaffDirectoryEntry = components['schemas']['StaffDirectoryEntry'];
export type EventMembership = components['schemas']['EventMembershipDetail'];
export type StationTemplate = Omit<components['schemas']['StationTemplate'], 'stationType'> & {
  stationType: StationType;
};
export type CreateEvent = components['schemas']['CreateEventRequest'];
export type UpdateEvent = components['schemas']['UpdateEventRequest'];
export type EventDeletionRequest = components['schemas']['EventDeletionRequest'];
export type EventDeletionResponse = components['schemas']['EventDeletionResponse'];
export type EventDeletionPreview = components['schemas']['EventDeletionPreview'];
export type AuditRecord = components['schemas']['EventAuditLog'];
export type LocationResult = components['schemas']['LocationResult'];
export type PublicEvent = components['schemas']['PublicEvent'];
export type EventMetrics = components['schemas']['EventMetrics'];
export type EventAttendee = components['schemas']['EventAttendee'];
export type EventAttendeeList = components['schemas']['EventAttendeeList'];
export type EventExportResponse = components['schemas']['EventExportResponse'];

function offlineOwnerId() {
  return getStoredSession()?.user.id ?? null;
}

function browserIsOnline() {
  return typeof navigator === 'undefined' || navigator.onLine;
}

async function offlineEventList(params?: { status?: EventStatus; search?: string }) {
  const ownerId = offlineOwnerId();
  if (!ownerId) return [];
  const search = params?.search?.trim().toLowerCase();
  return (await listOfflineEvents(ownerId))
    .filter((event) => !params?.status || event.status === params.status)
    .filter((event) => !search || `${event.name} ${event.venue}`.toLowerCase().includes(search))
    .sort((left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt))
    .map((event) => ({ ...event, scope: 'DEVICE_LOCAL' as const }));
}

export const eventApi = {
  async list(params?: { status?: EventStatus; search?: string; cursor?: string }) {
    if (!browserIsOnline()) return { events: await offlineEventList(params), nextCursor: null };
    try {
      const { data } = await apiClient.get<components['schemas']['EventListResponse']>('/events', { params: { ...params, limit: 25 } });
      return data;
    } catch (error) {
      const events = isNetworkError(error) ? await offlineEventList(params) : [];
      if (events.length) return { events, nextCursor: null };
      throw error;
    }
  },
  async get(id: string, signal?: AbortSignal) {
    const ownerId = offlineOwnerId();
    if (!browserIsOnline() && ownerId) {
      const event = await getOfflineEvent(ownerId, id);
      if (event) return { ...event, scope: 'DEVICE_LOCAL' as const };
    }
    try {
      const { data } = await apiClient.get<EventRecord>(`/events/${id}`, { signal });
      return data;
    } catch (error) {
      const event = isNetworkError(error) && ownerId ? await getOfflineEvent(ownerId, id) : null;
      if (event) return { ...event, scope: 'DEVICE_LOCAL' as const };
      throw error;
    }
  },
  async publicGet(id: string, signal?: AbortSignal) {
    const { data } = await apiClient.get<PublicEvent>(`/public/events/${id}`, { signal });
    return data;
  },
  async create(input: CreateEvent, idempotencyKey = crypto.randomUUID()) {
    const { data } = await apiClient.post<EventRecord>('/events', input, { headers: { 'Idempotency-Key': idempotencyKey } });
    return data;
  },
  async update(id: string, input: UpdateEvent) {
    const { data } = await apiClient.patch<EventRecord>(`/events/${id}`, input);
    return data;
  },
  async transition(id: string, action: 'publish' | 'start' | 'complete', version: number) {
    const { data } = await apiClient.post<EventRecord>(`/events/${id}/${action}`, { version });
    return data;
  },
  async cancel(id: string, version: number, reason: string) {
    const { data } = await apiClient.post<EventRecord>(`/events/${id}/cancel`, { version, reason });
    return data;
  },
  async delete(id: string, input: EventDeletionRequest) {
    const { data } = await apiClient.delete<EventDeletionResponse>(`/events/${id}`, { data: input });
    return data;
  },
  async deletionPreview(id: string) {
    const { data } = await apiClient.get<EventDeletionPreview>(`/events/${id}/deletion-preview`);
    return data;
  },
  async staffDirectory() {
    const { data } = await apiClient.get<StaffDirectoryEntry[]>('/events/staff-directory');
    return data;
  },
  async memberships(id: string) {
    const { data } = await apiClient.get<components['schemas']['EventMembershipListResponse']>(`/events/${id}/memberships`);
    return data.memberships;
  },
  async stationTemplates() {
    const { data } = await apiClient.get<StationTemplate[]>('/events/station-templates');
    return data;
  },
  async searchLocations(query: string, signal?: AbortSignal) {
    const { data } = await apiClient.get<components['schemas']['LocationSearchResponse']>('/locations/search', {
      params: { q: query },
      signal,
    });
    return data.locations;
  },
  async importStations(id: string, version: number, stationTemplateIds: string[]) {
    const { data } = await apiClient.post<EventRecord>(`/events/${id}/stations/import`, { version, stationTemplateIds });
    return data;
  },
  async updateStation(id: string, eventStationId: string, input: { version: number; stationOrder?: number; capacity?: number; isAvailable?: boolean; availabilities?: Array<{ date: string; isAvailable: boolean; startsAt: string | null; endsAt: string | null; capacity: number }> }) {
    const { data } = await apiClient.patch<EventRecord>(`/events/${id}/stations/${eventStationId}`, input);
    return data;
  },
  async removeStation(id: string, eventStationId: string, version: number) {
    const { data } = await apiClient.delete<EventRecord>(`/events/${id}/stations/${eventStationId}`, { params: { version } });
    return data;
  },
  async assignStaff(id: string, shiftId: string, input: { version: number; userId?: string; userIds?: string[]; assignmentRole: StaffAssignmentRole; eventStationId?: string | null; notes?: string | null }) {
    const { data } = await apiClient.post<EventRecord>(`/events/${id}/shifts/${shiftId}/assignments`, input);
    return data;
  },
  async addShift(id: string, input: { version: number; name: string; startsAt: string; endsAt: string; requiredStaff: number }) {
    const { data } = await apiClient.post<EventRecord>(`/events/${id}/shifts`, input);
    return data;
  },
  async removeStaff(id: string, shiftId: string, assignmentId: string, version: number) {
    const { data } = await apiClient.delete<EventRecord>(`/events/${id}/shifts/${shiftId}/assignments/${assignmentId}`, { params: { version } });
    return data;
  },
  async audit(id: string) {
    const { data } = await apiClient.get<components['schemas']['AuditListResponse']>(`/events/${id}/audit-log`, { params: { limit: 50 } });
    return data;
  },
  async metrics(id: string) {
    const { data } = await apiClient.get<EventMetrics>(`/events/${id}/metrics`);
    return data;
  },
  async attendees(id: string, params?: { cursor?: string; limit?: number; status?: EventAttendee['registrationStatus']; search?: string }, signal?: AbortSignal) {
    const { data } = await apiClient.get<EventAttendeeList>(`/events/${id}/attendees`, { params, signal });
    return data;
  },
  async exportEvent(id: string) {
    const { data } = await apiClient.get<EventExportResponse>(`/events/${id}/export`);
    return data;
  },
  async deleteEmptyDraft(id: string, input: components['schemas']['EventDeletionRequest']) {
    await apiClient.delete(`/events/${id}`, { data: input });
  },
};

export const STATUS_LABEL: Record<EventStatus, string> = {
  DRAFT: 'Draft', PUBLISHED: 'Published', IN_PROGRESS: 'Live', COMPLETED: 'Past', CANCELLED: 'Cancelled',
};

export function formatEventDate(value: string, timezone: string, includeTime = true) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
    ...(includeTime ? { hour: 'numeric', minute: '2-digit' } : {}),
    timeZone: timezone,
  }).format(new Date(value));
}
