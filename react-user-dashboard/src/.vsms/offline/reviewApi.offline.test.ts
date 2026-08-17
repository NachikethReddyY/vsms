import { beforeEach, expect, it, vi } from 'vitest';

const dependencies = vi.hoisted(() => ({
  getOfflineReviewQueue: vi.fn(),
  getOfflineReviewDetail: vi.fn(),
  queueOfflineReviewDecision: vi.fn(),
}));

vi.mock('../../utils/apiClient', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock('../../utils/session', () => ({
  getStoredSession: () => ({ user: { id: '11111111-1111-4111-8111-111111111111' }, expiresAt: Date.now() + 60_000 }),
}));
vi.mock('../../features/screening/offlineSync', () => ({
  downloadOfflineEvent: vi.fn(),
  ...dependencies,
}));

import apiClient from '../../utils/apiClient';
import { reviewApi, type ReviewDetailResponse, type ReviewQueueResponse } from '../../features/reviews/reviewApi';

const eventId = '22222222-2222-4222-8222-222222222222';
const registrationId = '33333333-3333-4333-8333-333333333333';
const reviewEvent = { eventId, name: 'Offline Review', venue: 'Hall', timezone: 'Asia/Singapore', status: 'IN_PROGRESS' as const };
const queue = { event: reviewEvent, queue: [] } satisfies ReviewQueueResponse;
const detail = {
  event: reviewEvent,
  participant: {
    registrationId,
    participantDisplayName: 'Offline Participant',
    queueNumber: 1,
    registrationStatus: 'CHECKED_IN',
    maskedNric: 'S****567D',
    dateOfBirth: '1980-01-01',
    gender: 'F',
  },
  stations: [],
  readiness: { ready: true, readyReason: 'SCREENING_COMPLETE', completedStationCount: 1, skippedStationCount: 0, totalStationCount: 1, highestFlag: 'NORMAL' },
  existingReview: null,
  contextVersion: 'a'.repeat(64),
} satisfies ReviewDetailResponse;

beforeEach(() => {
  vi.clearAllMocks();
  dependencies.getOfflineReviewQueue.mockResolvedValue(queue);
  dependencies.getOfflineReviewDetail.mockResolvedValue(detail);
});

it('reads the prepared reviewer queue and detail without network requests', async () => {
  await expect(reviewApi.list(eventId)).resolves.toEqual(queue);
  await expect(reviewApi.get(eventId, registrationId)).resolves.toEqual(detail);
  expect(apiClient.get).not.toHaveBeenCalled();
});

it('records a signed decision through the encrypted local outbox', async () => {
  dependencies.queueOfflineReviewDecision.mockResolvedValue({ clientActionId: 'action-1', savedOnDevice: true });
  const decision = { outcome: 'COMPLETE' as const, contextVersion: 'a'.repeat(64), confirmed: true as const, clinicalSummary: 'Clinical decision summary.' };
  await expect(reviewApi.decide(eventId, registrationId, decision, 'data:image/png;base64,signature')).resolves.toMatchObject({ savedOnDevice: true });
  expect(dependencies.queueOfflineReviewDecision).toHaveBeenCalledWith(
    '11111111-1111-4111-8111-111111111111', eventId, registrationId, decision, 'data:image/png;base64,signature',
  );
  expect(apiClient.post).not.toHaveBeenCalled();
});
