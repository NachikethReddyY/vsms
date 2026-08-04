import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearStoredSession, setStoredSession } from '../../utils/session';
import type { IssueReferralRequest } from './reviewApi';
import {
  readStoredReferralIssue,
  REFERRAL_RECOVERY_WINDOW_MS,
  referralIssueStorageKey,
  writeStoredReferralIssue,
} from './referralRecovery';

class MemoryStorage implements Storage {
  private values = new Map<string, string>();

  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

const eventId = '11111111-1111-4111-8111-111111111111';
const referralId = '22222222-2222-4222-8222-222222222222';
const now = Date.parse('2026-08-04T10:00:00.000Z');
const request: IssueReferralRequest = {
  destinationEmail: 'clinic@example.com',
  signatureObjectKey: 'signatures/reviewer.png',
  signatureSha256: 'a'.repeat(64),
  signatureMimeType: 'image/png',
  idempotencyKey: '33333333-3333-4333-8333-333333333333',
  confirmed: true,
};

beforeEach(() => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { sessionStorage: new MemoryStorage() },
  });
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'window');
});

describe('referral recovery storage privacy', () => {
  it('uses a 15-minute fallback expiry and deletes the request at expiry', () => {
    writeStoredReferralIssue(eventId, referralId, request, null, now);

    const stored = JSON.parse(window.sessionStorage.getItem(referralIssueStorageKey(eventId, referralId)) || '{}');
    expect(stored.expiresAt).toBe(now + REFERRAL_RECOVERY_WINDOW_MS);
    expect(readStoredReferralIssue(eventId, referralId, now + REFERRAL_RECOVERY_WINDOW_MS - 1)).toEqual(request);
    expect(readStoredReferralIssue(eventId, referralId, now + REFERRAL_RECOVERY_WINDOW_MS)).toBeNull();
    expect(window.sessionStorage.getItem(referralIssueStorageKey(eventId, referralId))).toBeNull();
  });

  it('reuses the server escrow expiry when it is present', () => {
    const serverExpiry = '2026-08-04T10:07:00.000Z';
    writeStoredReferralIssue(eventId, referralId, request, serverExpiry, now);

    const stored = JSON.parse(window.sessionStorage.getItem(referralIssueStorageKey(eventId, referralId)) || '{}');
    expect(stored.expiresAt).toBe(Date.parse(serverExpiry));
    expect(readStoredReferralIssue(eventId, referralId, Date.parse(serverExpiry))).toBeNull();
  });

  it('does not extend an expired or invalid server escrow expiry', () => {
    expect(writeStoredReferralIssue(eventId, referralId, request, '2026-08-04T09:59:00.000Z', now)).toBe(false);
    expect(writeStoredReferralIssue(eventId, referralId, request, 'invalid-date', now)).toBe(false);
    expect(window.sessionStorage.getItem(referralIssueStorageKey(eventId, referralId))).toBeNull();
  });

  it('deletes legacy or malformed recovery records instead of prefilling them', () => {
    const key = referralIssueStorageKey(eventId, referralId);
    window.sessionStorage.setItem(key, JSON.stringify(request));

    expect(readStoredReferralIssue(eventId, referralId, now)).toBeNull();
    expect(window.sessionStorage.getItem(key)).toBeNull();
  });

  it('clears every referral issue on session invalidation while preserving unrelated state', () => {
    setStoredSession({
      user: { id: '44444444-4444-4444-8444-444444444444' },
      expiresAt: now + 60_000,
    } as Parameters<typeof setStoredSession>[0]);
    writeStoredReferralIssue(eventId, referralId, request, null, now);
    window.sessionStorage.setItem('vsms.referral-issue:another:event', 'sensitive');
    window.sessionStorage.setItem('vsms_event_id', eventId);

    clearStoredSession();

    expect(window.sessionStorage.getItem('vsms_staff_session')).toBeNull();
    expect(window.sessionStorage.getItem(referralIssueStorageKey(eventId, referralId))).toBeNull();
    expect(window.sessionStorage.getItem('vsms.referral-issue:another:event')).toBeNull();
    expect(window.sessionStorage.getItem('vsms_event_id')).toBe(eventId);
  });
});
