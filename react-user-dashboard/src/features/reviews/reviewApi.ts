import apiClient from '../../utils/apiClient';
import type { components } from '../../generated/api';

export type ReviewQueueResponse = components['schemas']['ReviewQueueResponse'];
export type ReviewQueueItem = components['schemas']['ReviewQueueItem'];
export type ReviewDetailResponse = components['schemas']['ReviewDetailResponse'];
export type ReviewDecisionRequest = components['schemas']['ReviewDecisionRequest'];
export type ReviewDecisionResponse = components['schemas']['ReviewDecisionResponse'];
export type ReviewOutcome = components['schemas']['ReviewOutcome'];
export type OverallFlag = components['schemas']['OverallFlag'];

export const reviewApi = {
  async list(eventId: string) {
    const { data } = await apiClient.get<ReviewQueueResponse>(`/events/${eventId}/reviews`);
    return data;
  },
  async get(eventId: string, registrationId: string) {
    const { data } = await apiClient.get<ReviewDetailResponse>(`/events/${eventId}/reviews/${registrationId}`);
    return data;
  },
  async decide(eventId: string, registrationId: string, decision: ReviewDecisionRequest) {
    const { data } = await apiClient.post<ReviewDecisionResponse>(`/events/${eventId}/reviews/${registrationId}/decision`, decision);
    return data;
  },
};
