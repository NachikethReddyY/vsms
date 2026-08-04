import type { components } from '../../generated/api';
import apiClient from '../../utils/apiClient';

export type OperationalReport = components['schemas']['OperationalReport'];
export type OperationalReportEvent = components['schemas']['OperationalReportEvent'];

export type ReportFilters = {
  eventId?: string;
  from: string;
  to: string;
};

export const reportApi = {
  async operations(filters: ReportFilters, signal?: AbortSignal) {
    const { data } = await apiClient.get<OperationalReport>('/events/reports/operations', {
      params: { ...filters, eventId: filters.eventId || undefined },
      signal,
    });
    return data;
  },
};
