import type { components } from '../../generated/api';
import apiClient from '../../utils/apiClient';

export type OperationsOverview = components['schemas']['OperationsOverview'];
export type OperationsEvent = components['schemas']['OperationsEvent'];
export type OperationsStatusFilter = OperationsOverview['filters']['status'];

export const operationsApi = {
  async overview(params: { status: OperationsStatusFilter; search?: string }, signal?: AbortSignal) {
    const { data } = await apiClient.get<OperationsOverview>('/operations', {
      params: { ...params, search: params.search || undefined, limit: 50 },
      signal,
    });
    return data;
  },
};
