import 'fake-indexeddb/auto';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/apiClient', () => ({
  default: { get: vi.fn(), post: vi.fn() },
  getDeviceId: () => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  newIdempotencyHeaders: () => ({ 'Idempotency-Key': crypto.randomUUID() }),
}));

import apiClient from '../../utils/apiClient';
import { clearOfflineData, downloadOfflineEvent, getOfflineEvent, getOfflineSyncStatus } from '../../features/screening/offlineSync';

const ownerId = '11111111-1111-4111-8111-111111111111';
const eventId = '22222222-2222-4222-8222-222222222222';
const deviceId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const exported = keys.publicKey.export({ format: 'jwk' });
const publicKey = { kty: 'EC', crv: 'P-256', x: exported.x, y: exported.y };
const capabilities = { screening: false, registration: false, queue: false, review: false, routeOverride: false, stationAvailability: false };
const estimate = vi.fn<() => Promise<StorageEstimate>>();

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(object).sort().map((key) => [key, canonicalJson(object[key])]));
  }
  return value;
}

function pack(name: string) {
  const data = {
    schemaVersion: 1 as const,
    packId: 'a'.repeat(43),
    generatedAt: '2026-08-17T08:00:00.000Z',
    expiresAt: '2099-08-17T10:00:00.000Z',
    event: {
      eventId,
      name,
      timezone: 'Asia/Singapore',
      eventDays: [],
      eventStations: [],
      shifts: [],
    },
    roles: ['EVENT_MANAGER'],
    capabilities,
    screening: null,
  };
  const payload = {
    schemaVersion: 1 as const,
    packId: data.packId,
    actorId: ownerId,
    eventId,
    deviceId,
    issuedAt: data.generatedAt,
    expiresAt: data.expiresAt,
    roles: data.roles,
    capabilities,
    contentDigest: createHash('sha256').update(JSON.stringify(canonicalJson(data))).digest('base64url'),
  };
  return { data: {
    ...data,
    lease: {
      algorithm: 'ES256' as const,
      keyId: createHash('sha256').update(JSON.stringify(publicKey)).digest('base64url'),
      publicKey,
      payload,
      signature: 'AA',
    },
  } };
}

beforeEach(async () => {
  vi.mocked(apiClient.get).mockReset();
  estimate.mockReset();
  vi.stubGlobal('navigator', { storage: { estimate } });
  vi.spyOn(crypto.subtle, 'verify').mockResolvedValue(true);
  await clearOfflineData();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('offline device storage readiness', () => {
  it('reports encrypted snapshot size and keeps the old pack when confirmed free capacity is too low', async () => {
    estimate.mockResolvedValueOnce({ quota: 20 * 1024 * 1024, usage: 0 });
    vi.mocked(apiClient.get).mockResolvedValueOnce(pack('Prepared event'));
    await downloadOfflineEvent(ownerId, eventId);

    await expect(getOfflineSyncStatus(ownerId, eventId)).resolves.toMatchObject({
      downloaded: true,
      snapshotBytes: expect.any(Number),
    });

    estimate.mockResolvedValueOnce({ quota: 1024 * 1024, usage: 1024 * 1024 });
    vi.mocked(apiClient.get).mockResolvedValueOnce(pack('Replacement event'));
    await expect(downloadOfflineEvent(ownerId, eventId)).rejects.toThrow(/existing offline copy was kept/i);
    await expect(getOfflineEvent(ownerId, eventId)).resolves.toMatchObject({ name: 'Prepared event' });
  });
});
