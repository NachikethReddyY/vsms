import apiClient, { getDeviceId, newIdempotencyHeaders } from '../../utils/apiClient';
import type {
  ColourVisionResultData,
  DynamicResultData,
  EyeHealthResultData,
  EyeReading,
  FlagEvaluation,
  OverallFlag,
  QueueRegistration,
  RefractionResultData,
  ScreeningSavePayload,
  RouteProgression,
  Station,
  StationType,
  VisualAcuityResultData,
} from './screeningApi';
import { evaluateTemplateFlagRules, mergeFlagEvaluations, normalizeClinicalResultData } from './fieldSchema';
import type { FieldSchema } from './fieldSchema';
import type { EventRecord } from '../events/eventApi';
import type {
  EventQueueStatus,
  QueueEntry,
  RegistrationRouteState,
  RouteOverrideReason,
} from '../queue/queueApi';
import type {
  OfflineReviewDecision,
  ReviewDetailResponse,
  ReviewQueueResponse,
  SignatureResponse,
} from '../reviews/reviewApi';

const DATABASE_NAME = 'vsms-screening-offline';
const DATABASE_VERSION = 1;
const KEY_ID = 'screening-cache-key';
const SUPPORTED_STATIONS = new Set<StationType>(['VISUAL_ACUITY', 'REFRACTION', 'COLOUR_VISION', 'EYE_HEALTH', 'CUSTOM']);
const OFFLINE_SYNC_EVENT = 'vsms-offline-sync';
const RECOVERY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
let cryptoKeyPromise: Promise<CryptoKey> | null = null;

type ScreeningPath = 'visual-acuity' | 'refraction' | 'colour-vision' | 'eye-health' | 'dynamic';
type OfflineMutationStatus = 'pending' | 'conflict';

type OfflineStation = Station & { offlineAccessExpiresAt: string };
type OfflineQueueRegistration = QueueRegistration;

type OfflineSnapshot = {
  event: EventRecord | { eventId: string; name: string };
  roles?: string[];
  capabilities?: Record<string, boolean>;
  stations: OfflineStation[];
  queues: Record<string, OfflineQueueRegistration[]>;
  registration?: {
    stations: Array<Pick<Station, 'stationId' | 'stationName' | 'stationType' | 'stationOrder'>>;
    nextQueueNumber: number;
  };
  queue?: EventQueueStatus;
  routes?: Record<string, RegistrationRouteState>;
  review?: ReviewQueueResponse & { details: Record<string, ReviewDetailResponse> };
  registrationMappings?: Record<string, string>;
  canonicalQrPasses?: Record<string, OfflineCanonicalQrPass>;
};

type OfflineCanonicalQrPass = {
  qrId: string;
  registrationId: string;
  issuedAt: string;
  expiresAt: string;
  qrImage: string;
  queueNumber: number | null;
};

type OfflineEventPack = {
  schemaVersion: 1;
  packId: string;
  generatedAt: string;
  expiresAt: string;
  event: EventRecord;
  roles: string[];
  capabilities: Record<string, boolean>;
  lease: OfflineCapabilityLease;
  registration?: OfflineSnapshot['registration'] | null;
  queue?: EventQueueStatus | null;
  routes?: Array<{ registrationId: string; route: RegistrationRouteState }> | null;
  review?: ReviewQueueResponse & { details: ReviewDetailResponse[] } | null;
  screening?: {
    event?: { eventId: string; name: string; status: string };
    stations: ScreeningSyncPullStation[];
  } | null;
};

type OfflineLeaseCapabilities = {
  screening: boolean;
  registration: boolean;
  queue: boolean;
  review: boolean;
  routeOverride: boolean;
};

type OfflineCapabilityLease = {
  algorithm: 'ES256';
  keyId: string;
  publicKey: JsonWebKey;
  payload: {
    schemaVersion: 1;
    packId: string;
    actorId: string;
    eventId: string;
    deviceId: string;
    issuedAt: string;
    expiresAt: string;
    roles: string[];
    capabilities: OfflineLeaseCapabilities;
  };
  signature: string;
};

type OfflineMutation = {
  clientActionId: string;
  stationId: string;
  path: ScreeningPath;
  stationType?: StationType;
  body: ScreeningSavePayload<VisualAcuityResultData | RefractionResultData | ColourVisionResultData | EyeHealthResultData | DynamicResultData>;
};

export type OfflineWalkInInput = {
  participant: {
    firstName: string;
    lastName: string;
    dateOfBirth: string;
    gender: string;
    contactNumber: string;
    nric: string;
    email: string;
    race: string;
    nationality: string;
    addressStreet: string;
    addressUnit: string;
    addressPostalCode: string;
    preferredLanguage: string;
    accessibilityNotes: string;
  };
  emergencyContact: {
    contactName: string;
    relationship: string;
    phoneNumber: string;
    email?: string;
  };
  workflowStartedAt?: string | null;
  paperFormUsed: boolean;
  paperExceptionReason?: string;
};

type OfflineRegistrationCommand = {
  type: 'REGISTRATION_CREATE';
  clientActionId: string;
  occurredAt: string;
  participantId: string;
  registrationId: string;
  payload: OfflineWalkInInput;
  local: {
    queueNumber: number;
    stationId: string;
    stationName: string;
    stationNumber: number;
  };
};

type OfflineQueueCommand = {
  type: 'QUEUE_CALL' | 'QUEUE_START' | 'QUEUE_SKIP' | 'QUEUE_PRIORITY';
  clientActionId: string;
  occurredAt: string;
  queueId: string;
  expectedStatus: QueueEntry['status'];
  payload?: { isPriority: boolean; notes: string | null };
};

type OfflineReviewCommand = {
  type: 'REVIEW_DECISION';
  clientActionId: string;
  occurredAt: string;
  registrationId: string;
  decision: OfflineReviewDecision;
  signatureDataUrl?: string;
  signature?: SignatureResponse;
};

type OfflineRouteCommand = {
  type: 'ROUTE_OVERRIDE';
  clientActionId: string;
  occurredAt: string;
  registrationId: string;
  stationIds: string[];
  reasonCode: RouteOverrideReason;
  expectedVersion: number;
  skipActive: boolean;
  provisionalQueueId?: string;
};

type OfflineOperationCommand = OfflineRegistrationCommand | OfflineQueueCommand | OfflineReviewCommand | OfflineRouteCommand;

export type OfflineRegistrationSave = OfflineRegistrationCommand['local'] & {
  participantId: string;
  registrationId: string;
  savedOnDevice: true;
};

export type OfflineCanonicalRegistration = OfflineCanonicalQrPass & {
  localRegistrationId: string;
  eventName: string;
};

type ScreeningSyncActionResult = {
  clientActionId: string;
  status: 'APPLIED' | 'CONFLICT' | 'FAILED';
  retryCount: number;
  errorCode?: string;
  result?: {
    resultId?: string;
    overallFlag?: OverallFlag;
    isFlagged?: boolean;
    ruleVersion?: string;
    routeProgression?: RouteProgression | null;
  };
};

type ScreeningSyncPullStation = OfflineStation & {
  registrations: OfflineQueueRegistration[];
};

type ScreeningSyncResponse = {
  clientBatchId: string;
  serverTime: string;
  cursor: string;
  actions: ScreeningSyncActionResult[];
  pull: {
    event: { eventId: string; name: string; status: string };
    stations: ScreeningSyncPullStation[];
  };
};

type OfflineRegistrationReceipt = {
  participantId: string;
  registrationId: string;
  queueNumber: number | null;
  nextStation?: {
    stationId: string;
    stationName: string;
    stationNumber: number;
  } | null;
  canonicalQrAvailable: boolean;
};

type OperationSyncActionResult = {
  clientActionId: string;
  status: 'APPLIED' | 'CONFLICT' | 'FAILED';
  retryCount: number;
  errorCode?: string;
  result?: OfflineRegistrationReceipt | RegistrationRouteState | {
    reviewId?: string;
    registrationStatus?: string;
    referralId?: string | null;
    referralStatus?: string | null;
    signedAt?: string;
  };
};

type OperationSyncResponse = {
  clientBatchId: string;
  serverTime: string;
  actions: OperationSyncActionResult[];
};

type EncryptedRecord = {
  id: string;
  ownerId: string;
  eventId: string;
  kind: 'snapshot' | 'mutation' | 'registration' | 'queue' | 'review' | 'route';
  status: OfflineMutationStatus | 'ready';
  expiresAt: string;
  iv: ArrayBuffer;
  ciphertext: ArrayBuffer;
};

export type OfflineSyncStatus = {
  downloaded: boolean;
  pending: number;
  conflicts: number;
  locked: number;
  expiresAt: string | null;
};

export type OfflineStationContext = {
  eventName: string;
  station: Station;
  stations: Station[];
  queue: QueueRegistration[];
};

export type OfflineRegistrationResolution = {
  registrationId: string;
  participantDisplayName: string;
  queueNumber: number | null;
  status: string;
  activeStation: Pick<Station, 'stationId' | 'stationName' | 'stationType'>;
};

export type OfflineSyncResult = OfflineSyncStatus & {
  synced: number;
  expired: boolean;
  committedProgressions: Array<{ clientActionId: string; routeProgression: RouteProgression }>;
};

function unsupportedStorage() {
  return typeof indexedDB === 'undefined' || !globalThis.crypto?.subtle;
}

function openDatabase(): Promise<IDBDatabase> {
  if (unsupportedStorage()) return Promise.reject(new Error('Offline storage is unavailable in this browser.'));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains('keys')) database.createObjectStore('keys');
      if (!database.objectStoreNames.contains('records')) {
        const records = database.createObjectStore('records', { keyPath: 'id' });
        records.createIndex('byOwnerEvent', ['ownerId', 'eventId']);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open offline storage.'));
  });
}

function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Offline storage request failed.'));
  });
}

async function inStore<T>(storeName: 'keys' | 'records', mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(storeName, mode);
    return await requestValue(action(transaction.objectStore(storeName)));
  } finally {
    database.close();
  }
}

async function getCryptoKey(): Promise<CryptoKey> {
  cryptoKeyPromise ??= (async () => {
    const existing = await inStore<CryptoKey | undefined>('keys', 'readonly', (store) => store.get(KEY_ID));
    if (existing) return existing;
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    await inStore<IDBValidKey>('keys', 'readwrite', (store) => store.put(key, KEY_ID));
    return key;
  })().catch((error) => {
    cryptoKeyPromise = null;
    throw error;
  });
  return cryptoKeyPromise;
}

function notifyOfflineChange() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(OFFLINE_SYNC_EVENT));
}

export const offlineSyncChangeEvent = OFFLINE_SYNC_EVENT;

function associatedData(record: Pick<EncryptedRecord, 'ownerId' | 'eventId' | 'kind'>) {
  return new TextEncoder().encode(`${record.ownerId}:${record.eventId}:${record.kind}`);
}

async function encryptRecord<T>(record: Omit<EncryptedRecord, 'iv' | 'ciphertext'>, value: T): Promise<EncryptedRecord> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const key = await getCryptoKey();
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: associatedData(record) },
    key,
    plaintext,
  );
  return { ...record, iv: iv.buffer, ciphertext };
}

async function decryptRecord<T>(record: EncryptedRecord): Promise<T> {
  const key = await getCryptoKey();
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: new Uint8Array(record.iv), additionalData: associatedData(record) },
    key,
    record.ciphertext,
  );
  return JSON.parse(new TextDecoder().decode(plaintext)) as T;
}

function snapshotId(ownerId: string, eventId: string) {
  return `${ownerId}:${eventId}:snapshot`;
}

function isExpired(expiresAt: string) {
  return !Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.now();
}

function recoveryExpired(expiresAt: string) {
  const accessExpiry = Date.parse(expiresAt);
  return !Number.isFinite(accessExpiry) || accessExpiry + RECOVERY_RETENTION_MS <= Date.now();
}

async function getRecord(id: string): Promise<EncryptedRecord | undefined> {
  return inStore<EncryptedRecord | undefined>('records', 'readonly', (store) => store.get(id));
}

async function putRecord(record: EncryptedRecord) {
  await inStore<IDBValidKey>('records', 'readwrite', (store) => store.put(record));
}

async function putRecordsAtomically(records: EncryptedRecord[]) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction('records', 'readwrite');
    const store = transaction.objectStore('records');
    records.forEach((record) => store.put(record));
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('Offline registration transaction failed.'));
      transaction.onabort = () => reject(transaction.error ?? new Error('Offline registration transaction was cancelled.'));
    });
  } finally {
    database.close();
  }
}

async function replaceRecordAndDelete(replacement: EncryptedRecord, deletedId: string) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction('records', 'readwrite');
    const store = transaction.objectStore('records');
    store.put(replacement);
    store.delete(deletedId);
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('Offline receipt transaction failed.'));
      transaction.onabort = () => reject(transaction.error ?? new Error('Offline receipt transaction was cancelled.'));
    });
  } finally {
    database.close();
  }
}

async function recordsForEvent(ownerId: string, eventId: string): Promise<EncryptedRecord[]> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction('records', 'readonly');
    return requestValue(transaction.objectStore('records').index('byOwnerEvent').getAll([ownerId, eventId]));
  } finally {
    database.close();
  }
}

async function deleteRecords(records: EncryptedRecord[]) {
  if (!records.length) return;
  const database = await openDatabase();
  try {
    const transaction = database.transaction('records', 'readwrite');
    const store = transaction.objectStore('records');
    await Promise.all(records.map((record) => requestValue(store.delete(record.id))));
  } finally {
    database.close();
  }
}

async function purgeEvent(ownerId: string, eventId: string) {
  await deleteRecords(await recordsForEvent(ownerId, eventId));
}

function toOfflineStation(station: Station): OfflineStation | null {
  if (!SUPPORTED_STATIONS.has(station.stationType) || !station.offlineAccessExpiresAt || isExpired(station.offlineAccessExpiresAt)) return null;
  return {
    stationId: station.stationId,
    eventId: station.eventId,
    stationName: station.stationName,
    stationType: station.stationType,
    stationOrder: station.stationOrder,
    isActive: station.isActive,
    fieldSchemaSnapshot: station.fieldSchemaSnapshot,
    schemaVersion: station.schemaVersion,
    offlineAccessExpiresAt: station.offlineAccessExpiresAt,
  };
}

function toOfflineQueue(rows: OfflineQueueRegistration[]): OfflineQueueRegistration[] {
  return rows.map((row) => ({
    registrationId: row.registrationId,
    participantDisplayName: row.participantDisplayName,
    queueNumber: row.queueNumber,
    status: row.status,
    existingResult: row.existingResult,
  }));
}

async function loadSnapshot(ownerId: string, eventId: string): Promise<OfflineSnapshot | null> {
  const record = await getRecord(snapshotId(ownerId, eventId));
  if (!record) return null;
  if (record.kind !== 'snapshot') {
    await purgeEvent(ownerId, eventId);
    return null;
  }
  if (isExpired(record.expiresAt)) return null;
  try {
    return await decryptRecord<OfflineSnapshot>(record);
  } catch {
    // A browser key reset or malformed ciphertext must never leave stale clinical data available.
    await purgeEvent(ownerId, eventId);
    return null;
  }
}

function snapshotFromPull(
  pull: ScreeningSyncResponse['pull'] | NonNullable<OfflineEventPack['screening']>,
  event: OfflineSnapshot['event'] = pull.event ?? { eventId: '', name: '' },
): OfflineSnapshot {
  const stations = pull.stations.map(toOfflineStation).filter((station): station is OfflineStation => Boolean(station));
  return {
    event,
    stations,
    queues: Object.fromEntries(pull.stations.map((station) => [
      station.stationId,
      toOfflineQueue(station.registrations),
    ])),
  };
}

async function requestScreeningSync(
  eventId: string,
  actions: Array<{
    clientActionId: string;
    stationId: string;
    stationType: StationType;
    payload: OfflineMutation['body'];
  }>,
): Promise<ScreeningSyncResponse> {
  const { data } = await apiClient.post<ScreeningSyncResponse>(`/events/${eventId}/sync/screening`, {
    clientBatchId: crypto.randomUUID(),
    actions,
  });
  return data;
}

async function requestOperationsSync(eventId: string, commands: OfflineOperationCommand[]): Promise<OperationSyncResponse> {
  const { data } = await apiClient.post<OperationSyncResponse>(`/events/${eventId}/sync/operations`, {
    clientBatchId: crypto.randomUUID(),
    actions: commands.map((command) => command.type === 'REGISTRATION_CREATE' ? {
        type: command.type,
        clientActionId: command.clientActionId,
        clientParticipantId: command.participantId,
        clientRegistrationId: command.registrationId,
        participant: command.payload.participant,
        emergencyContact: command.payload.emergencyContact,
        evidence: {
          workflowStartedAt: command.payload.workflowStartedAt ?? null,
          paperFormUsed: command.payload.paperFormUsed,
          ...(command.payload.paperExceptionReason
            ? { paperExceptionReason: command.payload.paperExceptionReason }
            : {}),
        },
        proposed: {
          queueNumber: command.local.queueNumber,
          nextStationId: command.local.stationId,
          nextStationNumber: command.local.stationNumber,
        },
      } : command.type === 'REVIEW_DECISION' ? {
        type: command.type,
        clientActionId: command.clientActionId,
        registrationId: command.registrationId,
        decision: { ...command.decision, ...command.signature },
      } : command.type === 'ROUTE_OVERRIDE' ? {
        type: command.type,
        clientActionId: command.clientActionId,
        registrationId: command.registrationId,
        stationIds: command.stationIds,
        reasonCode: command.reasonCode,
        expectedVersion: command.expectedVersion,
        skipActive: command.skipActive,
      } : {
        type: command.type,
        clientActionId: command.clientActionId,
        queueId: command.queueId,
        expectedStatus: command.expectedStatus,
        ...(command.payload ? { payload: command.payload } : {}),
      }),
  });
  return data;
}

const OFFLINE_ROLES = new Set(['EVENT_MANAGER', 'REGISTRATION', 'SCREENER', 'REVIEWER', 'SUPPORT']);
const CAPABILITY_KEYS = ['queue', 'registration', 'review', 'routeOverride', 'screening'] as const;

function exactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.keys(value).sort().join(',') === [...keys].sort().join(',');
}

function validCapabilities(value: unknown): value is OfflineLeaseCapabilities {
  return exactKeys(value, CAPABILITY_KEYS)
    && CAPABILITY_KEYS.every((key) => typeof value[key] === 'boolean');
}

function sameCapabilities(left: Record<string, boolean>, right: OfflineLeaseCapabilities) {
  return validCapabilities(left)
    && CAPABILITY_KEYS.every((key) => left[key] === right[key]);
}

function signingBytes(payload: OfflineCapabilityLease['payload']) {
  return new TextEncoder().encode(JSON.stringify({
    schemaVersion: payload.schemaVersion,
    packId: payload.packId,
    actorId: payload.actorId,
    eventId: payload.eventId,
    deviceId: payload.deviceId,
    issuedAt: payload.issuedAt,
    expiresAt: payload.expiresAt,
    roles: payload.roles,
    capabilities: {
      screening: payload.capabilities.screening,
      registration: payload.capabilities.registration,
      queue: payload.capabilities.queue,
      review: payload.capabilities.review,
      routeOverride: payload.capabilities.routeOverride,
    },
  }));
}

function base64UrlBytes(value: string) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
}

function base64Url(bytes: ArrayBuffer) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export async function verifyOfflineEventPackLease(
  pack: OfflineEventPack,
  ownerId: string,
  eventId: string,
  deviceId = getDeviceId(),
) {
  const lease = pack.lease;
  const payload = lease?.payload;
  if (
    !pack.event
    || typeof pack.event.eventId !== 'string'
    || typeof pack.packId !== 'string'
    || typeof pack.generatedAt !== 'string'
    || typeof pack.expiresAt !== 'string'
    || !Array.isArray(pack.roles)
    || !validCapabilities(pack.capabilities)
    || !lease
    || lease.algorithm !== 'ES256'
    || !exactKeys(lease, ['algorithm', 'keyId', 'payload', 'publicKey', 'signature'])
    || typeof lease.keyId !== 'string'
    || typeof lease.signature !== 'string'
    || !exactKeys(lease.publicKey, ['crv', 'kty', 'x', 'y'])
    || lease.publicKey.kty !== 'EC'
    || lease.publicKey.crv !== 'P-256'
    || typeof lease.publicKey.x !== 'string'
    || typeof lease.publicKey.y !== 'string'
    || !exactKeys(payload, ['actorId', 'capabilities', 'deviceId', 'eventId', 'expiresAt', 'issuedAt', 'packId', 'roles', 'schemaVersion'])
    || payload.schemaVersion !== 1
    || typeof payload.packId !== 'string'
    || typeof payload.actorId !== 'string'
    || typeof payload.eventId !== 'string'
    || typeof payload.deviceId !== 'string'
    || typeof payload.issuedAt !== 'string'
    || typeof payload.expiresAt !== 'string'
    || payload.packId !== pack.packId
    || payload.actorId !== ownerId
    || payload.eventId !== eventId
    || payload.eventId !== pack.event.eventId
    || payload.deviceId !== deviceId
    || payload.issuedAt !== pack.generatedAt
    || payload.expiresAt !== pack.expiresAt
    || !Number.isFinite(Date.parse(payload.issuedAt))
    || Date.parse(payload.issuedAt) > Date.now() + 5 * 60 * 1000
    || Date.parse(payload.expiresAt) <= Date.parse(payload.issuedAt)
    || !Array.isArray(payload.roles)
    || payload.roles.length !== new Set(payload.roles).size
    || payload.roles.some((role) => typeof role !== 'string' || !OFFLINE_ROLES.has(role))
    || payload.roles.length !== pack.roles.length
    || payload.roles.some((role, index) => role !== pack.roles[index])
    || !validCapabilities(payload.capabilities)
    || !sameCapabilities(pack.capabilities, payload.capabilities)
    || isExpired(payload.expiresAt)
  ) {
    throw new Error('The offline access lease is invalid or does not match this device.');
  }

  const publicJwk = {
    kty: 'EC',
    crv: 'P-256',
    x: lease.publicKey.x,
    y: lease.publicKey.y,
  };
  const computedKeyId = base64Url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(publicJwk))));
  const configuredKeyId = import.meta.env.VITE_OFFLINE_LEASE_KEY_ID?.trim();
  if (computedKeyId !== lease.keyId || (configuredKeyId && configuredKeyId !== computedKeyId) || (import.meta.env.PROD && !configuredKeyId)) {
    throw new Error('The offline access lease was signed by an untrusted key.');
  }

  const key = await crypto.subtle.importKey('jwk', publicJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const verified = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    base64UrlBytes(lease.signature),
    signingBytes(payload),
  );
  if (!verified) throw new Error('The offline access lease signature is invalid.');
}

function snapshotExpiry(snapshot: OfflineSnapshot) {
  if (!snapshot.stations.length) return null;
  return snapshot.stations.reduce((earliest, station) => (
    Date.parse(station.offlineAccessExpiresAt) < Date.parse(earliest)
      ? station.offlineAccessExpiresAt
      : earliest
  ), snapshot.stations[0].offlineAccessExpiresAt);
}

function routesFromPack(routes: OfflineEventPack['routes']): Record<string, RegistrationRouteState> | undefined {
  if (!routes) return undefined;
  return Object.fromEntries(routes.map(({ registrationId, route }) => [registrationId, route]));
}

function reviewFromPack(review: OfflineEventPack['review']): OfflineSnapshot['review'] | undefined {
  if (!review) return undefined;
  return {
    ...review,
    details: Object.fromEntries(review.details.map((detail) => [detail.participant.registrationId, detail])),
  };
}

async function localRouteRegistrationIds(ownerId: string, eventId: string) {
  const registrationIds = new Set<string>();
  for (const record of await recordsForEvent(ownerId, eventId)) {
    if (record.kind !== 'route' || !['pending', 'conflict'].includes(record.status)) continue;
    registrationIds.add((await decryptRecord<OfflineRouteCommand>(record)).registrationId);
  }
  return registrationIds;
}

export async function downloadOfflineEvent(ownerId: string, eventId: string): Promise<OfflineSyncStatus> {
  const previousSnapshot = await loadSnapshot(ownerId, eventId);
  const localRouteIds = previousSnapshot ? await localRouteRegistrationIds(ownerId, eventId) : new Set<string>();
  const { data: pack } = await apiClient.get<OfflineEventPack>(`/events/${eventId}/offline-pack`);
  if (!pack?.event || pack.schemaVersion !== 1 || pack.event.eventId !== eventId || isExpired(pack.expiresAt)) {
    throw new Error('The server returned an invalid or expired offline event pack.');
  }
  await verifyOfflineEventPackLease(pack, ownerId, eventId);
  const routes = routesFromPack(pack.routes) ?? {};
  localRouteIds.forEach((registrationId) => {
    const local = previousSnapshot?.routes?.[registrationId];
    if (local) routes[registrationId] = local;
  });
  const queue = localRouteIds.size && previousSnapshot?.queue
    ? previousSnapshot.queue
    : pack.queue ?? undefined;
  const snapshot = pack.screening
    ? {
      ...snapshotFromPull(pack.screening, pack.event),
      roles: pack.roles,
      capabilities: pack.capabilities,
      registration: pack.registration ?? undefined,
      queue,
      routes,
      review: reviewFromPack(pack.review),
      registrationMappings: previousSnapshot?.registrationMappings,
      canonicalQrPasses: previousSnapshot?.canonicalQrPasses,
    }
    : {
      event: pack.event,
      roles: pack.roles,
      capabilities: pack.capabilities,
      stations: [],
      queues: {},
      registration: pack.registration ?? undefined,
      queue,
      routes,
      review: reviewFromPack(pack.review),
      registrationMappings: previousSnapshot?.registrationMappings,
      canonicalQrPasses: previousSnapshot?.canonicalQrPasses,
    };
  const expiresAt = snapshotExpiry(snapshot) ?? pack.expiresAt;
  const record = await encryptRecord({
    id: snapshotId(ownerId, eventId),
    ownerId,
    eventId,
    kind: 'snapshot',
    status: 'ready',
    expiresAt,
  }, snapshot);
  await putRecord(record);
  notifyOfflineChange();
  return getOfflineSyncStatus(ownerId, eventId);
}

export async function getOfflineStationContext(
  ownerId: string,
  eventId: string,
  stationType?: StationType,
  stationId?: string,
): Promise<OfflineStationContext | null> {
  const snapshot = await loadSnapshot(ownerId, eventId);
  if (!snapshot) return null;
  const station = snapshot.stations.find((item) => (!stationType || item.stationType === stationType) && (!stationId || item.stationId === stationId));
  if (!station || isExpired(station.offlineAccessExpiresAt)) {
    return null;
  }
  return {
    eventName: snapshot.event.name,
    station,
    stations: snapshot.stations,
    queue: snapshot.queues[station.stationId] ?? [],
  };
}

export async function getOfflineScreeningStations(ownerId: string, eventId: string) {
  const snapshot = await loadSnapshot(ownerId, eventId);
  if (!snapshot || !isEventRecord(snapshot.event) || !snapshot.stations.length) return null;
  return {
    event: {
      eventId: snapshot.event.eventId,
      name: snapshot.event.name,
      status: snapshot.event.status,
      venue: snapshot.event.venue,
    },
    stations: snapshot.stations,
  };
}

function isEventRecord(event: OfflineSnapshot['event']): event is EventRecord {
  return 'timezone' in event && 'eventDays' in event && 'eventStations' in event && 'shifts' in event;
}

export async function getOfflineEvent(ownerId: string, eventId: string): Promise<EventRecord | null> {
  const snapshot = await loadSnapshot(ownerId, eventId);
  return snapshot && isEventRecord(snapshot.event) ? snapshot.event : null;
}

export async function listOfflineEvents(ownerId: string): Promise<EventRecord[]> {
  const events = await Promise.all((await listOfflineEventIds(ownerId)).map((eventId) => getOfflineEvent(ownerId, eventId)));
  return events.filter((event): event is EventRecord => Boolean(event));
}

export async function getOfflineEventRoles(ownerId: string, eventId: string): Promise<string[]> {
  const roles = (await loadSnapshot(ownerId, eventId))?.roles ?? [];
  return roles.map((role) => role === 'REGISTRATION' ? 'REGISTRATION_OFFICER' : role);
}

export async function getOfflineReviewQueue(ownerId: string, eventId: string): Promise<ReviewQueueResponse | null> {
  const review = (await loadSnapshot(ownerId, eventId))?.review;
  return review ? { event: review.event, queue: review.queue } : null;
}

export async function getOfflineReviewDetail(
  ownerId: string,
  eventId: string,
  registrationId: string,
): Promise<ReviewDetailResponse | null> {
  return (await loadSnapshot(ownerId, eventId))?.review?.details[registrationId] ?? null;
}

export async function getOfflineCanonicalRegistration(
  ownerId: string,
  eventId: string,
  registrationId: string,
): Promise<OfflineCanonicalRegistration | null> {
  const snapshot = await loadSnapshot(ownerId, eventId);
  if (!snapshot) return null;
  const canonicalRegistrationId = snapshot.registrationMappings?.[registrationId] ?? registrationId;
  const pass = snapshot.canonicalQrPasses?.[canonicalRegistrationId];
  if (!pass) return null;
  const localRegistrationId = Object.entries(snapshot.registrationMappings ?? {})
    .find(([, canonicalId]) => canonicalId === canonicalRegistrationId)?.[0] ?? registrationId;
  return { ...pass, localRegistrationId, eventName: snapshot.event.name };
}

export async function queueOfflineWalkInRegistration(
  ownerId: string,
  eventId: string,
  input: OfflineWalkInInput,
): Promise<OfflineRegistrationSave> {
  const storedSnapshot = await getRecord(snapshotId(ownerId, eventId));
  const snapshot = await loadSnapshot(ownerId, eventId);
  const registrationScope = snapshot?.registration;
  const station = registrationScope?.stations
    .slice()
    .sort((left, right) => left.stationOrder - right.stationOrder)[0];
  if (!storedSnapshot || !snapshot || !registrationScope || !station) {
    throw new Error('This device does not have a current registration pack for the event.');
  }
  if (isExpired(storedSnapshot.expiresAt)) {
    throw new Error('Offline registration access has expired. Reconnect before registering another participant.');
  }

  const clientActionId = crypto.randomUUID();
  const participantId = crypto.randomUUID();
  const registrationId = crypto.randomUUID();
  const queueNumber = registrationScope.nextQueueNumber;
  const command: OfflineRegistrationCommand = {
    type: 'REGISTRATION_CREATE',
    clientActionId,
    occurredAt: new Date().toISOString(),
    participantId,
    registrationId,
    payload: input,
    local: {
      queueNumber,
      stationId: station.stationId,
      stationName: station.stationName,
      stationNumber: station.stationOrder,
    },
  };
  const nextSnapshot: OfflineSnapshot = {
    ...snapshot,
    registration: { ...registrationScope, nextQueueNumber: queueNumber + 1 },
    queues: snapshot.stations.some((item) => item.stationId === station.stationId)
      ? {
        ...snapshot.queues,
        [station.stationId]: [
          ...(snapshot.queues[station.stationId] ?? []),
          {
            registrationId,
            participantDisplayName: `${input.participant.firstName.trim()} ${input.participant.lastName.trim()}`,
            queueNumber,
            status: 'CHECKED_IN',
            existingResult: null,
          },
        ],
      }
      : snapshot.queues,
  };

  const [encryptedSnapshot, encryptedCommand] = await Promise.all([
    encryptRecord({
      id: storedSnapshot.id,
      ownerId,
      eventId,
      kind: 'snapshot',
      status: 'ready',
      expiresAt: storedSnapshot.expiresAt,
    }, nextSnapshot),
    encryptRecord({
      id: `${ownerId}:${eventId}:registration:${clientActionId}`,
      ownerId,
      eventId,
      kind: 'registration',
      status: 'pending',
      expiresAt: storedSnapshot.expiresAt,
    }, command),
  ]);
  await putRecordsAtomically([encryptedSnapshot, encryptedCommand]);
  notifyOfflineChange();
  return { participantId, registrationId, ...command.local, savedOnDevice: true };
}

export async function getOfflineQueueStatus(ownerId: string, eventId: string): Promise<EventQueueStatus | null> {
  return (await loadSnapshot(ownerId, eventId))?.queue ?? null;
}

export async function getOfflineParticipantRoute(
  ownerId: string,
  eventId: string,
  registrationId: string,
): Promise<RegistrationRouteState | null> {
  return (await loadSnapshot(ownerId, eventId))?.routes?.[registrationId] ?? null;
}

function updateQueueProjection(queue: EventQueueStatus, entries: QueueEntry[]): EventQueueStatus {
  const statuses: QueueEntry['status'][] = ['WAITING', 'CALLED', 'IN_PROGRESS', 'COMPLETED', 'SKIPPED', 'CANCELLED'];
  const totals = Object.fromEntries(statuses.map((status) => [status, 0])) as EventQueueStatus['totals'];
  entries.forEach((entry) => { totals[entry.status] += 1; });
  const stations = queue.stations.map((station) => {
    const stationEntries = entries.filter((entry) => entry.stationId === station.stationId);
    const workload = Object.fromEntries(statuses.map((status) => [
      status,
      stationEntries.filter((entry) => entry.status === status).length,
    ])) as typeof station.workload;
    const next = stationEntries
      .filter((entry) => entry.status === 'WAITING')
      .sort((left, right) => Number(right.isPriority) - Number(left.isPriority) || left.queueNumber - right.queueNumber)[0];
    return {
      ...station,
      workload,
      nextUp: next ? {
        queueId: next.id,
        queueNumber: next.queueNumber,
        registrationId: next.registrationId,
        participantDisplayName: next.participantDisplayName,
        isPriority: next.isPriority,
      } : null,
    };
  });
  return { ...queue, entries, totals, stations };
}

function optimisticRouteState(
  route: RegistrationRouteState,
  stationIds: string[],
  skipActive: boolean,
  provisionalQueueId: string,
  queueNumber: number,
): RegistrationRouteState {
  const ordered = route.steps.slice().sort((left, right) => left.position - right.position);
  const unfinished = ordered.filter(({ state }) => state !== 'COMPLETED');
  const before = unfinished.map(({ stationId }) => stationId);
  if (
    stationIds.length !== before.length
    || new Set(stationIds).size !== stationIds.length
    || stationIds.some((stationId) => !before.includes(stationId))
  ) {
    throw new Error('The route must include every unfinished station exactly once.');
  }
  const activeStationId = route.currentStation?.stationId
    ?? route.steps.find(({ state }) => state === 'CURRENT')?.stationId
    ?? null;
  const activeIndex = activeStationId ? before.indexOf(activeStationId) : -1;
  if (skipActive && activeIndex < 0) throw new Error('Only a current waiting or called station can be skipped.');
  if (skipActive && route.queue?.status === 'IN_PROGRESS') throw new Error('Screening already started at the current station.');
  if (skipActive && stationIds[0] === activeStationId && before.length > 1) {
    throw new Error('Choose a different next station before skipping the current station.');
  }
  if (!skipActive && activeIndex >= 0 && stationIds[activeIndex] !== activeStationId) {
    throw new Error('The current station cannot be reordered before screening finishes.');
  }
  if (!skipActive && before.every((stationId, index) => stationIds[index] === stationId)) {
    throw new Error('Choose a different route order before saving.');
  }

  const proposed = skipActive ? (() => {
    const remaining = stationIds.filter((stationId) => stationId !== activeStationId);
    return before.map((stationId, index) => index === activeIndex ? stationId : remaining.shift() as string);
  })() : stationIds;
  let unfinishedIndex = 0;
  const reordered = ordered.map((step) => {
    if (step.state === 'COMPLETED') return step;
    const selectedStationId = proposed[unfinishedIndex++];
    const selected = route.steps.find(({ stationId }) => stationId === selectedStationId);
    if (!selected) throw new Error('The proposed route contains an unavailable station.');
    return { ...selected, position: step.position, state: 'UPCOMING' as const };
  });
  const completedIds = new Set(ordered.filter(({ state }) => state === 'COMPLETED').map(({ stationId }) => stationId));
  if (skipActive && activeStationId) completedIds.add(activeStationId);
  const current = reordered.find(({ stationId }) => !completedIds.has(stationId)) ?? null;
  const steps = reordered.map((step, index) => ({
    ...step,
    position: index + 1,
    state: completedIds.has(step.stationId)
      ? 'COMPLETED' as const
      : step.stationId === current?.stationId ? 'CURRENT' as const : 'UPCOMING' as const,
  }));
  const needsProvisionalQueue = Boolean(current && (skipActive || !route.queue));
  const queue = current
    ? needsProvisionalQueue
      ? { queueEntryId: provisionalQueueId, stationId: current.stationId, queueNumber, status: 'WAITING' as const }
      : route.queue
    : null;
  return {
    status: current ? 'READY' : 'REVIEW_READY',
    routeVersion: route.routeVersion + 1,
    steps,
    currentStation: current ? steps.find(({ stationId }) => stationId === current.stationId) ?? null : null,
    queue,
  };
}

export async function queueOfflineRouteOverride(
  ownerId: string,
  eventId: string,
  registrationId: string,
  request: {
    stationIds: string[];
    reasonCode: RouteOverrideReason;
    expectedVersion: number;
    skipActive?: boolean;
  },
): Promise<RegistrationRouteState> {
  const storedSnapshot = await getRecord(snapshotId(ownerId, eventId));
  const snapshot = await loadSnapshot(ownerId, eventId);
  const route = snapshot?.routes?.[registrationId];
  if (!storedSnapshot || !snapshot || !route || snapshot.capabilities?.routeOverride !== true) {
    throw new Error('This participant route is not available in the current offline event pack.');
  }
  if (route.routeVersion !== request.expectedVersion) {
    throw new Error('The route changed after this dialog was opened. Reload it before saving.');
  }
  for (const record of await recordsForEvent(ownerId, eventId)) {
    if (record.kind !== 'route') continue;
    const existing = await decryptRecord<OfflineRouteCommand>(record);
    if (existing.registrationId === registrationId) {
      throw new Error('This participant already has a route change waiting for sync or conflict resolution.');
    }
  }

  const currentQueueEntry = snapshot.queue?.entries.find((entry) => (
    entry.id === route.queue?.queueEntryId || entry.registrationId === registrationId
  ));
  if (!currentQueueEntry) throw new Error('The participant queue entry is unavailable in this offline event pack.');
  const clientActionId = crypto.randomUUID();
  const provisionalQueueId = `local-route:${clientActionId}`;
  const skipActive = request.skipActive === true;
  const optimistic = optimisticRouteState(
    route,
    request.stationIds,
    skipActive,
    provisionalQueueId,
    currentQueueEntry.queueNumber,
  );
  const command: OfflineRouteCommand = {
    type: 'ROUTE_OVERRIDE',
    clientActionId,
    occurredAt: new Date().toISOString(),
    registrationId,
    stationIds: request.stationIds,
    reasonCode: request.reasonCode,
    expectedVersion: request.expectedVersion,
    skipActive,
    ...(optimistic.queue?.queueEntryId === provisionalQueueId ? { provisionalQueueId } : {}),
  };
  const entries = snapshot.queue ? snapshot.queue.entries.map((entry) => (
    skipActive && entry.id === route.queue?.queueEntryId
      ? { ...entry, status: 'SKIPPED' as const, leftQueueAt: command.occurredAt }
      : entry
  )) : [];
  if (command.provisionalQueueId && optimistic.currentStation && optimistic.queue) {
    entries.push({
      ...currentQueueEntry,
      id: command.provisionalQueueId,
      stationId: optimistic.currentStation.stationId,
      stationName: optimistic.currentStation.stationName,
      stationType: optimistic.currentStation.stationType,
      queueNumber: optimistic.queue.queueNumber,
      status: 'WAITING',
      enteredAt: command.occurredAt,
      calledAt: null,
      startedAt: null,
      leftQueueAt: null,
      completedAt: null,
    });
  }
  const nextSnapshot: OfflineSnapshot = {
    ...snapshot,
    routes: { ...snapshot.routes, [registrationId]: optimistic },
    queue: snapshot.queue ? updateQueueProjection(snapshot.queue, entries) : undefined,
  };
  const [encryptedSnapshot, encryptedCommand] = await Promise.all([
    encryptRecord({
      id: storedSnapshot.id,
      ownerId,
      eventId,
      kind: 'snapshot',
      status: 'ready',
      expiresAt: storedSnapshot.expiresAt,
    }, nextSnapshot),
    encryptRecord({
      id: `${ownerId}:${eventId}:route:${clientActionId}`,
      ownerId,
      eventId,
      kind: 'route',
      status: 'pending',
      expiresAt: storedSnapshot.expiresAt,
    }, command),
  ]);
  await putRecordsAtomically([encryptedSnapshot, encryptedCommand]);
  notifyOfflineChange();
  return optimistic;
}

export async function queueOfflineQueueAction(
  ownerId: string,
  eventId: string,
  queueId: string,
  action: 'CALL' | 'START' | 'SKIP' | 'PRIORITY',
  priority?: { isPriority: boolean; notes: string | null },
): Promise<QueueEntry> {
  if (queueId.startsWith('local-route:')) {
    throw new Error('This queue entry is provisional. Sync its route change before taking queue actions.');
  }
  const storedSnapshot = await getRecord(snapshotId(ownerId, eventId));
  const snapshot = await loadSnapshot(ownerId, eventId);
  const queue = snapshot?.queue;
  const current = queue?.entries.find((entry) => entry.id === queueId);
  if (!storedSnapshot || !snapshot || !queue || !current) {
    throw new Error('This queue entry is not available in the current offline event pack.');
  }
  const nextStatus = action === 'CALL' ? 'CALLED' : action === 'START' ? 'IN_PROGRESS' : action === 'SKIP' ? 'SKIPPED' : current.status;
  const allowed = action === 'PRIORITY'
    || (action === 'CALL' && current.status === 'WAITING')
    || (action === 'START' && current.status === 'CALLED')
    || (action === 'SKIP' && ['WAITING', 'CALLED'].includes(current.status));
  if (!allowed) throw new Error(`Queue action ${action.toLowerCase()} is not valid while the entry is ${current.status.toLowerCase()}.`);
  const now = new Date().toISOString();
  const updated: QueueEntry = {
    ...current,
    status: nextStatus,
    ...(action === 'CALL' ? { calledAt: now } : {}),
    ...(action === 'START' ? { startedAt: now } : {}),
    ...(action === 'SKIP' ? { leftQueueAt: now } : {}),
    ...(action === 'PRIORITY' ? { isPriority: priority?.isPriority ?? false, priorityNotes: priority?.notes ?? null } : {}),
  };
  const command: OfflineQueueCommand = {
    type: `QUEUE_${action}`,
    clientActionId: crypto.randomUUID(),
    occurredAt: now,
    queueId,
    expectedStatus: current.status,
    ...(action === 'PRIORITY' ? { payload: { isPriority: updated.isPriority, notes: updated.priorityNotes ?? null } } : {}),
  };
  const nextSnapshot = {
    ...snapshot,
    queue: updateQueueProjection(queue, queue.entries.map((entry) => entry.id === queueId ? updated : entry)),
  };
  const [encryptedSnapshot, encryptedCommand] = await Promise.all([
    encryptRecord({
      id: storedSnapshot.id,
      ownerId,
      eventId,
      kind: 'snapshot',
      status: 'ready',
      expiresAt: storedSnapshot.expiresAt,
    }, nextSnapshot),
    encryptRecord({
      id: `${ownerId}:${eventId}:queue:${command.clientActionId}`,
      ownerId,
      eventId,
      kind: 'queue',
      status: 'pending',
      expiresAt: storedSnapshot.expiresAt,
    }, command),
  ]);
  await putRecordsAtomically([encryptedSnapshot, encryptedCommand]);
  notifyOfflineChange();
  return updated;
}

export async function queueOfflineReviewDecision(
  ownerId: string,
  eventId: string,
  registrationId: string,
  decision: OfflineReviewDecision,
  signatureDataUrl: string,
) {
  const storedSnapshot = await getRecord(snapshotId(ownerId, eventId));
  const snapshot = await loadSnapshot(ownerId, eventId);
  const detail = snapshot?.review?.details[registrationId];
  if (!storedSnapshot || !snapshot?.review || !detail || detail.existingReview || !detail.readiness.ready) {
    throw new Error('This participant is not actionable in the current offline review pack.');
  }
  const clientActionId = crypto.randomUUID();
  const command: OfflineReviewCommand = {
    type: 'REVIEW_DECISION',
    clientActionId,
    occurredAt: new Date().toISOString(),
    registrationId,
    decision,
    signatureDataUrl,
  };
  const nextSnapshot: OfflineSnapshot = {
    ...snapshot,
    review: {
      ...snapshot.review,
      queue: snapshot.review.queue.filter((item) => item.registrationId !== registrationId),
      details: Object.fromEntries(Object.entries(snapshot.review.details).filter(([id]) => id !== registrationId)),
    },
  };
  const [encryptedSnapshot, encryptedCommand] = await Promise.all([
    encryptRecord({
      id: storedSnapshot.id,
      ownerId,
      eventId,
      kind: 'snapshot',
      status: 'ready',
      expiresAt: storedSnapshot.expiresAt,
    }, nextSnapshot),
    encryptRecord({
      id: `${ownerId}:${eventId}:review:${clientActionId}`,
      ownerId,
      eventId,
      kind: 'review',
      status: 'pending',
      expiresAt: storedSnapshot.expiresAt,
    }, command),
  ]);
  await putRecordsAtomically([encryptedSnapshot, encryptedCommand]);
  notifyOfflineChange();
  return { clientActionId, savedOnDevice: true as const };
}

export async function resolveOfflineRegistration(
  ownerId: string,
  eventId: string,
  registrationId: string,
): Promise<OfflineRegistrationResolution | null> {
  const snapshot = await loadSnapshot(ownerId, eventId);
  if (!snapshot) return null;
  for (const station of snapshot.stations) {
    const registration = snapshot.queues[station.stationId]?.find((row) => row.registrationId === registrationId);
    if (registration) {
      return {
        ...registration,
        activeStation: {
          stationId: station.stationId,
          stationName: station.stationName,
          stationType: station.stationType,
        },
      };
    }
  }
  return null;
}

export function isNetworkError(error: unknown) {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { response?: unknown; code?: string; message?: string };
  return !candidate.response && (candidate.code === 'ERR_NETWORK' || candidate.code === 'ECONNABORTED' || /network|offline/i.test(candidate.message ?? ''));
}

function worstFlag(reasons: Array<{ flag: OverallFlag }>): OverallFlag {
  const rank: Record<OverallFlag, number> = { NORMAL: 0, REVIEW: 1, REFER: 2, URGENT: 3 };
  return reasons.reduce<OverallFlag>((worst, item) => rank[item.flag] > rank[worst] ? item.flag : worst, 'NORMAL');
}

function eyeLabel(eye: EyeReading, distance: number) {
  return eye.kind === 'FRACTION' ? `${distance}/${eye.denominator}` : eye.code;
}

function diopter(value: number) {
  return value > 0 ? `+${value.toFixed(2)}` : value.toFixed(2);
}

function evaluateVisualAcuity(resultData: VisualAcuityResultData): FlagEvaluation {
  const reasons: Array<{ flag: OverallFlag; reason: string }> = [];
  for (const [label, eye] of [['OD', resultData.od], ['OS', resultData.os]] as const) {
    if (eye.kind === 'EXCEPTION') {
      if (eye.code === 'NLP' || eye.code === 'HM') reasons.push({ flag: 'URGENT', reason: `${label} ${eye.code}` });
      else if (eye.code === 'CF' || eye.code === 'LP') reasons.push({ flag: 'REFER', reason: `${label} ${eye.code}` });
      else reasons.push({ flag: 'REVIEW', reason: `${label} not testable` });
      continue;
    }
    const scaled = eye.denominator * (6 / resultData.chartDistanceMetres);
    if (scaled > 18) reasons.push({ flag: 'REFER', reason: `${label} ${eyeLabel(eye, resultData.chartDistanceMetres)}` });
    else if (scaled > 12) reasons.push({ flag: 'REVIEW', reason: `${label} ${eyeLabel(eye, resultData.chartDistanceMetres)}` });
  }
  const overallFlag = worstFlag(reasons);
  return {
    ruleVersion: 'VSMS-VA-1.0', overallFlag, isFlagged: overallFlag !== 'NORMAL',
    flagSummary: reasons.length ? reasons.map((item) => item.reason).join('; ') : `VA OD ${eyeLabel(resultData.od, resultData.chartDistanceMetres)} / OS ${eyeLabel(resultData.os, resultData.chartDistanceMetres)}`,
    reasons,
  };
}

function evaluateRefraction(resultData: RefractionResultData): FlagEvaluation {
  const reasons: Array<{ flag: OverallFlag; reason: string }> = [];
  if (resultData.measurementStatus !== 'COMPLETED') {
    reasons.push({
      flag: 'REVIEW',
      reason: resultData.measurementStatus === 'UNABLE_TO_MEASURE' ? 'Unable to measure refraction' : 'Refraction repeat required',
    });
    const overallFlag = worstFlag(reasons);
    return {
      ruleVersion: 'VSMS-REF-1.0',
      overallFlag,
      isFlagged: true,
      flagSummary: reasons[0].reason,
      reasons,
    };
  }
  for (const [label, eye] of [['OD', resultData.od], ['OS', resultData.os]] as const) {
    if (eye.sphere < -6 || eye.sphere > 5) reasons.push({ flag: 'REFER', reason: `${label} SPH ${diopter(eye.sphere)} outside -6.00 to +5.00` });
    if (Math.abs(eye.cylinder) > 3) reasons.push({ flag: 'REVIEW', reason: `${label} high astigmatism CYL ${diopter(eye.cylinder)}` });
  }
  const difference = Math.abs(resultData.od.sphere - resultData.os.sphere);
  if (difference >= 2) reasons.push({ flag: 'REVIEW', reason: `Anisometropia SPH difference ${difference.toFixed(2)} D` });
  const overallFlag = worstFlag(reasons);
  const summary = `OD ${diopter(resultData.od.sphere)}/${diopter(resultData.od.cylinder)} x ${resultData.od.axis ?? '—'} / OS ${diopter(resultData.os.sphere)}/${diopter(resultData.os.cylinder)} x ${resultData.os.axis ?? '—'}`;
  return { ruleVersion: 'VSMS-REF-1.0', overallFlag, isFlagged: overallFlag !== 'NORMAL', flagSummary: reasons.length ? reasons.map((item) => item.reason).join('; ') : summary, reasons };
}

function evaluateColourVision(resultData: ColourVisionResultData): FlagEvaluation {
  const reasons: Array<{ flag: OverallFlag; reason: string }> = [];
  const threshold = Math.max(1, resultData.platesPresented - 1);
  const odPass = resultData.odCorrect >= threshold;
  const osPass = resultData.osCorrect >= threshold;
  const gap = Math.abs(resultData.odCorrect - resultData.osCorrect);
  if ((odPass && !osPass) || (!odPass && osPass) || gap >= 3) reasons.push({ flag: 'URGENT', reason: `Critical colour-vision asymmetry OD ${resultData.odCorrect}/${resultData.platesPresented} vs OS ${resultData.osCorrect}/${resultData.platesPresented}` });
  else if (!odPass || !osPass) reasons.push({ flag: 'REVIEW', reason: `Colour vision below ${threshold}/${resultData.platesPresented} (OD ${resultData.odCorrect}, OS ${resultData.osCorrect})` });
  const overallFlag = worstFlag(reasons);
  return {
    ruleVersion: 'VSMS-CV-1.0', overallFlag, isFlagged: overallFlag !== 'NORMAL',
    flagSummary: reasons.length ? reasons.map((item) => item.reason).join('; ') : `Ishihara OD ${resultData.odCorrect}/${resultData.platesPresented} / OS ${resultData.osCorrect}/${resultData.platesPresented}`,
    reasons,
  };
}

function evaluateEyeHealth(resultData: EyeHealthResultData): FlagEvaluation {
  const reasons: Array<{ flag: OverallFlag; reason: string }> = [];
  if (resultData.cataractRisk === 'PRESENT' || resultData.glaucomaRisk === 'PRESENT') {
    reasons.push({
      flag: 'REFER',
      reason: `Eye-health risk present (cataract ${resultData.cataractRisk}, glaucoma ${resultData.glaucomaRisk})`,
    });
  }
  if (resultData.cataractRisk === 'SUSPECTED' || resultData.glaucomaRisk === 'SUSPECTED') {
    reasons.push({
      flag: 'REVIEW',
      reason: `Suspected eye-health risk (cataract ${resultData.cataractRisk}, glaucoma ${resultData.glaucomaRisk})`,
    });
  }
  if (resultData.symptomsNoted) {
    reasons.push({
      flag: 'REVIEW',
      reason: resultData.symptomSummary
        ? `Symptoms noted: ${resultData.symptomSummary}`
        : 'Participant-reported symptoms noted',
    });
  }
  const overallFlag = worstFlag(reasons);
  return {
    ruleVersion: 'VSMS-EH-1.0',
    overallFlag,
    isFlagged: overallFlag !== 'NORMAL',
    flagSummary: reasons.length
      ? reasons.map((item) => item.reason).join('; ')
      : `Cataract ${resultData.cataractRisk} / Glaucoma ${resultData.glaucomaRisk} / ${resultData.symptomsNoted ? 'Symptoms noted' : 'No symptoms'}`,
    reasons,
  };
}

export function evaluateOfflineStation(
  path: ScreeningPath,
  resultData: VisualAcuityResultData | RefractionResultData | ColourVisionResultData | EyeHealthResultData | DynamicResultData,
  stationType?: StationType,
  fieldSchema: FieldSchema = [],
): FlagEvaluation {
  if (path === 'dynamic') {
    const raw = resultData as DynamicResultData;
    const schemaEvaluation = evaluateTemplateFlagRules(raw, fieldSchema);
    if (stationType === 'VISUAL_ACUITY') {
      const normalized = normalizeClinicalResultData(stationType, raw);
      return mergeFlagEvaluations(evaluateVisualAcuity(normalized as VisualAcuityResultData), schemaEvaluation);
    }
    if (stationType === 'REFRACTION') {
      const normalized = normalizeClinicalResultData(stationType, raw);
      return mergeFlagEvaluations(evaluateRefraction(normalized as RefractionResultData), schemaEvaluation);
    }
    if (stationType === 'COLOUR_VISION') {
      return mergeFlagEvaluations(evaluateColourVision(raw as ColourVisionResultData), schemaEvaluation);
    }
    return schemaEvaluation.reasons.length
      ? schemaEvaluation
      : {
        ruleVersion: 'TEMPLATE-FLAG-1.0',
        overallFlag: 'NORMAL',
        isFlagged: false,
        flagSummary: 'Custom station result recorded.',
        reasons: [],
      };
  }
  if (path === 'visual-acuity') return evaluateVisualAcuity(resultData as VisualAcuityResultData);
  if (path === 'refraction') return evaluateRefraction(resultData as RefractionResultData);
  if (path === 'eye-health') return evaluateEyeHealth(resultData as EyeHealthResultData);
  return evaluateColourVision(resultData as ColourVisionResultData);
}

export async function queueOfflineStationSave(
  ownerId: string,
  eventId: string,
  stationId: string,
  path: ScreeningPath,
  body: ScreeningSavePayload<VisualAcuityResultData | RefractionResultData | ColourVisionResultData | EyeHealthResultData | DynamicResultData>,
): Promise<FlagEvaluation> {
  const snapshot = await loadSnapshot(ownerId, eventId);
  const station = snapshot?.stations.find((item) => item.stationId === stationId);
  const queue = station ? snapshot?.queues[stationId] : null;
  if (!snapshot || !station || !queue?.some((row) => row.registrationId === body.registrationId)) {
    throw new Error('This participant is not in a current offline station download. Reconnect before saving.');
  }
  if (isExpired(station.offlineAccessExpiresAt)) {
    throw new Error('Offline access for this station has expired. Reconnect before saving.');
  }
  const evaluation = evaluateOfflineStation(
    path,
    body.resultData,
    station.stationType,
    station.fieldSchemaSnapshot ?? [],
  );
  if (evaluation.isFlagged && body.acknowledged !== true) {
    throw new Error(`Flagged result (${evaluation.overallFlag}) must be acknowledged before saving.`);
  }
  for (const record of await recordsForEvent(ownerId, eventId)) {
    if (record.kind !== 'mutation' || record.status !== 'pending') continue;
    const existing = await decryptRecord<OfflineMutation>(record);
    if (existing.stationId === stationId && existing.body.registrationId === body.registrationId) {
      throw new Error('A result for this participant is already saved on this device and pending sync.');
    }
  }
  const expiresAt = snapshotExpiry(snapshot);
  if (!expiresAt) throw new Error('Offline screening access is unavailable for this event.');
  const clientActionId = crypto.randomUUID();
  const record = await encryptRecord({
    id: `${ownerId}:${eventId}:mutation:${clientActionId}`,
    ownerId,
    eventId,
    kind: 'mutation',
    status: 'pending',
    expiresAt,
  }, { clientActionId, stationId, path, stationType: station.stationType, body } satisfies OfflineMutation);
  await putRecord(record);
  notifyOfflineChange();
  return evaluation;
}

export async function getOfflineSyncStatus(ownerId: string, eventId: string): Promise<OfflineSyncStatus> {
  const records = await recordsForEvent(ownerId, eventId);
  if (records.some((record) => recoveryExpired(record.expiresAt))) {
    await purgeEvent(ownerId, eventId);
    return { downloaded: false, pending: 0, conflicts: 0, locked: 0, expiresAt: null };
  }
  const snapshot = records.find((record) => record.kind === 'snapshot');
  const unconfirmed = records.filter((record) => record.kind !== 'snapshot');
  const locked = snapshot && isExpired(snapshot.expiresAt) ? unconfirmed.length : 0;
  return {
    downloaded: Boolean(snapshot && !isExpired(snapshot.expiresAt)),
    pending: unconfirmed.filter((record) => record.status === 'pending').length,
    conflicts: unconfirmed.filter((record) => record.status === 'conflict').length,
    locked,
    expiresAt: snapshot?.expiresAt ?? null,
  };
}

export async function discardOfflineConflicts(ownerId: string, eventId: string): Promise<OfflineSyncStatus> {
  await deleteRecords((await recordsForEvent(ownerId, eventId)).filter(
    (record) => record.kind !== 'snapshot' && record.status === 'conflict',
  ));
  notifyOfflineChange();
  return getOfflineSyncStatus(ownerId, eventId);
}

function isScopeExpiredError(error: unknown) {
  const status = (error as { response?: { status?: number } })?.response?.status;
  return status === 403 || status === 404 || status === 409;
}

async function markConflict(record: EncryptedRecord) {
  await putRecord({ ...record, status: 'conflict' });
}

async function lockEventAccess(ownerId: string, eventId: string) {
  const expiresAt = new Date().toISOString();
  await Promise.all((await recordsForEvent(ownerId, eventId)).map((record) => putRecord({ ...record, expiresAt })));
}

async function requestCanonicalQrPass(registrationId: string) {
  const { data } = await apiClient.post<Omit<OfflineCanonicalQrPass, 'queueNumber'>>(
    `/qr/registrations/${registrationId}`,
    undefined,
    { headers: newIdempotencyHeaders() },
  );
  if (
    data.registrationId !== registrationId
    || !data.qrId
    || !data.qrImage.startsWith('data:image/svg+xml;base64,')
    || !Number.isFinite(Date.parse(data.issuedAt))
    || !Number.isFinite(Date.parse(data.expiresAt))
  ) {
    throw new Error('The server returned an invalid canonical QR pass.');
  }
  return data;
}

function isRegistrationReceipt(result: OperationSyncActionResult['result']): result is OfflineRegistrationReceipt {
  return Boolean(
    result
    && 'participantId' in result
    && typeof result.participantId === 'string'
    && typeof result.registrationId === 'string'
    && (result.queueNumber === null || Number.isInteger(result.queueNumber))
    && typeof result.canonicalQrAvailable === 'boolean',
  );
}

function isRouteReceipt(result: OperationSyncActionResult['result']): result is RegistrationRouteState {
  return Boolean(
    result
    && 'routeVersion' in result
    && Number.isInteger(result.routeVersion)
    && 'status' in result
    && typeof result.status === 'string'
    && 'steps' in result
    && Array.isArray(result.steps)
    && result.steps.every((step) => (
      typeof step.stationId === 'string'
      && typeof step.stationName === 'string'
      && typeof step.stationType === 'string'
      && Number.isInteger(step.position)
      && typeof step.state === 'string'
    )),
  );
}

async function applyRegistrationReceipt(
  ownerId: string,
  eventId: string,
  record: EncryptedRecord,
  command: OfflineRegistrationCommand,
  result: OfflineRegistrationReceipt,
  qrPass: Omit<OfflineCanonicalQrPass, 'queueNumber'>,
) {
  const snapshotRecord = await getRecord(snapshotId(ownerId, eventId));
  const snapshot = await loadSnapshot(ownerId, eventId);
  if (!snapshotRecord || !snapshot) throw new Error('The offline event snapshot is unavailable for this receipt.');
  const queues = Object.fromEntries(Object.entries(snapshot.queues).map(([stationId, rows]) => [
    stationId,
    rows.map((row) => row.registrationId === command.registrationId
      ? { ...row, registrationId: result.registrationId, queueNumber: result.queueNumber }
      : row),
  ]));
  const nextSnapshot: OfflineSnapshot = {
    ...snapshot,
    queues,
    registration: snapshot.registration ? {
      ...snapshot.registration,
      nextQueueNumber: Math.max(snapshot.registration.nextQueueNumber, (result.queueNumber ?? 0) + 1),
    } : undefined,
    registrationMappings: {
      ...snapshot.registrationMappings,
      [command.registrationId]: result.registrationId,
    },
    canonicalQrPasses: {
      ...snapshot.canonicalQrPasses,
      [result.registrationId]: { ...qrPass, queueNumber: result.queueNumber },
    },
  };
  const encryptedSnapshot = await encryptRecord({
    id: snapshotRecord.id,
    ownerId,
    eventId,
    kind: 'snapshot',
    status: 'ready',
    expiresAt: snapshotRecord.expiresAt,
  }, nextSnapshot);
  await replaceRecordAndDelete(encryptedSnapshot, record.id);
}

async function syncOfflineRegistrations(ownerId: string, eventId: string) {
  let synced = 0;
  const pending: Array<{ record: EncryptedRecord; command: OfflineRegistrationCommand }> = [];
  for (const record of await recordsForEvent(ownerId, eventId)) {
    if (record.kind !== 'registration' || record.status !== 'pending') continue;
    pending.push({ record, command: await decryptRecord<OfflineRegistrationCommand>(record) });
  }
  for (let index = 0; index < pending.length; index += 25) {
    const batch = pending.slice(index, index + 25);
    try {
      const response = await requestOperationsSync(eventId, batch.map(({ command }) => command));
      const byAction = new Map(batch.map((item) => [item.command.clientActionId, item]));
      for (const receipt of response.actions) {
        const item = byAction.get(receipt.clientActionId);
        if (!item) continue;
        if (receipt.status === 'APPLIED' && isRegistrationReceipt(receipt.result)) {
          let qrPass: Awaited<ReturnType<typeof requestCanonicalQrPass>>;
          try {
            qrPass = await requestCanonicalQrPass(receipt.result.registrationId);
          } catch {
            // The stable operation receipt can be replayed; retain the encrypted command until its canonical pass is cached too.
            continue;
          }
          await applyRegistrationReceipt(ownerId, eventId, item.record, item.command, receipt.result, qrPass);
          synced += 1;
        } else if (receipt.status === 'CONFLICT') {
          await markConflict(item.record);
        }
      }
    } catch (error) {
      if (isNetworkError(error)) break;
      if (isScopeExpiredError(error)) {
        await Promise.all(batch.map(({ record }) => markConflict(record)));
        await lockEventAccess(ownerId, eventId);
        break;
      }
      throw error;
    }
  }
  return synced;
}

async function applyRouteReceipt(
  ownerId: string,
  eventId: string,
  record: EncryptedRecord,
  command: OfflineRouteCommand,
  route: RegistrationRouteState,
) {
  const snapshotRecord = await getRecord(snapshotId(ownerId, eventId));
  const snapshot = await loadSnapshot(ownerId, eventId);
  if (!snapshotRecord || !snapshot) throw new Error('The offline event snapshot is unavailable for this route receipt.');
  let queue = snapshot.queue;
  if (queue && command.provisionalQueueId) {
    const provisional = queue.entries.find(({ id }) => id === command.provisionalQueueId);
    const entries = queue.entries.filter(({ id }) => id !== command.provisionalQueueId);
    if (route.queue && provisional) {
      const currentStation = route.currentStation
        ?? route.steps.find(({ stationId }) => stationId === route.queue?.stationId)
        ?? null;
      const canonical: QueueEntry = {
        ...provisional,
        id: route.queue.queueEntryId,
        stationId: route.queue.stationId,
        stationName: currentStation?.stationName,
        stationType: currentStation?.stationType,
        queueNumber: route.queue.queueNumber,
        status: route.queue.status,
      };
      const existingIndex = entries.findIndex(({ id }) => id === canonical.id);
      if (existingIndex >= 0) entries[existingIndex] = canonical;
      else entries.push(canonical);
    }
    queue = updateQueueProjection(queue, entries);
  }
  const nextSnapshot: OfflineSnapshot = {
    ...snapshot,
    routes: { ...snapshot.routes, [command.registrationId]: route },
    queue,
  };
  const encryptedSnapshot = await encryptRecord({
    id: snapshotRecord.id,
    ownerId,
    eventId,
    kind: 'snapshot',
    status: 'ready',
    expiresAt: snapshotRecord.expiresAt,
  }, nextSnapshot);
  await replaceRecordAndDelete(encryptedSnapshot, record.id);
}

async function syncOfflineRouteActions(ownerId: string, eventId: string) {
  let synced = 0;
  const pending: Array<{ record: EncryptedRecord; command: OfflineRouteCommand }> = [];
  for (const record of await recordsForEvent(ownerId, eventId)) {
    if (record.kind !== 'route' || record.status !== 'pending') continue;
    pending.push({ record, command: await decryptRecord<OfflineRouteCommand>(record) });
  }
  pending.sort((left, right) => left.command.occurredAt.localeCompare(right.command.occurredAt));
  for (let index = 0; index < pending.length; index += 25) {
    const batch = pending.slice(index, index + 25);
    try {
      const response = await requestOperationsSync(eventId, batch.map(({ command }) => command));
      const byAction = new Map(batch.map((item) => [item.command.clientActionId, item]));
      for (const receipt of response.actions) {
        const item = byAction.get(receipt.clientActionId);
        if (!item) continue;
        if (receipt.status === 'APPLIED') {
          if (!isRouteReceipt(receipt.result)) throw new Error('The server returned an invalid canonical route receipt.');
          await applyRouteReceipt(ownerId, eventId, item.record, item.command, receipt.result);
          synced += 1;
        } else if (receipt.status === 'CONFLICT') {
          await markConflict(item.record);
        }
      }
    } catch (error) {
      if (isNetworkError(error)) break;
      if (isScopeExpiredError(error)) {
        await Promise.all(batch.map(({ record }) => markConflict(record)));
        await lockEventAccess(ownerId, eventId);
        break;
      }
      throw error;
    }
  }
  return synced;
}

async function syncOfflineQueueActions(ownerId: string, eventId: string) {
  let synced = 0;
  const pending: Array<{ record: EncryptedRecord; command: OfflineQueueCommand }> = [];
  for (const record of await recordsForEvent(ownerId, eventId)) {
    if (record.kind !== 'queue' || record.status !== 'pending') continue;
    pending.push({ record, command: await decryptRecord<OfflineQueueCommand>(record) });
  }
  pending.sort((left, right) => left.command.occurredAt.localeCompare(right.command.occurredAt));
  for (let index = 0; index < pending.length; index += 25) {
    const batch = pending.slice(index, index + 25);
    try {
      const response = await requestOperationsSync(eventId, batch.map(({ command }) => command));
      const byAction = new Map(batch.map((item) => [item.command.clientActionId, item.record]));
      for (const receipt of response.actions) {
        const record = byAction.get(receipt.clientActionId);
        if (!record) continue;
        if (receipt.status === 'APPLIED') {
          await deleteRecords([record]);
          synced += 1;
        } else if (receipt.status === 'CONFLICT') {
          await markConflict(record);
        }
      }
    } catch (error) {
      if (isNetworkError(error)) break;
      if (isScopeExpiredError(error)) {
        await Promise.all(batch.map(({ record }) => markConflict(record)));
        await lockEventAccess(ownerId, eventId);
        break;
      }
      throw error;
    }
  }
  return synced;
}

async function syncOfflineReviews(ownerId: string, eventId: string) {
  let synced = 0;
  const pending: Array<{ record: EncryptedRecord; command: OfflineReviewCommand }> = [];
  for (const record of await recordsForEvent(ownerId, eventId)) {
    if (record.kind !== 'review' || record.status !== 'pending') continue;
    pending.push({ record, command: await decryptRecord<OfflineReviewCommand>(record) });
  }
  pending.sort((left, right) => left.command.occurredAt.localeCompare(right.command.occurredAt));
  for (let index = 0; index < pending.length; index += 25) {
    const batch = pending.slice(index, index + 25);
    try {
      for (const item of batch) {
        if (item.command.signature) continue;
        if (!item.command.signatureDataUrl) throw new Error('The encrypted review signature is unavailable.');
        const { data: signature } = await apiClient.post<SignatureResponse>('/signatures', {
          eventId,
          targetId: item.command.registrationId,
          purpose: 'REVIEW_DECISION',
          dataUrl: item.command.signatureDataUrl,
        });
        item.command = { ...item.command, signatureDataUrl: undefined, signature };
        item.record = await encryptRecord({
          id: item.record.id,
          ownerId,
          eventId,
          kind: 'review',
          status: 'pending',
          expiresAt: item.record.expiresAt,
        }, item.command);
        await putRecord(item.record);
      }
      const response = await requestOperationsSync(eventId, batch.map(({ command }) => command));
      const byAction = new Map(batch.map((item) => [item.command.clientActionId, item.record]));
      for (const receipt of response.actions) {
        const record = byAction.get(receipt.clientActionId);
        if (!record) continue;
        if (receipt.status === 'APPLIED') {
          await deleteRecords([record]);
          synced += 1;
        } else if (receipt.status === 'CONFLICT') {
          await markConflict(record);
        }
      }
    } catch (error) {
      if (isNetworkError(error)) break;
      if (isScopeExpiredError(error)) {
        await Promise.all(batch.map(({ record }) => markConflict(record)));
        await lockEventAccess(ownerId, eventId);
        break;
      }
      throw error;
    }
  }
  return synced;
}

export async function syncOfflineEvent(ownerId: string, eventId: string): Promise<OfflineSyncResult> {
  const initial = await getOfflineSyncStatus(ownerId, eventId);
  if (!initial.downloaded) return { ...initial, synced: 0, expired: initial.locked > 0, committedProgressions: [] };

  let synced = await syncOfflineRegistrations(ownerId, eventId);
  synced += await syncOfflineRouteActions(ownerId, eventId);
  synced += await syncOfflineQueueActions(ownerId, eventId);
  const committedProgressions: OfflineSyncResult['committedProgressions'] = [];
  const screeningSnapshot = await loadSnapshot(ownerId, eventId);
  if (!screeningSnapshot?.stations.length) {
    synced += await syncOfflineReviews(ownerId, eventId);
    notifyOfflineChange();
    return { ...(await getOfflineSyncStatus(ownerId, eventId)), synced, expired: false, committedProgressions };
  }
  const pending: Array<{ record: EncryptedRecord; mutation: OfflineMutation }> = [];
  for (const record of await recordsForEvent(ownerId, eventId)) {
    if (record.kind !== 'mutation' || record.status !== 'pending') continue;
    if (isExpired(record.expiresAt)) {
      await lockEventAccess(ownerId, eventId);
      return { ...(await getOfflineSyncStatus(ownerId, eventId)), synced, expired: true, committedProgressions };
    }
    pending.push({ record, mutation: await decryptRecord<OfflineMutation>(record) });
  }

  const batches = pending.length
    ? Array.from({ length: Math.ceil(pending.length / 25) }, (_, index) => pending.slice(index * 25, (index + 1) * 25))
    : [[]];
  for (const batch of batches) {
    try {
      const response = await requestScreeningSync(eventId, batch.map(({ mutation }) => ({
        clientActionId: mutation.clientActionId,
        stationId: mutation.stationId,
        stationType: mutation.path === 'dynamic'
          ? (mutation.stationType || 'CUSTOM')
          : mutation.path === 'visual-acuity'
          ? 'VISUAL_ACUITY'
          : mutation.path === 'refraction'
            ? 'REFRACTION'
            : mutation.path === 'eye-health'
              ? 'EYE_HEALTH'
              : 'COLOUR_VISION',
        payload: mutation.body,
      })));
      const recordByAction = new Map(batch.map((item) => [item.mutation.clientActionId, item.record]));
      for (const result of response.actions) {
        const record = recordByAction.get(result.clientActionId);
        if (!record) continue;
        if (result.status === 'APPLIED') {
          await deleteRecords([record]);
          synced += 1;
          if (result.result?.routeProgression) {
            committedProgressions.push({
              clientActionId: result.clientActionId,
              routeProgression: result.result.routeProgression,
            });
          }
        } else if (result.status === 'CONFLICT') {
          await markConflict(record);
        }
      }

      const currentSnapshot = await loadSnapshot(ownerId, eventId);
      const snapshot = {
        ...snapshotFromPull(response.pull, currentSnapshot?.event),
        roles: currentSnapshot?.roles,
        capabilities: currentSnapshot?.capabilities,
        registration: currentSnapshot?.registration,
        queue: currentSnapshot?.queue,
        routes: currentSnapshot?.routes,
        review: currentSnapshot?.review,
        registrationMappings: currentSnapshot?.registrationMappings,
        canonicalQrPasses: currentSnapshot?.canonicalQrPasses,
      };
      const expiresAt = snapshotExpiry(snapshot);
      if (!expiresAt) throw new Error('Offline screening access is unavailable for this event.');
      await putRecord(await encryptRecord({
        id: snapshotId(ownerId, eventId),
        ownerId,
        eventId,
        kind: 'snapshot',
        status: 'ready',
        expiresAt,
      }, snapshot));
    } catch (error) {
      if (isNetworkError(error)) break;
      if (isScopeExpiredError(error)) {
        await lockEventAccess(ownerId, eventId);
        return { ...(await getOfflineSyncStatus(ownerId, eventId)), synced, expired: true, committedProgressions };
      }
      throw error;
    }
  }
  synced += await syncOfflineReviews(ownerId, eventId);
  notifyOfflineChange();
  return { ...(await getOfflineSyncStatus(ownerId, eventId)), synced, expired: false, committedProgressions };
}

export async function listOfflineEventIds(ownerId: string): Promise<string[]> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction('records', 'readonly');
    const records = await requestValue<EncryptedRecord[]>(transaction.objectStore('records').getAll());
    return [...new Set(records.filter((record) => record.ownerId === ownerId).map((record) => record.eventId))];
  } finally {
    database.close();
  }
}

export async function purgeExpiredOfflineData(ownerId: string) {
  for (const eventId of await listOfflineEventIds(ownerId)) {
    await getOfflineSyncStatus(ownerId, eventId);
  }
}

export async function clearOfflineData() {
  if (unsupportedStorage()) return;
  const database = await openDatabase();
  try {
    const transaction = database.transaction(['keys', 'records'], 'readwrite');
    await Promise.all([
      requestValue(transaction.objectStore('keys').clear()),
      requestValue(transaction.objectStore('records').clear()),
    ]);
  } finally {
    database.close();
  }
  cryptoKeyPromise = null;
  notifyOfflineChange();
}
