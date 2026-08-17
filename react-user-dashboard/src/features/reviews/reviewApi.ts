import apiClient from '../../utils/apiClient';
import type { components } from '../../generated/api';
import { getStoredSession } from '../../utils/session';
import {
  downloadOfflineEvent,
  getOfflineReviewDetail,
  getOfflineReviewQueue,
  queueOfflineReviewDecision,
} from '../screening/offlineSync';

export type ReviewQueueResponse = components['schemas']['ReviewQueueResponse'];
export type ReviewQueueItem = components['schemas']['ReviewQueueItem'];
export type ReviewDetailResponse = components['schemas']['ReviewDetailResponse'];
export type ReviewDecisionRequest = components['schemas']['ReviewDecisionRequest'];
type ReviewSignatureFields = 'signatureObjectKey' | 'signatureSha256' | 'signatureMimeType';
export type OfflineReviewDecision = ReviewDecisionRequest extends infer Decision
  ? Decision extends ReviewDecisionRequest ? Omit<Decision, ReviewSignatureFields> : never
  : never;
export type ReviewDecisionResponse = components['schemas']['ReviewDecisionResponse'];
export type ReviewOutcome = components['schemas']['ReviewOutcome'];
export type OverallFlag = components['schemas']['OverallFlag'];
export type IssueReferralRequest = components['schemas']['IssueReferralRequest'];
export type IssueReferralResponse = components['schemas']['IssueReferralResponse'];
export type AcknowledgeReferralHandoffRequest = components['schemas']['AcknowledgeReferralHandoffRequest'];
export type AcknowledgeReferralHandoffResponse = components['schemas']['AcknowledgeReferralHandoffResponse'];
export type ReviseReferralRequest = components['schemas']['ReviseReferralRequest'];
export type ReferralRevisionResponse = components['schemas']['ReferralRevisionResponse'];
export type SignatureResponse = components['schemas']['SignatureResponse'];

export const reviewApi = {
  async list(eventId: string) {
    const ownerId = getStoredSession()?.user.id;
    const local = ownerId ? await getOfflineReviewQueue(ownerId, eventId) : null;
    if (local) return local;
    const { data } = await apiClient.get<ReviewQueueResponse>(`/events/${eventId}/reviews`);
    return data;
  },
  async get(eventId: string, registrationId: string) {
    const ownerId = getStoredSession()?.user.id;
    const local = ownerId ? await getOfflineReviewDetail(ownerId, eventId, registrationId) : null;
    if (local) return local;
    const { data } = await apiClient.get<ReviewDetailResponse>(`/events/${eventId}/reviews/${registrationId}`);
    return data;
  },
  async scan(eventId: string, passToken: string) {
    const { data } = await apiClient.post<{ registrationId: string }>(`/events/${eventId}/reviews/scan`, { passToken });
    return data;
  },
  async decide(eventId: string, registrationId: string, decision: OfflineReviewDecision, signatureDataUrl: string) {
    const ownerId = getStoredSession()?.user.id;
    if (!ownerId) throw new Error('Your session is unavailable. Sign in again before recording a review.');
    if (!await getOfflineReviewDetail(ownerId, eventId, registrationId) && navigator.onLine) {
      await downloadOfflineEvent(ownerId, eventId);
    }
    return queueOfflineReviewDecision(ownerId, eventId, registrationId, decision, signatureDataUrl);
  },
  async issueReferral(eventId: string, referralId: string, request: IssueReferralRequest) {
    const { data } = await apiClient.post<IssueReferralResponse>(`/events/${eventId}/referrals/${referralId}/issue`, request);
    return data;
  },
  async reviseReferral(eventId: string, referralId: string, request: ReviseReferralRequest) {
    const { data } = await apiClient.post<ReferralRevisionResponse>(`/events/${eventId}/referrals/${referralId}/revisions`, request);
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
  async uploadDecisionSignature(eventId: string, registrationId: string, dataUrl: string) {
    const { data } = await apiClient.post<SignatureResponse>('/signatures', {
      dataUrl,
      eventId,
      purpose: 'REVIEW_DECISION',
      targetId: registrationId,
    });
    return data;
  },
  async downloadReferral(eventId: string, referralId: string, documentId: string) {
    const { data } = await apiClient.get<Blob>(`/events/${eventId}/referrals/${referralId}/documents/${documentId}`, { responseType: 'blob' });
    return data;
  },
};
