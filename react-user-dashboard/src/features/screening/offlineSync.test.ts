import 'fake-indexeddb/auto';
import { createHash, generateKeyPairSync, sign as signBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/apiClient', () => ({
  default: { get: vi.fn(), post: vi.fn() },
  getDeviceId: () => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  newIdempotencyHeaders: () => ({ 'Idempotency-Key': '77777777-7777-4777-8777-777777777777' }),
}));

import apiClient from '../../utils/apiClient';
import {
  clearOfflineData,
  downloadOfflineEvent,
  evaluateOfflineStation,
  getOfflineCanonicalRegistration,
  getOfflineQueueStatus,
  getOfflineReviewQueue,
  getOfflineStationContext,
  getOfflineEvent,
  getOfflineSyncStatus,
  listOfflineEvents,
  purgeExpiredOfflineData,
  queueOfflineWalkInRegistration,
  queueOfflineStationSave,
  queueOfflineQueueAction,
  queueOfflineReviewDecision,
  syncOfflineEvent,
} from './offlineSync';

const ownerId = '11111111-1111-4111-8111-111111111111';
const eventId = '22222222-2222-4222-8222-222222222222';
const stationId = '33333333-3333-4333-8333-333333333333';
const registrationId = '44444444-4444-4444-8444-444444444444';
const expiry = '2099-08-05T09:00:00.000Z';
const get = vi.mocked(apiClient.get);
const post = vi.mocked(apiClient.post);
const leaseKeys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const exportedLeasePublicKey = leaseKeys.publicKey.export({ format: 'jwk' });
const leasePublicKey = {
  kty: 'EC',
  crv: 'P-256',
  x: exportedLeasePublicKey.x,
  y: exportedLeasePublicKey.y,
};

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(object).sort().map((key) => [key, canonicalJson(object[key])]));
  }
  return value;
}

function testContentDigest(pack: object) {
  return createHash('sha256').update(JSON.stringify(canonicalJson(JSON.parse(JSON.stringify(pack))))).digest('base64url');
}

function signedTestLease(expiresAt: string, capabilities: Record<string, boolean>, contentDigest: string) {
  const payload = {
    schemaVersion: 1 as const,
    packId: '55555555-5555-4555-8555-555555555555',
    actorId: ownerId,
    eventId,
    deviceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    issuedAt: '2026-08-04T10:00:00.000Z',
    expiresAt,
    roles: ['SCREENER'],
    capabilities,
    contentDigest,
  };
  return {
    algorithm: 'ES256' as const,
    keyId: createHash('sha256').update(JSON.stringify(leasePublicKey)).digest('base64url'),
    publicKey: leasePublicKey,
    payload,
    signature: signBytes('sha256', Buffer.from(JSON.stringify(payload)), {
      key: leaseKeys.privateKey,
      dsaEncoding: 'ieee-p1363',
    }).toString('base64url'),
  };
}

const vaFieldSchema = [
  { key: 'chartDistanceMetres', label: 'Chart distance (m)', type: 'select', required: true, options: ['3', '6'] },
  { key: 'od', label: 'Right eye (OD)', type: 'va-eye', required: true },
  { key: 'os', label: 'Left eye (OS)', type: 'va-eye', required: true },
  { key: 'withUsualDistanceGlasses', label: 'With usual distance glasses', type: 'select', required: true, options: ['yes', 'no', 'unknown'] },
];

type ActionResult = {
  clientActionId: string;
  status: 'APPLIED' | 'CONFLICT' | 'FAILED';
  retryCount: number;
  errorCode?: string;
  result?: {
    routeProgression?: {
      status: 'ADDED_TO_QUEUE' | 'REVIEW_READY' | 'BLOCKED' | 'CORRECTION_SAVED';
      routeVersion?: number;
      completedStation?: { stationId: string; stationName: string; stationType: string } | null;
      nextStation?: { stationId: string; stationName: string; stationType: string } | null;
      nextQueue?: { stationId: string; stationName: string; stationType: string; queueNumber: number; status: 'WAITING' } | null;
    } | null;
  };
};

type SyncRequest = {
  actions: Array<{
    clientActionId: string;
    stationId: string;
    stationType: string;
    payload: { registrationId: string };
  }>;
};

const syncRequest = (value: unknown) => value as SyncRequest;

function response(actions: ActionResult[] = [], expiresAt = expiry) {
  return {
    data: {
      clientBatchId: crypto.randomUUID(),
      serverTime: '2026-08-04T10:00:00.000Z',
      cursor: '2026-08-04T10:00:00.000Z',
      actions,
      pull: {
        event: { eventId, name: 'Vision Screening', status: 'IN_PROGRESS' },
        stations: [{
          stationId,
          eventId,
          stationName: 'Visual Acuity',
          stationType: 'VISUAL_ACUITY',
          stationOrder: 1,
          isActive: true,
          fieldSchemaSnapshot: vaFieldSchema,
          schemaVersion: 1,
          offlineAccessExpiresAt: expiresAt,
          registrations: [{
            registrationId,
            participantDisplayName: 'Encrypted Queue Person',
            queueNumber: 1,
            status: 'CHECKED_IN',
            passToken: 'defensively-removed-pass-token',
            existingResult: null,
          }],
        }],
      },
    },
  };
}

function packResponse(
  expiresAt = expiry,
  screening: ReturnType<typeof response>['data']['pull'] | null = response([], expiresAt).data.pull,
  registration?: { stations: Array<{ stationId: string; stationName: string; stationType: string; stationOrder: number }>; nextQueueNumber: number },
  queue?: import('../queue/queueApi').EventQueueStatus,
  review?: import('../reviews/reviewApi').ReviewQueueResponse & { details: import('../reviews/reviewApi').ReviewDetailResponse[] },
) {
  const capabilities = { screening: true, registration: false, queue: false, review: false, routeOverride: false, stationAvailability: false };
  const data = {
      schemaVersion: 1 as const,
      packId: '55555555-5555-4555-8555-555555555555',
      generatedAt: '2026-08-04T10:00:00.000Z',
      expiresAt,
      roles: ['SCREENER'],
      capabilities,
      event: {
        eventId,
        id: eventId,
        name: 'Vision Screening',
        eventName: 'Vision Screening',
        description: 'Community event',
        bannerKey: 'COMMUNITY_SCREENING',
        artworkDataUrl: null,
        venue: 'Community Hall',
        location: 'Community Hall',
        address: '1 Test Street',
        postalCode: '123456',
        latitude: null,
        longitude: null,
        locationProvider: null,
        locationReference: null,
        timezone: 'Asia/Singapore',
        startsAt: '2099-08-05T01:00:00.000Z',
        eventDate: '2099-08-05T01:00:00.000Z',
        startTime: '2099-08-05T01:00:00.000Z',
        endsAt: expiry,
        endTime: expiry,
        capacity: 100,
        expectedAttendance: 80,
        status: 'IN_PROGRESS',
        version: 1,
        cancellationReason: null,
        cancelledAt: null,
        createdAt: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-04T00:00:00.000Z',
        eventDays: [],
        shifts: [],
        eventStations: [],
        signupCount: 1,
        activeCapacityCount: 1,
        _count: { eventRegistrations: 1 },
        canManage: false,
        eventTeam: [],
      },
      screening,
      registration,
      queue,
      review,
  };
  return { data: { ...data, lease: signedTestLease(expiresAt, capabilities, testContentDigest(data)) } };
}

function saveBody(overrides: Record<string, unknown> = {}) {
  return {
    registrationId,
    idempotencyKey: crypto.randomUUID(),
    acknowledged: false,
    resultData: {
      chartDistanceMetres: 6 as const,
      od: { kind: 'FRACTION' as const, denominator: 6 },
      os: { kind: 'FRACTION' as const, denominator: 6 },
      withUsualDistanceGlasses: true,
    },
    ...overrides,
  };
}

function dynamicSaveBody(overrides: Record<string, unknown> = {}) {
  return {
    registrationId,
    idempotencyKey: crypto.randomUUID(),
    acknowledged: false,
    resultData: {
      chartDistanceMetres: '6',
      od: { kind: 'FRACTION' as const, denominator: 6 },
      os: { kind: 'FRACTION' as const, denominator: 6 },
      withUsualDistanceGlasses: 'unknown',
    },
    ...overrides,
  };
}

async function rawRecords(): Promise<Array<{ kind: string; ciphertext: ArrayBuffer }>> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('vsms-screening-offline', 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise((resolve, reject) => {
      const request = database.transaction('records', 'readonly').objectStore('records').getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    database.close();
  }
}

async function corruptSnapshot() {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('vsms-screening-offline', 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    const transaction = database.transaction('records', 'readwrite');
    const store = transaction.objectStore('records');
    const records = await new Promise<Array<{ kind: string; ciphertext: ArrayBuffer } & Record<string, unknown>>>((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const snapshot = records.find((record) => record.kind === 'snapshot');
    if (snapshot) store.put({ ...snapshot, ciphertext: new Uint8Array([1, 2, 3]).buffer });
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

beforeEach(async () => {
  get.mockReset();
  post.mockReset();
  vi.useRealTimers();
  vi.spyOn(crypto.subtle, 'verify').mockResolvedValue(true);
  await clearOfflineData();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('encrypted screening outbox', () => {
  it('downloads a complete role-scoped pack and encrypts it at rest', async () => {
    get.mockResolvedValueOnce(packResponse());

    await downloadOfflineEvent(ownerId, eventId);

    expect(get).toHaveBeenCalledWith(`/events/${eventId}/offline-pack`);
    expect(post).not.toHaveBeenCalled();
    const context = await getOfflineStationContext(ownerId, eventId, 'VISUAL_ACUITY');
    expect(context?.queue[0]).toMatchObject({ participantDisplayName: 'Encrypted Queue Person' });
    expect(context?.queue[0]).not.toHaveProperty('passToken');

    const records = await rawRecords();
    expect(records).toHaveLength(1);
    const bytes = new TextDecoder().decode(records[0].ciphertext);
    expect(bytes).not.toContain('Encrypted Queue Person');
    expect(bytes).not.toContain('defensively-removed-pass-token');
    expect(bytes).not.toContain(registrationId);
    expect(await getOfflineEvent(ownerId, eventId)).toMatchObject({ eventId, name: 'Vision Screening' });
    expect(await listOfflineEvents(ownerId)).toHaveLength(1);
  });

  it('pushes a stable encrypted action through the batch API and clears it only when applied', async () => {
    get.mockResolvedValueOnce(packResponse());
    await downloadOfflineEvent(ownerId, eventId);
    await queueOfflineStationSave(ownerId, eventId, stationId, 'visual-acuity', saveBody());
    await expect(queueOfflineStationSave(ownerId, eventId, stationId, 'visual-acuity', saveBody()))
      .rejects.toThrow(/already saved.*pending sync/i);

    const encrypted = (await rawRecords()).find((record) => record.kind === 'mutation');
    const bytes = new TextDecoder().decode(encrypted?.ciphertext);
    expect(bytes).not.toContain(registrationId);
    expect(bytes).not.toContain('chartDistanceMetres');

    const nextStationId = '55555555-5555-4555-8555-555555555555';
    post.mockImplementationOnce(async (_url, body) => response([{
      clientActionId: syncRequest(body).actions[0].clientActionId,
      status: 'APPLIED',
      retryCount: 0,
      result: {
        routeProgression: {
          status: 'ADDED_TO_QUEUE',
          routeVersion: 2,
          completedStation: { stationId, stationName: 'Visual Acuity', stationType: 'VISUAL_ACUITY' },
          nextStation: { stationId: nextStationId, stationName: 'Refraction', stationType: 'REFRACTION' },
          nextQueue: { stationId: nextStationId, stationName: 'Refraction', stationType: 'REFRACTION', queueNumber: 1, status: 'WAITING' },
        },
      },
    }]));
    const result = await syncOfflineEvent(ownerId, eventId);

    expect(result).toMatchObject({
      pending: 0,
      conflicts: 0,
      synced: 1,
      expired: false,
      committedProgressions: [{
        routeProgression: {
          status: 'ADDED_TO_QUEUE',
          nextQueue: { stationName: 'Refraction', status: 'WAITING' },
        },
      }],
    });
    expect(post).toHaveBeenCalledOnce();
    expect(post.mock.calls[0][0]).toBe(`/events/${eventId}/sync/screening`);
    expect(syncRequest(post.mock.calls[0][1]).actions[0]).toMatchObject({
      stationId,
      stationType: 'VISUAL_ACUITY',
      payload: { registrationId },
    });
    expect(post.mock.calls.some(([url]) => String(url).includes(`/stations/${stationId}/visual-acuity`))).toBe(false);
  });

  it('commits a walk-in registration locally and deletes its sensitive command only after an applied receipt', async () => {
    get.mockResolvedValueOnce(packResponse(expiry, {
      event: { eventId, name: 'Vision Screening', status: 'IN_PROGRESS' },
      stations: [],
    }, {
      stations: [{ stationId, stationName: 'Station 1', stationType: 'VISUAL_ACUITY', stationOrder: 1 }],
      nextQueueNumber: 17,
    }));
    await downloadOfflineEvent(ownerId, eventId);
    const saved = await queueOfflineWalkInRegistration(ownerId, eventId, {
      participant: {
        firstName: 'Ada', lastName: 'Lovelace', dateOfBirth: '1980-01-01', gender: 'F',
        contactNumber: '+6591234567', nric: 'S1234567D', email: 'ada@example.test', race: 'Other',
        nationality: 'Singaporean', addressStreet: '1 Test Street', addressUnit: '#01-01',
        addressPostalCode: '123456', preferredLanguage: 'English', accessibilityNotes: '',
      },
      emergencyContact: { contactName: 'Grace Hopper', relationship: 'Friend', phoneNumber: '+6597654321' },
      paperFormUsed: false,
    });
    expect(saved).toMatchObject({ queueNumber: 17, stationNumber: 1, savedOnDevice: true });
    expect(await getOfflineSyncStatus(ownerId, eventId)).toMatchObject({ pending: 1 });
    const encryptedBefore = await rawRecords();
    expect(encryptedBefore).toHaveLength(2);
    expect(encryptedBefore.map(({ ciphertext }) => new TextDecoder().decode(ciphertext)).join('')).not.toContain('S1234567D');

    const canonicalRegistrationId = '88888888-8888-4888-8888-888888888888';
    const qrImage = 'data:image/svg+xml;base64,PHN2Zy8+';
    post.mockImplementationOnce(async (_url, body) => {
      const request = body as { clientBatchId: string; actions: Array<{ clientActionId: string }> };
      return {
        data: {
          clientBatchId: request.clientBatchId,
          serverTime: '2026-08-04T10:01:00.000Z',
          actions: [{
            clientActionId: request.actions[0].clientActionId,
            status: 'APPLIED',
            retryCount: 0,
            result: {
              participantId: saved.participantId,
              registrationId: canonicalRegistrationId,
              queueNumber: 17,
              nextStation: { stationId, stationName: 'Station 1', stationNumber: 1 },
              canonicalQrAvailable: true,
            },
          }],
        },
      };
    }).mockResolvedValueOnce({ data: {
      qrId: '99999999-9999-4999-8999-999999999999',
      registrationId: canonicalRegistrationId,
      issuedAt: '2026-08-04T10:01:00.000Z',
      expiresAt: expiry,
      qrImage,
    } });
    const synced = await syncOfflineEvent(ownerId, eventId);
    expect(synced).toMatchObject({ synced: 1, pending: 0 });
    expect(post.mock.calls[0][0]).toBe(`/events/${eventId}/sync/operations`);
    expect(post.mock.calls[0][1]).toMatchObject({
      actions: [{
        type: 'REGISTRATION_CREATE',
        clientParticipantId: saved.participantId,
        clientRegistrationId: saved.registrationId,
        proposed: { queueNumber: 17, nextStationNumber: 1 },
      }],
    });
    expect(post.mock.calls[1]).toEqual([
      `/qr/registrations/${canonicalRegistrationId}`,
      undefined,
      { headers: { 'Idempotency-Key': '77777777-7777-4777-8777-777777777777' } },
    ]);
    await expect(getOfflineCanonicalRegistration(ownerId, eventId, saved.registrationId)).resolves.toMatchObject({
      localRegistrationId: saved.registrationId,
      registrationId: canonicalRegistrationId,
      queueNumber: 17,
      qrImage,
      eventName: 'Vision Screening',
    });
    expect(await rawRecords()).toHaveLength(1);
    expect(new TextDecoder().decode((await rawRecords())[0].ciphertext)).not.toContain(qrImage);

    get.mockResolvedValueOnce(packResponse(expiry, null, {
      stations: [{ stationId, stationName: 'Station 1', stationType: 'VISUAL_ACUITY', stationOrder: 1 }],
      nextQueueNumber: 18,
    }));
    await downloadOfflineEvent(ownerId, eventId);
    await expect(getOfflineCanonicalRegistration(ownerId, eventId, canonicalRegistrationId)).resolves.toMatchObject({
      localRegistrationId: saved.registrationId,
      registrationId: canonicalRegistrationId,
      qrImage,
    });
  });

  it('retains the encrypted registration command when canonical QR retrieval fails and retries the same action', async () => {
    get.mockResolvedValueOnce(packResponse(expiry, null, {
      stations: [{ stationId, stationName: 'Station 1', stationType: 'VISUAL_ACUITY', stationOrder: 1 }],
      nextQueueNumber: 17,
    }));
    await downloadOfflineEvent(ownerId, eventId);
    const saved = await queueOfflineWalkInRegistration(ownerId, eventId, {
      participant: {
        firstName: 'Ada', lastName: 'Lovelace', dateOfBirth: '1980-01-01', gender: 'F',
        contactNumber: '+6591234567', nric: 'S1234567D', email: 'ada@example.test', race: 'Other',
        nationality: 'Singaporean', addressStreet: '1 Test Street', addressUnit: '#01-01',
        addressPostalCode: '123456', preferredLanguage: 'English', accessibilityNotes: '',
      },
      emergencyContact: { contactName: 'Grace Hopper', relationship: 'Friend', phoneNumber: '+6597654321' },
      paperFormUsed: false,
    });
    const canonicalRegistrationId = '88888888-8888-4888-8888-888888888888';
    const applied = async (_url: string, body: unknown) => {
      const request = body as { clientBatchId: string; actions: Array<{ clientActionId: string }> };
      return { data: {
        clientBatchId: request.clientBatchId,
        serverTime: '2026-08-04T10:01:00.000Z',
        actions: [{
          clientActionId: request.actions[0].clientActionId,
          status: 'APPLIED',
          retryCount: 0,
          result: {
            participantId: saved.participantId,
            registrationId: canonicalRegistrationId,
            queueNumber: 17,
            nextStation: { stationId, stationName: 'Station 1', stationNumber: 1 },
            canonicalQrAvailable: true,
          },
        }],
      } };
    };
    post.mockImplementationOnce(applied).mockRejectedValueOnce(Object.assign(new Error('offline'), { code: 'ERR_NETWORK' }));

    await expect(syncOfflineEvent(ownerId, eventId)).resolves.toMatchObject({ synced: 0, pending: 1 });
    expect(await rawRecords()).toHaveLength(2);
    await expect(getOfflineCanonicalRegistration(ownerId, eventId, saved.registrationId)).resolves.toBeNull();
    const firstClientActionId = (post.mock.calls[0][1] as { actions: Array<{ clientActionId: string }> }).actions[0].clientActionId;

    post.mockImplementationOnce(applied).mockResolvedValueOnce({ data: {
      qrId: '99999999-9999-4999-8999-999999999999',
      registrationId: canonicalRegistrationId,
      issuedAt: '2026-08-04T10:01:00.000Z',
      expiresAt: expiry,
      qrImage: 'data:image/svg+xml;base64,PHN2Zy8+',
    } });
    await expect(syncOfflineEvent(ownerId, eventId)).resolves.toMatchObject({ synced: 1, pending: 0 });
    expect((post.mock.calls[2][1] as { actions: Array<{ clientActionId: string }> }).actions[0].clientActionId).toBe(firstClientActionId);
    expect(await rawRecords()).toHaveLength(1);
  });

  it('maps dependent screening saves to the canonical registration before sync', async () => {
    get.mockResolvedValueOnce(packResponse(expiry, undefined, {
      stations: [{ stationId, stationName: 'Station 1', stationType: 'VISUAL_ACUITY', stationOrder: 1 }],
      nextQueueNumber: 17,
    }));
    await downloadOfflineEvent(ownerId, eventId);
    const saved = await queueOfflineWalkInRegistration(ownerId, eventId, {
      participant: {
        firstName: 'Ada', lastName: 'Lovelace', dateOfBirth: '1980-01-01', gender: 'F',
        contactNumber: '+6591234567', nric: 'S1234567D', email: 'ada@example.test', race: 'Other',
        nationality: 'Singaporean', addressStreet: '1 Test Street', addressUnit: '#01-01',
        addressPostalCode: '123456', preferredLanguage: 'English', accessibilityNotes: '',
      },
      emergencyContact: { contactName: 'Grace Hopper', relationship: 'Friend', phoneNumber: '+6597654321' },
      paperFormUsed: false,
    });
    await queueOfflineStationSave(ownerId, eventId, stationId, 'visual-acuity', saveBody({ registrationId: saved.registrationId }));

    const canonicalRegistrationId = '88888888-8888-4888-8888-888888888888';
    post.mockImplementationOnce(async (_url, body) => {
      const request = body as { clientBatchId: string; actions: Array<{ clientActionId: string }> };
      return { data: {
        clientBatchId: request.clientBatchId,
        serverTime: '2026-08-04T10:01:00.000Z',
        actions: [{
          clientActionId: request.actions[0].clientActionId,
          status: 'APPLIED',
          retryCount: 0,
          result: {
            participantId: saved.participantId,
            registrationId: canonicalRegistrationId,
            queueNumber: 17,
            nextStation: { stationId, stationName: 'Station 1', stationNumber: 1 },
            canonicalQrAvailable: true,
          },
        }],
      } };
    }).mockResolvedValueOnce({ data: {
      qrId: '99999999-9999-4999-8999-999999999999',
      registrationId: canonicalRegistrationId,
      issuedAt: '2026-08-04T10:01:00.000Z',
      expiresAt: expiry,
      qrImage: 'data:image/svg+xml;base64,PHN2Zy8+',
    } }).mockImplementationOnce(async (_url, body) => response([{
      clientActionId: syncRequest(body).actions[0].clientActionId,
      status: 'APPLIED',
      retryCount: 0,
    }]));

    await expect(syncOfflineEvent(ownerId, eventId)).resolves.toMatchObject({ synced: 2, pending: 0 });
    expect(post.mock.calls[2][0]).toBe(`/events/${eventId}/sync/screening`);
    expect(syncRequest(post.mock.calls[2][1]).actions[0].payload.registrationId).toBe(canonicalRegistrationId);
  });

  it('applies queue actions locally and removes their encrypted command after sync', async () => {
    const queueId = '66666666-6666-4666-8666-666666666666';
    get.mockResolvedValueOnce(packResponse(expiry, null, undefined, {
      event: { eventId, name: 'Vision Screening', status: 'IN_PROGRESS', venue: null },
      stations: [],
      totals: { WAITING: 1, CALLED: 0, IN_PROGRESS: 0, COMPLETED: 0, SKIPPED: 0, CANCELLED: 0 },
      entries: [{
        id: queueId,
        queueNumber: 17,
        status: 'WAITING',
        isPriority: false,
        registrationId,
        stationId,
      }],
    }));
    await downloadOfflineEvent(ownerId, eventId);

    await expect(queueOfflineQueueAction(ownerId, eventId, queueId, 'CALL')).resolves.toMatchObject({ status: 'CALLED' });
    await expect(getOfflineQueueStatus(ownerId, eventId)).resolves.toMatchObject({
      totals: { WAITING: 0, CALLED: 1 },
      entries: [{ id: queueId, status: 'CALLED' }],
    });
    expect(await getOfflineSyncStatus(ownerId, eventId)).toMatchObject({ pending: 1 });

    post.mockImplementationOnce(async (_url, body) => {
      const request = body as { clientBatchId: string; actions: Array<{ clientActionId: string }> };
      return { data: {
        clientBatchId: request.clientBatchId,
        serverTime: '2026-08-04T10:01:00.000Z',
        actions: [{ clientActionId: request.actions[0].clientActionId, status: 'APPLIED', retryCount: 0 }],
      } };
    });

    await expect(syncOfflineEvent(ownerId, eventId)).resolves.toMatchObject({ synced: 1, pending: 0 });
    expect(post.mock.calls[0][0]).toBe(`/events/${eventId}/sync/operations`);
    expect(post.mock.calls[0][1]).toMatchObject({
      actions: [{ type: 'QUEUE_CALL', queueId, expectedStatus: 'WAITING' }],
    });
    expect(await rawRecords()).toHaveLength(1);
  });

  it('keeps a signed review encrypted locally, uploads its signature, then applies the decision', async () => {
    const queueItem = {
      registrationId,
      participantDisplayName: 'Review Participant',
      queueNumber: 17,
      highestFlag: 'REFER' as const,
      flaggedResultCount: 1,
      completedStationCount: 1,
      skippedStationCount: 0,
      totalStationCount: 1,
      readyReason: 'SCREENING_COMPLETE' as const,
      lastResultAt: '2026-08-04T09:50:00.000Z',
    };
    const reviewEvent = { eventId, name: 'Vision Screening', venue: 'Hall', timezone: 'Asia/Singapore', status: 'IN_PROGRESS' as const };
    get.mockResolvedValueOnce(packResponse(expiry, null, undefined, undefined, {
      event: reviewEvent,
      queue: [queueItem],
      details: [{
          event: reviewEvent,
          participant: {
            registrationId,
            participantDisplayName: 'Review Participant',
            queueNumber: 17,
            registrationStatus: 'CHECKED_IN',
            maskedNric: 'S****567D',
            dateOfBirth: '1980-01-01',
            gender: 'F',
          },
          stations: [],
          readiness: {
            ready: true,
            readyReason: 'SCREENING_COMPLETE',
            completedStationCount: 1,
            skippedStationCount: 0,
            totalStationCount: 1,
            highestFlag: 'REFER',
          },
          existingReview: null,
          contextVersion: 'a'.repeat(64),
        },
      ],
    }));
    await downloadOfflineEvent(ownerId, eventId);
    await queueOfflineReviewDecision(ownerId, eventId, registrationId, {
      outcome: 'COMPLETE',
      contextVersion: 'a'.repeat(64),
      confirmed: true,
      clinicalSummary: 'No further clinical action is required.',
    }, 'data:image/png;base64,encrypted-signature');
    expect(await getOfflineReviewQueue(ownerId, eventId)).toMatchObject({ queue: [] });
    expect(await getOfflineSyncStatus(ownerId, eventId)).toMatchObject({ pending: 1 });
    const serializedCiphertext = (await rawRecords()).map(({ ciphertext }) => new TextDecoder().decode(ciphertext)).join('');
    expect(serializedCiphertext).not.toContain('No further clinical action');
    expect(serializedCiphertext).not.toContain('encrypted-signature');

    post
      .mockResolvedValueOnce({ data: {
        signatureObjectKey: `${eventId}/${ownerId}/review.png`,
        signatureSha256: 'b'.repeat(64),
        signatureMimeType: 'image/png',
      } })
      .mockImplementationOnce(async (_url, body) => {
        const request = body as { clientBatchId: string; actions: Array<{ clientActionId: string }> };
        return { data: {
          clientBatchId: request.clientBatchId,
          serverTime: '2026-08-04T10:01:00.000Z',
          actions: [{ clientActionId: request.actions[0].clientActionId, status: 'APPLIED', retryCount: 0 }],
        } };
      });

    await expect(syncOfflineEvent(ownerId, eventId)).resolves.toMatchObject({ synced: 1, pending: 0 });
    expect(post.mock.calls[0][0]).toBe('/signatures');
    expect(post.mock.calls[1][0]).toBe(`/events/${eventId}/sync/operations`);
    expect(post.mock.calls[1][1]).toMatchObject({ actions: [{
      type: 'REVIEW_DECISION',
      registrationId,
      decision: { outcome: 'COMPLETE', signatureSha256: 'b'.repeat(64) },
    }] });
    expect(await rawRecords()).toHaveLength(1);
  });

  it('keeps failures retryable across reconnect and surfaces server conflicts', async () => {
    get.mockResolvedValueOnce(packResponse());
    await downloadOfflineEvent(ownerId, eventId);
    await queueOfflineStationSave(ownerId, eventId, stationId, 'visual-acuity', saveBody());

    post.mockRejectedValueOnce(Object.assign(new Error('offline'), { code: 'ERR_NETWORK' }));
    expect(await syncOfflineEvent(ownerId, eventId)).toMatchObject({ pending: 1, synced: 0, committedProgressions: [] });

    post.mockImplementationOnce(async (_url, body) => response([{
      clientActionId: syncRequest(body).actions[0].clientActionId,
      status: 'FAILED',
      retryCount: 0,
      errorCode: 'SYNC_APPLY_FAILED',
    }]));
    expect(await syncOfflineEvent(ownerId, eventId)).toMatchObject({ pending: 1, conflicts: 0, synced: 0, committedProgressions: [] });

    post.mockImplementationOnce(async (_url, body) => response([{
      clientActionId: syncRequest(body).actions[0].clientActionId,
      status: 'CONFLICT',
      retryCount: 1,
      errorCode: 'ROUTE_STATION_MISMATCH',
      result: {
        routeProgression: {
          status: 'ADDED_TO_QUEUE',
          nextQueue: {
            stationId,
            stationName: 'Must not be shown',
            stationType: 'VISUAL_ACUITY',
            queueNumber: 99,
            status: 'WAITING',
          },
        },
      },
    }]));
    expect(await syncOfflineEvent(ownerId, eventId)).toMatchObject({
      pending: 0,
      conflicts: 1,
      conflictCodes: ['ROUTE_STATION_MISMATCH'],
      synced: 0,
      committedProgressions: [],
    });
  });

  it('includes assigned eye-health stations in encrypted offline downloads', async () => {
    const eyeStationId = '55555555-5555-4555-8555-555555555555';
    const vaStationId = '11111111-1111-4111-8111-111111111111';
    get.mockResolvedValueOnce(packResponse(expiry, {
          event: { eventId, name: 'Vision Screening', status: 'IN_PROGRESS' },
          stations: [
            {
              stationId: vaStationId,
              eventId,
              stationName: 'Visual Acuity',
              stationType: 'VISUAL_ACUITY',
              stationOrder: 1,
              isActive: true,
              fieldSchemaSnapshot: vaFieldSchema,
              schemaVersion: 1,
              offlineAccessExpiresAt: expiry,
              registrations: [{
                registrationId,
                participantDisplayName: 'Encrypted Queue Person',
                queueNumber: 1,
                status: 'CHECKED_IN',
                passToken: 'defensively-removed-pass-token',
                existingResult: null,
              }],
            },
            {
              stationId: eyeStationId,
              eventId,
              stationName: 'Eye Health',
              stationType: 'EYE_HEALTH',
              stationOrder: 4,
              isActive: true,
              fieldSchemaSnapshot: [],
              schemaVersion: 1,
              offlineAccessExpiresAt: expiry,
              registrations: [{
                registrationId,
                participantDisplayName: 'Encrypted Queue Person',
                queueNumber: 1,
                status: 'CHECKED_IN',
                passToken: 'defensively-removed-pass-token',
                existingResult: null,
              }],
            },
          ],
        }));
    await downloadOfflineEvent(ownerId, eventId);
    expect(await getOfflineStationContext(ownerId, eventId, 'VISUAL_ACUITY')).toBeTruthy();
    expect(await getOfflineStationContext(ownerId, eventId, 'EYE_HEALTH')).toMatchObject({
      station: { stationId: eyeStationId, stationType: 'EYE_HEALTH' },
      queue: [expect.objectContaining({ registrationId })],
    });
  });

  it('locks expired pending work for recovery and clears it only through deliberate device cleanup', async () => {
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValue(Date.parse('2026-08-04T10:00:00.000Z'));
    get.mockResolvedValueOnce(packResponse('2026-08-04T11:00:00.000Z'));
    await downloadOfflineEvent(ownerId, eventId);
    await queueOfflineStationSave(ownerId, eventId, stationId, 'visual-acuity', saveBody());

    now.mockReturnValue(Date.parse('2026-08-04T12:00:00.000Z'));
    await purgeExpiredOfflineData(ownerId);
    expect(await getOfflineSyncStatus(ownerId, eventId)).toEqual({
      downloaded: false,
      pending: 1,
      conflicts: 0,
      locked: 1,
      expiresAt: '2026-08-04T11:00:00.000Z',
      snapshotBytes: expect.any(Number),
      conflictCodes: [],
    });
    expect(await rawRecords()).toHaveLength(2);

    now.mockReturnValue(Date.parse('2026-08-12T12:00:00.000Z'));
    await purgeExpiredOfflineData(ownerId);
    expect(await getOfflineSyncStatus(ownerId, eventId)).toMatchObject({ pending: 1, locked: 1 });
    expect(await rawRecords()).toHaveLength(2);

    await clearOfflineData();
    expect(await rawRecords()).toEqual([]);
  });

  it('renews authorized pending work after a fresh signed pack and syncs it', async () => {
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValue(Date.parse('2026-08-04T10:00:00.000Z'));
    get.mockResolvedValueOnce(packResponse('2026-08-04T11:00:00.000Z'));
    await downloadOfflineEvent(ownerId, eventId);
    await queueOfflineStationSave(ownerId, eventId, stationId, 'visual-acuity', saveBody());

    now.mockReturnValue(Date.parse('2026-08-04T12:00:00.000Z'));
    expect(await getOfflineSyncStatus(ownerId, eventId)).toMatchObject({ downloaded: false, pending: 1, locked: 1 });
    get.mockResolvedValueOnce(packResponse('2026-08-04T13:00:00.000Z'));
    await downloadOfflineEvent(ownerId, eventId);
    expect(await getOfflineSyncStatus(ownerId, eventId)).toMatchObject({ downloaded: true, pending: 1, locked: 0 });

    post.mockImplementationOnce(async (_url, body) => response([{
      clientActionId: syncRequest(body).actions[0].clientActionId,
      status: 'APPLIED',
      retryCount: 0,
    }], '2026-08-04T13:00:00.000Z'));
    await expect(syncOfflineEvent(ownerId, eventId)).resolves.toMatchObject({ synced: 1, pending: 0, locked: 0 });
  });

  it('drops an unreadable snapshot without deleting encrypted unconfirmed work', async () => {
    get.mockResolvedValueOnce(packResponse());
    await downloadOfflineEvent(ownerId, eventId);
    await queueOfflineStationSave(ownerId, eventId, stationId, 'visual-acuity', saveBody());
    await corruptSnapshot();

    await expect(getOfflineEvent(ownerId, eventId)).resolves.toBeNull();
    await expect(getOfflineSyncStatus(ownerId, eventId)).resolves.toMatchObject({ downloaded: false, pending: 1 });
    expect((await rawRecords()).map(({ kind }) => kind)).toEqual(['mutation']);
  });

  it('keeps clinical VA flagging for dynamic-schema offline saves and syncs as VISUAL_ACUITY', async () => {
    const urgent = evaluateOfflineStation('dynamic', {
      chartDistanceMetres: '6',
      od: { kind: 'EXCEPTION', code: 'NLP' },
      os: { kind: 'FRACTION', denominator: 6 },
      withUsualDistanceGlasses: 'unknown',
    }, 'VISUAL_ACUITY');
    expect(urgent).toMatchObject({ overallFlag: 'URGENT', isFlagged: true, ruleVersion: 'VSMS-VA-1.0' });

    const normal = evaluateOfflineStation('dynamic', {
      chartDistanceMetres: '6',
      od: { kind: 'FRACTION', denominator: 6 },
      os: { kind: 'FRACTION', denominator: 6 },
      withUsualDistanceGlasses: 'no',
    }, 'VISUAL_ACUITY');
    expect(normal).toMatchObject({ overallFlag: 'NORMAL', isFlagged: false });

    get.mockResolvedValueOnce(packResponse());
    await downloadOfflineEvent(ownerId, eventId);
    const context = await getOfflineStationContext(ownerId, eventId, 'VISUAL_ACUITY');
    expect(context?.station.fieldSchemaSnapshot).toEqual(vaFieldSchema);

    await expect(queueOfflineStationSave(
      ownerId,
      eventId,
      stationId,
      'dynamic',
      dynamicSaveBody({
        acknowledged: false,
        resultData: {
          chartDistanceMetres: '6',
          od: { kind: 'EXCEPTION', code: 'NLP' },
          os: { kind: 'FRACTION', denominator: 6 },
          withUsualDistanceGlasses: 'unknown',
        },
      }),
    )).rejects.toThrow(/must be acknowledged/i);

    await queueOfflineStationSave(
      ownerId,
      eventId,
      stationId,
      'dynamic',
      dynamicSaveBody({
        acknowledged: true,
        resultData: {
          chartDistanceMetres: '6',
          od: { kind: 'EXCEPTION', code: 'NLP' },
          os: { kind: 'FRACTION', denominator: 6 },
          withUsualDistanceGlasses: 'unknown',
        },
      }),
    );

    post.mockImplementationOnce(async (_url, body) => response([{
      clientActionId: syncRequest(body).actions[0].clientActionId,
      status: 'APPLIED',
      retryCount: 0,
      result: {
        routeProgression: {
          status: 'REVIEW_READY',
          routeVersion: 2,
          completedStation: { stationId, stationName: 'Visual Acuity', stationType: 'VISUAL_ACUITY' },
          nextStation: null,
          nextQueue: null,
        },
      },
    }]));
    const result = await syncOfflineEvent(ownerId, eventId);
    expect(result).toMatchObject({ synced: 1, pending: 0 });
    expect(syncRequest(post.mock.calls[0][1]).actions[0]).toMatchObject({
      stationId,
      stationType: 'VISUAL_ACUITY',
      payload: expect.objectContaining({
        acknowledged: true,
        resultData: expect.objectContaining({ chartDistanceMetres: '6' }),
      }),
    });
  });
});
