import apiClient from '../../utils/apiClient';
import type {
  ColourVisionResultData,
  EyeHealthResultData,
  EyeReading,
  FlagEvaluation,
  OverallFlag,
  QueueRegistration,
  RefractionResultData,
  ScreeningSavePayload,
  Station,
  StationType,
  VisualAcuityResultData,
} from './screeningApi';

const DATABASE_NAME = 'vsms-screening-offline';
const DATABASE_VERSION = 1;
const KEY_ID = 'screening-cache-key';
const SUPPORTED_STATIONS = new Set<StationType>(['VISUAL_ACUITY', 'REFRACTION', 'COLOUR_VISION', 'EYE_HEALTH']);
const OFFLINE_SYNC_EVENT = 'vsms-offline-sync';
let cryptoKeyPromise: Promise<CryptoKey> | null = null;

type ScreeningPath = 'visual-acuity' | 'refraction' | 'colour-vision' | 'eye-health';
type OfflineMutationStatus = 'pending' | 'conflict';

type OfflineStation = Station & { offlineAccessExpiresAt: string };
type OfflineQueueRegistration = Omit<QueueRegistration, 'passToken'>;

type OfflineSnapshot = {
  event: { eventId: string; name: string };
  stations: OfflineStation[];
  queues: Record<string, OfflineQueueRegistration[]>;
};

type OfflineMutation = {
  clientActionId: string;
  stationId: string;
  path: ScreeningPath;
  body: ScreeningSavePayload<VisualAcuityResultData | RefractionResultData | ColourVisionResultData | EyeHealthResultData>;
};

type ScreeningSyncActionResult = {
  clientActionId: string;
  status: 'APPLIED' | 'CONFLICT' | 'FAILED';
  retryCount: number;
  errorCode?: string;
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

type EncryptedRecord = {
  id: string;
  ownerId: string;
  eventId: string;
  kind: 'snapshot' | 'mutation';
  status: OfflineMutationStatus | 'ready';
  expiresAt: string;
  iv: ArrayBuffer;
  ciphertext: ArrayBuffer;
};

export type OfflineSyncStatus = {
  downloaded: boolean;
  pending: number;
  conflicts: number;
  expiresAt: string | null;
};

export type OfflineStationContext = {
  eventName: string;
  station: Station;
  stations: Station[];
  queue: QueueRegistration[];
};

export type OfflineSyncResult = OfflineSyncStatus & {
  synced: number;
  expired: boolean;
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

async function getRecord(id: string): Promise<EncryptedRecord | undefined> {
  return inStore<EncryptedRecord | undefined>('records', 'readonly', (store) => store.get(id));
}

async function putRecord(record: EncryptedRecord) {
  await inStore<IDBValidKey>('records', 'readwrite', (store) => store.put(record));
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
    offlineAccessExpiresAt: station.offlineAccessExpiresAt,
  };
}

function toOfflineQueue(rows: Array<Omit<QueueRegistration, 'passToken'> & Partial<Pick<QueueRegistration, 'passToken'>>>): OfflineQueueRegistration[] {
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
  if (record.kind !== 'snapshot' || isExpired(record.expiresAt)) {
    await purgeEvent(ownerId, eventId);
    return null;
  }
  try {
    return await decryptRecord<OfflineSnapshot>(record);
  } catch {
    // A browser key reset or malformed ciphertext must never leave stale clinical data available.
    await purgeEvent(ownerId, eventId);
    return null;
  }
}

function snapshotFromPull(pull: ScreeningSyncResponse['pull']): OfflineSnapshot {
  const stations = pull.stations.map(toOfflineStation).filter((station): station is OfflineStation => Boolean(station));
  if (!stations.length) {
    throw new Error('No currently assigned screening stations are available to download for offline use.');
  }
  return {
    event: { eventId: pull.event.eventId, name: pull.event.name },
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

function snapshotExpiry(snapshot: OfflineSnapshot) {
  return snapshot.stations.reduce((earliest, station) => (
    Date.parse(station.offlineAccessExpiresAt) < Date.parse(earliest)
      ? station.offlineAccessExpiresAt
      : earliest
  ), snapshot.stations[0].offlineAccessExpiresAt);
}

export async function downloadOfflineEvent(ownerId: string, eventId: string): Promise<OfflineSyncStatus> {
  const response = await requestScreeningSync(eventId, []);
  const snapshot = snapshotFromPull(response.pull);
  const expiresAt = snapshotExpiry(snapshot);
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
  stationType: StationType,
): Promise<OfflineStationContext | null> {
  const snapshot = await loadSnapshot(ownerId, eventId);
  if (!snapshot) return null;
  const station = snapshot.stations.find((item) => item.stationType === stationType);
  if (!station || isExpired(station.offlineAccessExpiresAt)) {
    await purgeEvent(ownerId, eventId);
    return null;
  }
  return {
    eventName: snapshot.event.name,
    station,
    stations: snapshot.stations,
    queue: (snapshot.queues[station.stationId] ?? []).map((row) => ({ ...row, passToken: null })),
  };
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
  const summary = [
    `Cataract ${resultData.cataractRisk}`,
    `Glaucoma ${resultData.glaucomaRisk}`,
    resultData.symptomsNoted ? 'Symptoms noted' : 'No symptoms',
  ].join(' / ');
  return {
    ruleVersion: 'VSMS-EH-1.0',
    overallFlag,
    isFlagged: overallFlag !== 'NORMAL',
    flagSummary: reasons.length ? reasons.map((item) => item.reason).join('; ') : summary,
    reasons,
  };
}

export function evaluateOfflineStation(path: ScreeningPath, resultData: VisualAcuityResultData | RefractionResultData | ColourVisionResultData | EyeHealthResultData): FlagEvaluation {
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
  body: ScreeningSavePayload<VisualAcuityResultData | RefractionResultData | ColourVisionResultData | EyeHealthResultData>,
): Promise<FlagEvaluation> {
  const snapshot = await loadSnapshot(ownerId, eventId);
  const station = snapshot?.stations.find((item) => item.stationId === stationId);
  const queue = station ? snapshot?.queues[stationId] : null;
  if (!snapshot || !station || !queue?.some((row) => row.registrationId === body.registrationId)) {
    throw new Error('This participant is not in a current offline station download. Reconnect before saving.');
  }
  if (isExpired(station.offlineAccessExpiresAt)) {
    await purgeEvent(ownerId, eventId);
    throw new Error('Offline access for this station has expired. Reconnect before saving.');
  }
  const evaluation = evaluateOfflineStation(path, body.resultData);
  if (evaluation.isFlagged && body.acknowledged !== true) {
    throw new Error(`Flagged result (${evaluation.overallFlag}) must be acknowledged before saving.`);
  }
  const expiresAt = snapshotExpiry(snapshot);
  const clientActionId = crypto.randomUUID();
  const record = await encryptRecord({
    id: `${ownerId}:${eventId}:mutation:${clientActionId}`,
    ownerId,
    eventId,
    kind: 'mutation',
    status: 'pending',
    expiresAt,
  }, { clientActionId, stationId, path, body } satisfies OfflineMutation);
  await putRecord(record);
  notifyOfflineChange();
  return evaluation;
}

export async function getOfflineSyncStatus(ownerId: string, eventId: string): Promise<OfflineSyncStatus> {
  const records = await recordsForEvent(ownerId, eventId);
  if (records.some((record) => isExpired(record.expiresAt))) {
    await purgeEvent(ownerId, eventId);
    return { downloaded: false, pending: 0, conflicts: 0, expiresAt: null };
  }
  const snapshot = records.find((record) => record.kind === 'snapshot');
  return {
    downloaded: Boolean(snapshot),
    pending: records.filter((record) => record.kind === 'mutation' && record.status === 'pending').length,
    conflicts: records.filter((record) => record.kind === 'mutation' && record.status === 'conflict').length,
    expiresAt: snapshot?.expiresAt ?? null,
  };
}

function isScopeExpiredError(error: unknown) {
  const status = (error as { response?: { status?: number } })?.response?.status;
  return status === 403 || status === 404 || status === 409;
}

async function markConflict(record: EncryptedRecord) {
  await putRecord({ ...record, status: 'conflict' });
}

export async function syncOfflineEvent(ownerId: string, eventId: string): Promise<OfflineSyncResult> {
  const initial = await getOfflineSyncStatus(ownerId, eventId);
  if (!initial.downloaded) return { ...initial, synced: 0, expired: false };

  let synced = 0;
  const pending: Array<{ record: EncryptedRecord; mutation: OfflineMutation }> = [];
  for (const record of await recordsForEvent(ownerId, eventId)) {
    if (record.kind !== 'mutation' || record.status !== 'pending') continue;
    if (isExpired(record.expiresAt)) {
      await purgeEvent(ownerId, eventId);
      return { downloaded: false, pending: 0, conflicts: 0, expiresAt: null, synced, expired: true };
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
        stationType: mutation.path === 'visual-acuity'
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
        } else if (result.status === 'CONFLICT') {
          await markConflict(record);
        }
      }

      const snapshot = snapshotFromPull(response.pull);
      const expiresAt = snapshotExpiry(snapshot);
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
        await purgeEvent(ownerId, eventId);
        return { downloaded: false, pending: 0, conflicts: 0, expiresAt: null, synced, expired: true };
      }
      throw error;
    }
  }
  notifyOfflineChange();
  return { ...(await getOfflineSyncStatus(ownerId, eventId)), synced, expired: false };
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
