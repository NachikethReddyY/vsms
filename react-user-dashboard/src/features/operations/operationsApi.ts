import type { components } from '../../generated/api';
import apiClient from '../../utils/apiClient';
import { getStoredSession } from '../../utils/session';
import { getOfflineQueueStatus, getOfflineSyncStatus, isNetworkError, listOfflineEvents } from '../screening/offlineSync';

export type OperationsOverview = components['schemas']['OperationsOverview'] & { scope?: 'DEVICE_LOCAL' | 'SERVER' };
export type OperationsEvent = components['schemas']['OperationsEvent'];
export type OperationsStatusFilter = OperationsOverview['filters']['status'];

export const operationsApi = {
  async overview(params: { status: OperationsStatusFilter; search?: string }, signal?: AbortSignal) {
    const ownerId = getStoredSession()?.user.id;
    if (ownerId && !navigator.onLine) {
      const prepared = await localOverview(ownerId, params);
      if (prepared.scope === 'DEVICE_LOCAL') return prepared;
    }
    try {
      const { data } = await apiClient.get<OperationsOverview>('/operations', {
        params: { ...params, search: params.search || undefined, limit: 50 },
        signal,
      });
      return data;
    } catch (error) {
      if (!ownerId || !isNetworkError(error)) throw error;
      const prepared = await localOverview(ownerId, params);
      if (prepared.scope !== 'DEVICE_LOCAL') throw error;
      return prepared;
    }
  },
};

async function localOverview(
  ownerId: string,
  params: { status: OperationsStatusFilter; search?: string },
): Promise<OperationsOverview> {
  const search = params.search?.trim().toLowerCase();
  const matchesStatus = (status: string) => params.status === 'ALL'
    || (params.status === 'ACTIVE' && status === 'IN_PROGRESS')
    || (params.status === 'UPCOMING' && ['DRAFT', 'PUBLISHED'].includes(status))
    || (params.status === 'COMPLETED' && ['COMPLETED', 'CANCELLED'].includes(status));
  const downloaded = await listOfflineEvents(ownerId);
  const events = [] as OperationsEvent[];
  for (const event of downloaded) {
    if (!matchesStatus(event.status) || (search && !`${event.name} ${event.venue}`.toLowerCase().includes(search))) continue;
    const [queue, sync] = await Promise.all([
      getOfflineQueueStatus(ownerId, event.eventId),
      getOfflineSyncStatus(ownerId, event.eventId),
    ]);
    if (!queue) continue;
    const activeShift = event.shifts.find((shift) => shift.status === 'ACTIVE') ?? null;
    const items = queue.stations.flatMap((station) => {
      if (!['VISUAL_ACUITY', 'REFRACTION', 'COLOUR_VISION', 'EYE_HEALTH'].includes(station.stationType)) return [];
      const active = station.workload.CALLED + station.workload.IN_PROGRESS;
      return [{
        stationId: station.stationId,
        name: station.stationName,
        type: station.stationType as 'VISUAL_ACUITY' | 'REFRACTION' | 'COLOUR_VISION' | 'EYE_HEALTH',
        order: station.stationOrder,
        operationalStatus: 'AVAILABLE' as const,
        staffed: event.shifts.some((shift) => shift.staffAssignments.some((assignment) => assignment.eventStation?.eventStationId === station.stationId)),
        queue: { waiting: station.workload.WAITING, active },
      }];
    });
    const priority = queue.entries.filter((entry) => entry.isPriority && entry.status === 'WAITING').length;
    const reasons: OperationsEvent['attention']['reasons'] = [
      ...(sync.conflicts ? [{ code: 'SYNC_ISSUES' as const, label: 'Offline sync conflicts', count: sync.conflicts, severity: 'critical' as const }] : []),
      ...(priority ? [{ code: 'PRIORITY_WAITING' as const, label: 'Priority participants waiting', count: priority, severity: 'warning' as const }] : []),
    ];
    events.push({
      eventId: event.eventId,
      name: event.name,
      status: event.status,
      venue: event.venue,
      timezone: event.timezone,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      capacity: event.capacity,
      progress: {
        total: event.signupCount,
        signedUp: event.signupCount,
        checkedIn: event.activeCapacityCount,
        completed: 0,
        screened: 0,
        reviewed: 0,
      },
      queue: {
        waiting: queue.totals.WAITING,
        called: queue.totals.CALLED,
        inProgress: queue.totals.IN_PROGRESS,
        completed: queue.totals.COMPLETED,
        skipped: queue.totals.SKIPPED,
        priority,
        longestWaitMinutes: 0,
      },
      stations: { total: items.length, available: items.length, paused: 0, offline: 0, items },
      staffing: {
        shiftId: activeShift?.shiftId ?? null,
        shiftName: activeShift?.name ?? null,
        startsAt: activeShift?.startsAt ?? null,
        endsAt: activeShift?.endsAt ?? null,
        required: activeShift?.requiredStaff ?? 0,
        assigned: activeShift?.staffAssignments.length ?? 0,
        unfilled: Math.max(0, (activeShift?.requiredStaff ?? 0) - (activeShift?.staffAssignments.length ?? 0)),
        unstaffedStations: items.filter((station) => !station.staffed).length,
      },
      referrals: { actionRequired: 0 },
      sync: { pending: sync.pending, issues: sync.conflicts },
      attention: {
        severity: reasons.some((reason) => reason.severity === 'critical') ? 'critical' : reasons.length ? 'warning' : 'normal',
        reasons,
      },
    });
  }
  const active = events.filter((event) => event.status === 'IN_PROGRESS').length;
  const upcoming = events.filter((event) => ['DRAFT', 'PUBLISHED'].includes(event.status)).length;
  const completed = events.filter((event) => ['COMPLETED', 'CANCELLED'].includes(event.status)).length;
  return {
    generatedAt: new Date().toISOString(),
    filters: { status: params.status, search: params.search ?? null },
    summary: {
      events: { total: events.length, active, upcoming, completed, needsAttention: events.filter((event) => event.attention.severity !== 'normal').length },
      participants: {
        checkedIn: events.reduce((total, event) => total + event.progress.checkedIn, 0),
        completed: events.reduce((total, event) => total + event.progress.completed, 0),
      },
      queue: {
        waiting: events.reduce((total, event) => total + event.queue.waiting, 0),
        active: events.reduce((total, event) => total + event.queue.called + event.queue.inProgress, 0),
      },
    },
    events,
    truncated: false,
    scope: downloaded.length ? 'DEVICE_LOCAL' : 'SERVER',
  };
}
