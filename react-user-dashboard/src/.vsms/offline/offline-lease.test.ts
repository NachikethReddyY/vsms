import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { verifyOfflineEventPackLease } from '../../features/screening/offlineSync';

const ownerId = '11111111-1111-4111-8111-111111111111';
const eventId = '22222222-2222-4222-8222-222222222222';
const deviceId = '33333333-3333-4333-8333-333333333333';
const leaseKeys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const exportedPublicKey = leaseKeys.publicKey.export({ format: 'jwk' });
const publicKey = { kty: 'EC', crv: 'P-256', x: exportedPublicKey.x, y: exportedPublicKey.y };
const keyId = createHash('sha256').update(JSON.stringify(publicKey)).digest('base64url');

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(object).sort().map((key) => [key, canonicalJson(object[key])]));
  }
  return value;
}

function signedPack() {
  const capabilities = { screening: true, registration: false, queue: true, review: false, routeOverride: true, stationAvailability: false };
  const content = {
    schemaVersion: 1 as const,
    packId: 'a'.repeat(43),
    generatedAt: '2026-08-17T08:00:00.000Z',
    expiresAt: '2099-08-17T10:00:00.000Z',
    event: { eventId },
    roles: ['EVENT_MANAGER'],
    capabilities,
  };
  const payload = {
    schemaVersion: 1 as const,
    packId: content.packId,
    actorId: ownerId,
    eventId,
    deviceId,
    issuedAt: content.generatedAt,
    expiresAt: content.expiresAt,
    roles: content.roles,
    capabilities,
    contentDigest: createHash('sha256').update(JSON.stringify(canonicalJson(content))).digest('base64url'),
  };
  return {
    ...content,
    lease: {
      algorithm: 'ES256' as const,
      keyId,
      publicKey,
      payload,
      signature: sign('sha256', Buffer.from(JSON.stringify(payload)), {
        key: leaseKeys.privateKey,
        dsaEncoding: 'ieee-p1363',
      }).toString('base64url'),
    },
  } as unknown as Parameters<typeof verifyOfflineEventPackLease>[0];
}

afterEach(() => vi.unstubAllEnvs());

describe('offline capability lease', () => {
  it('accepts an exact device-bound signature and rejects changed bindings or an untrusted configured key', async () => {
    const pack = signedPack();
    await expect(verifyOfflineEventPackLease(pack, ownerId, eventId, deviceId)).resolves.toBeUndefined();

    const changedDevice = structuredClone(pack);
    changedDevice.lease.payload.deviceId = crypto.randomUUID();
    await expect(verifyOfflineEventPackLease(changedDevice, ownerId, eventId, deviceId)).rejects.toThrow(/does not match this device/i);

    const changedCapabilities = structuredClone(pack);
    changedCapabilities.capabilities.routeOverride = false;
    await expect(verifyOfflineEventPackLease(changedCapabilities, ownerId, eventId, deviceId)).rejects.toThrow(/invalid|does not match/i);

    const changedContent = structuredClone(pack);
    (changedContent.event as { name?: string }).name = 'Tampered event';
    await expect(verifyOfflineEventPackLease(changedContent, ownerId, eventId, deviceId)).rejects.toThrow(/integrity/i);

    const changedSignature = structuredClone(pack);
    changedSignature.lease.signature = `${changedSignature.lease.signature.startsWith('A') ? 'B' : 'A'}${changedSignature.lease.signature.slice(1)}`;
    await expect(verifyOfflineEventPackLease(changedSignature, ownerId, eventId, deviceId)).rejects.toThrow(/signature is invalid/i);

    vi.stubEnv('VITE_OFFLINE_LEASE_KEY_ID', 'untrusted');
    await expect(verifyOfflineEventPackLease(pack, ownerId, eventId, deviceId)).rejects.toThrow(/untrusted key/i);
  });
});
