import apiClient from '../../utils/apiClient';
import type { components } from '../../generated/api';

export type ReviewQueueResponse = components['schemas']['ReviewQueueResponse'];
export type ReviewQueueItem = components['schemas']['ReviewQueueItem'];
export type ReviewDetailResponse = components['schemas']['ReviewDetailResponse'];
export type ReviewDecisionRequest = components['schemas']['ReviewDecisionRequest'];
export type ReviewDecisionResponse = components['schemas']['ReviewDecisionResponse'];
export type ReviewOutcome = components['schemas']['ReviewOutcome'];
export type OverallFlag = components['schemas']['OverallFlag'];
export type IssueReferralRequest = components['schemas']['IssueReferralRequest'];
export type IssueReferralResponse = components['schemas']['IssueReferralResponse'];
export type AcknowledgeReferralHandoffRequest = components['schemas']['AcknowledgeReferralHandoffRequest'];
export type AcknowledgeReferralHandoffResponse = components['schemas']['AcknowledgeReferralHandoffResponse'];
export type SignatureResponse = components['schemas']['SignatureResponse'];

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
  async issueReferral(eventId: string, referralId: string, request: IssueReferralRequest) {
    const { data } = await apiClient.post<IssueReferralResponse>(`/events/${eventId}/referrals/${referralId}/issue`, request);
    return data;
  },
  async acknowledgeReferralHandoff(eventId: string, referralId: string, request: AcknowledgeReferralHandoffRequest) {
    const { data } = await apiClient.post<AcknowledgeReferralHandoffResponse>(`/events/${eventId}/referrals/${referralId}/issue/acknowledge`, request);
    return data;
  },
  async uploadSignature(eventId: string, targetId: string, dataUrl: string) {
    const { data } = await apiClient.post<SignatureResponse>('/signatures', { dataUrl, eventId, purpose: 'REFERRAL', targetId });
    return data;
  },
  async downloadReferral(eventId: string, referralId: string, documentId: string) {
    const { data } = await apiClient.get<Blob>(`/events/${eventId}/referrals/${referralId}/documents/${documentId}`, { responseType: 'blob' });
    return data;
  },
};
