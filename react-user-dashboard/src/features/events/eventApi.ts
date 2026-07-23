import apiClient from '../../utils/apiClient';
import type { components } from '../../generated/api';

export type EventRecord = Omit<components['schemas']['Event'], 'shifts'> & {
  shifts: components['schemas']['Shift'][];
};
export type EventStatus = components['schemas']['EventStatus'];
export type CreateEvent = components['schemas']['CreateEventRequest'];
export type UpdateEvent = components['schemas']['UpdateEventRequest'];
export type AuditRecord = components['schemas']['EventAuditLog'];

export const eventApi = {
  async list(params?: { status?: EventStatus; search?: string; cursor?: string }) {
    const { data } = await apiClient.get<components['schemas']['EventListResponse']>('/api/events', { params: { ...params, limit: 25 } });
    return data;
  },
  async get(id: string, signal?: AbortSignal) {
    const { data } = await apiClient.get<EventRecord>(`/api/events/${id}`, { signal });
    return data;
  },
  async create(input: CreateEvent) {
    const { data } = await apiClient.post<EventRecord>('/api/events', input);
    return data;
  },
  async update(id: string, input: UpdateEvent) {
    const { data } = await apiClient.patch<EventRecord>(`/api/events/${id}`, input);
    return data;
  },
  async transition(id: string, action: 'publish' | 'start' | 'complete', version: number) {
    const { data } = await apiClient.post<EventRecord>(`/api/events/${id}/${action}`, { version });
    return data;
  },
  async cancel(id: string, version: number, reason: string) {
    const { data } = await apiClient.post<EventRecord>(`/api/events/${id}/cancel`, { version, reason });
    return data;
  },
  async audit(id: string) {
    const { data } = await apiClient.get<components['schemas']['AuditListResponse']>(`/api/events/${id}/audit-log`, { params: { limit: 50 } });
    return data;
  },
};

export const STATUS_LABEL: Record<EventStatus, string> = {
  DRAFT: 'Draft', PUBLISHED: 'Published', IN_PROGRESS: 'In progress', COMPLETED: 'Completed', CANCELLED: 'Cancelled',
};

export function formatEventDate(value: string, timezone: string, includeTime = true) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
    ...(includeTime ? { hour: 'numeric', minute: '2-digit' } : {}),
    timeZone: timezone,
  }).format(new Date(value));
}
