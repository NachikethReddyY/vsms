import { REFERRAL_ISSUE_STORAGE_PREFIX } from '../../utils/session';
import type { IssueReferralRequest } from './reviewApi';

export const REFERRAL_RECOVERY_WINDOW_MS = 15 * 60 * 1000;

type StoredReferralIssue = {
  request: IssueReferralRequest;
  expiresAt: number;
};

export const referralIssueStorageKey = (eventId: string, referralId: string) =>
  `${REFERRAL_ISSUE_STORAGE_PREFIX}${eventId}:${referralId}`;

const isIssueReferralRequest = (value: unknown): value is IssueReferralRequest => {
  if (!value || typeof value !== 'object') return false;
  const request = value as Partial<IssueReferralRequest>;
  return typeof request.idempotencyKey === 'string'
    && typeof request.destinationEmail === 'string'
    && typeof request.signatureObjectKey === 'string'
    && typeof request.signatureSha256 === 'string'
    && (request.signatureMimeType === 'image/png' || request.signatureMimeType === 'image/jpeg')
    && request.confirmed === true;
};

export function removeStoredReferralIssue(eventId: string, referralId: string) {
  try {
    window.sessionStorage.removeItem(referralIssueStorageKey(eventId, referralId));
  } catch {
    // Recovery storage is best-effort and must not interrupt the clinical workflow.
  }
}

export function readStoredReferralIssue(
  eventId: string,
  referralId: string,
  now = Date.now(),
): IssueReferralRequest | null {
  try {
    const value = window.sessionStorage.getItem(referralIssueStorageKey(eventId, referralId));
    if (!value) return null;
    const parsed = JSON.parse(value) as Partial<StoredReferralIssue>;
    if (!Number.isFinite(parsed.expiresAt) || Number(parsed.expiresAt) <= now || !isIssueReferralRequest(parsed.request)) {
      removeStoredReferralIssue(eventId, referralId);
      return null;
    }
    return parsed.request;
  } catch {
    removeStoredReferralIssue(eventId, referralId);
    return null;
  }
}

export function writeStoredReferralIssue(
  eventId: string,
  referralId: string,
  request: IssueReferralRequest,
  serverExpiresAt?: string | null,
  now = Date.now(),
) {
  const hasServerExpiry = Boolean(serverExpiresAt);
  const serverExpiry = serverExpiresAt ? Date.parse(serverExpiresAt) : Number.NaN;
  if (hasServerExpiry && !Number.isFinite(serverExpiry)) {
    removeStoredReferralIssue(eventId, referralId);
    return false;
  }
  const expiresAt = hasServerExpiry ? serverExpiry : now + REFERRAL_RECOVERY_WINDOW_MS;
  if (expiresAt <= now) {
    removeStoredReferralIssue(eventId, referralId);
    return false;
  }
  try {
    window.sessionStorage.setItem(
      referralIssueStorageKey(eventId, referralId),
      JSON.stringify({ request, expiresAt } satisfies StoredReferralIssue),
    );
    return true;
  } catch {
    // Recovery storage is best-effort and must not interrupt the clinical workflow.
    return false;
  }
}
