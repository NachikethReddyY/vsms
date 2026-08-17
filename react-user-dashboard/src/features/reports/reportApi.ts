import type { components } from '../../generated/api';
import apiClient from '../../utils/apiClient';
import { getStoredSession } from '../../utils/session';
import { getOfflineQueueStatus, getOfflineSyncStatus, isNetworkError, listOfflineEvents } from '../screening/offlineSync';

export type OperationalReport = components['schemas']['OperationalReport'] & { scope?: 'DEVICE_LOCAL' | 'SERVER' };
export type OperationalReportEvent = components['schemas']['OperationalReportEvent'];

export type ReportFilters = {
  eventId?: string;
  from: string;
  to: string;
};

export const reportApi = {
  async operations(filters: ReportFilters, signal?: AbortSignal) {
    const ownerId = getStoredSession()?.user.id;
    if (ownerId && !navigator.onLine) {
      const local = await localReport(ownerId, filters);
      if (local.scope === 'DEVICE_LOCAL') return local;
    }
    try {
      const { data } = await apiClient.get<OperationalReport>('/events/reports/operations', {
        params: { ...filters, eventId: filters.eventId || undefined },
        signal,
      });
      return data;
    } catch (error) {
      if (!ownerId || !isNetworkError(error)) throw error;
      const local = await localReport(ownerId, filters);
      if (local.scope !== 'DEVICE_LOCAL') throw error;
      return local;
    }
  },
};

async function localReport(ownerId: string, filters: ReportFilters): Promise<OperationalReport> {
  const downloaded = await listOfflineEvents(ownerId);
  const from = Date.parse(`${filters.from}T00:00:00`);
  const to = Date.parse(`${filters.to}T23:59:59.999`);
  const events: OperationalReportEvent[] = [];
  for (const event of downloaded) {
    const startsAt = Date.parse(event.startsAt);
    if ((filters.eventId && event.eventId !== filters.eventId) || startsAt < from || startsAt > to) continue;
    const [queue, sync] = await Promise.all([
      getOfflineQueueStatus(ownerId, event.eventId),
      getOfflineSyncStatus(ownerId, event.eventId),
    ]);
    const queueMetrics = {
      waiting: queue?.totals.WAITING ?? 0,
      active: (queue?.totals.CALLED ?? 0) + (queue?.totals.IN_PROGRESS ?? 0),
      completed: queue?.totals.COMPLETED ?? 0,
      skipped: queue?.totals.SKIPPED ?? 0,
      cancelled: queue?.totals.CANCELLED ?? 0,
    };
    events.push({
      eventId: event.eventId,
      name: event.name,
      status: event.status,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      timezone: event.timezone,
      registrations: {
        total: event.signupCount,
        signedUp: Math.max(0, event.signupCount - event.activeCapacityCount),
        checkedIn: event.activeCapacityCount,
        completed: 0,
        cancelled: 0,
        completionRate: 0,
      },
      queue: queueMetrics,
      referrals: { total: 0, actionRequired: 0, sentOrAcknowledged: 0, cancelled: 0 },
      deliveries: { inFlight: 0, delivered: 0, issues: 0 },
      sync: { total: sync.pending + sync.conflicts, pending: sync.pending, applied: 0, issues: sync.conflicts },
    });
  }
  const totalRegistrations = events.reduce((total, event) => total + event.registrations.total, 0);
  const completedRegistrations = events.reduce((total, event) => total + event.registrations.completed, 0);
  const sum = <K extends keyof OperationalReportEvent['queue']>(key: K) => events.reduce((total, event) => total + event.queue[key], 0);
  const sumSync = <K extends keyof OperationalReportEvent['sync']>(key: K) => events.reduce((total, event) => total + event.sync[key], 0);
  return {
    filters: { eventId: filters.eventId ?? null, from: filters.from, to: filters.to },
    summary: {
      events: events.length,
      registrations: {
        total: totalRegistrations,
        checkedIn: events.reduce((total, event) => total + event.registrations.checkedIn, 0),
        completed: completedRegistrations,
        completionRate: totalRegistrations ? Math.round((completedRegistrations / totalRegistrations) * 100) : 0,
      },
      queue: { waiting: sum('waiting'), active: sum('active'), completed: sum('completed') },
      referrals: { total: 0, actionRequired: 0, sentOrAcknowledged: 0 },
      deliveries: { inFlight: 0, delivered: 0, issues: 0 },
      sync: { total: sumSync('total'), pending: sumSync('pending'), applied: 0, issues: sumSync('issues') },
    },
    events,
    eventOptions: downloaded.map((event) => ({ eventId: event.eventId, name: event.name, status: event.status, startsAt: event.startsAt })),
    truncated: false,
    eventOptionsTruncated: false,
    scope: downloaded.length ? 'DEVICE_LOCAL' : 'SERVER',
  };
}
