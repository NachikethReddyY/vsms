import apiClient from '../../utils/apiClient';
import { getStoredSession } from '../../utils/session';
import { evaluateOfflineStation, isNetworkError, queueOfflineStationSave } from './offlineSync';
import type { DynamicFieldValues, FieldSchema } from './fieldSchema';

export type StationType = 'VISUAL_ACUITY' | 'REFRACTION' | 'COLOUR_VISION' | 'EYE_HEALTH' | 'CUSTOM';
export type OverallFlag = 'NORMAL' | 'REVIEW' | 'REFER' | 'URGENT';

export type Station = {
  stationId: string;
  eventId: string;
  stationName: string;
  stationType: StationType;
  stationOrder: number;
  isActive: boolean;
  fieldSchemaSnapshot?: FieldSchema | null;
  schemaVersion?: number | null;
  offlineAccessExpiresAt?: string;
};

export type QueueRegistration = {
  registrationId: string;
  participantDisplayName: string;
  queueNumber: number | null;
  status: string;
  existingResult: {
    resultId: string;
    overallFlag: OverallFlag;
    isFlagged: boolean;
    createdAt: string;
  } | null;
};

export type EyeReading =
  | { kind: 'FRACTION'; denominator: number }
  | { kind: 'EXCEPTION'; code: 'CF' | 'HM' | 'LP' | 'NLP' | 'NOT_TESTABLE' };

export type VisualAcuityResultData = {
  chartDistanceMetres: 3 | 6;
  od: EyeReading;
  os: EyeReading;
  withUsualDistanceGlasses: boolean | null;
};

export type RefractionEye = {
  sphere: number;
  cylinder: number;
  axis: number | null;
};

export type RefractionResultData =
  | {
    measurementStatus: 'COMPLETED';
    wearsDistanceGlasses: boolean | null;
    od: RefractionEye;
    os: RefractionEye;
    notes?: string;
  }
  | {
    measurementStatus: 'UNABLE_TO_MEASURE' | 'REPEAT_REQUIRED';
    wearsDistanceGlasses: boolean | null;
    notes: string;
  };

export type ColourVisionResultData = {
  testKit: 'ISHIHARA';
  platesPresented: number;
  odCorrect: number;
  osCorrect: number;
};

export type EyeHealthRisk = 'NONE' | 'SUSPECTED' | 'PRESENT' | 'NOT_ASSESSED';

export type EyeHealthResultData = {
  cataractRisk: EyeHealthRisk;
  glaucomaRisk: EyeHealthRisk;
  symptomsNoted: boolean;
  symptomSummary?: string;
  observations: string;
  deviceFindings?: string | null;
};

export type FlagEvaluation = {
  ruleVersion: string;
  overallFlag: OverallFlag;
  isFlagged: boolean;
  flagSummary: string | null;
  reasons: Array<{ flag: OverallFlag; reason: string }>;
};

export type ScreeningSavePayload<T> = {
  registrationId: string;
  idempotencyKey: string;
  acknowledged: boolean;
  resultData: T;
};

export type ScreeningSaveResponse<T> = {
  resultId: string;
  overallFlag: OverallFlag;
  isFlagged: boolean;
  flagSummary: string | null;
  ruleVersion?: string;
  acknowledgedAt?: string | null;
  resultData: T;
  evaluation?: FlagEvaluation;
  queued?: boolean;
  routeProgression?: RouteProgression | null;
  syncState: 'COMMITTED' | 'PENDING_SYNC';
};

export type RouteProgression = {
  status: 'ADDED_TO_QUEUE' | 'REVIEW_READY' | 'BLOCKED' | 'CORRECTION_SAVED';
  routeVersion?: number;
  completedStation?: Pick<Station, 'stationId' | 'stationName' | 'stationType'> | null;
  nextStation?: Pick<Station, 'stationId' | 'stationName' | 'stationType'> | null;
  nextQueue?: {
    stationId: string;
    stationName: string;
    stationType: StationType;
    queueNumber: number;
    status: 'WAITING';
  } | null;
};

export type VisualAcuityPayload = ScreeningSavePayload<VisualAcuityResultData>;

export type DynamicResultData = DynamicFieldValues;
type StationResultData = VisualAcuityResultData | RefractionResultData | ColourVisionResultData | EyeHealthResultData | DynamicResultData;
type OfflineScreeningPath = 'visual-acuity' | 'refraction' | 'colour-vision' | 'dynamic';
type ScreeningPath = OfflineScreeningPath | 'eye-health';

async function previewStation<T extends StationResultData>(
  eventId: string,
  stationId: string,
  path: ScreeningPath,
  resultData: T,
) {
  try {
    const { data } = await apiClient.post<FlagEvaluation>(
      `/events/${eventId}/stations/${stationId}/${path}/preview`,
      { resultData },
    );
    return data;
  } catch (error) {
    if (!isNetworkError(error)) throw error;
    if (path === 'eye-health') throw error;
    return evaluateOfflineStation(path, resultData as VisualAcuityResultData | RefractionResultData | ColourVisionResultData | DynamicResultData);
  }
}

async function saveStation<T extends StationResultData>(
  eventId: string,
  stationId: string,
  path: ScreeningPath,
  body: ScreeningSavePayload<T>,
): Promise<ScreeningSaveResponse<T>> {
  try {
    const { data } = await apiClient.post(`/events/${eventId}/stations/${stationId}/${path}`, body);
    return { ...(data as Omit<ScreeningSaveResponse<T>, 'syncState'>), syncState: 'COMMITTED' as const };
  } catch (error) {
    if (!isNetworkError(error)) throw error;
    if (path === 'eye-health') throw error;
    const ownerId = getStoredSession()?.user.id;
    if (!ownerId) throw error;
    const evaluation = await queueOfflineStationSave(
      ownerId,
      eventId,
      stationId,
      path,
      body as ScreeningSavePayload<VisualAcuityResultData | RefractionResultData | ColourVisionResultData | DynamicResultData>,
    );
    return {
      resultId: `offline:${body.idempotencyKey}`,
      overallFlag: evaluation.overallFlag,
      isFlagged: evaluation.isFlagged,
      flagSummary: evaluation.flagSummary,
      ruleVersion: evaluation.ruleVersion,
      acknowledgedAt: body.acknowledged ? new Date().toISOString() : null,
      resultData: body.resultData,
      evaluation,
      queued: true,
      syncState: 'PENDING_SYNC' as const,
    };
  }
}

export const screeningApi = {
  async listStations(eventId: string) {
    const { data } = await apiClient.get<{
      event: { eventId: string; name: string; status: string; venue: string };
      stations: Station[];
    }>(`/events/${eventId}/stations`);
    return data;
  },

  async listQueue(eventId: string, stationId: string) {
    const { data } = await apiClient.get<{
      station: Station;
      registrations: QueueRegistration[];
    }>(`/events/${eventId}/stations/${stationId}/queue`);
    return data;
  },

  async resolve(eventId: string, params: { passToken?: string; qrToken?: string; registrationId?: string }) {
    const { data } = await apiClient.get<{
      registrationId: string;
      participantDisplayName: string;
      queueNumber: number | null;
      status: string;
    }>(`/events/${eventId}/registrations/resolve`, { params });
    const { data: queue } = await apiClient.get<{ activeEntry: { station: { stationId: string; stationName: string; stationType: string } } | null }>(`/queues/events/${eventId}/participants/${data.registrationId}`);
    return { ...data, activeStation: queue.activeEntry?.station ?? null };
  },

  async getPassDisplay(eventId: string, registrationId: string) {
    const { data } = await apiClient.get<{
      qrId: string | null;
      registrationId: string;
      qrImage: string;
      expiresAt: string | null;
      participantDisplayName: string;
      queueNumber: number | null;
    }>(`/events/${eventId}/registrations/${registrationId}/pass-display`);
    return data;
  },

  previewVisualAcuity(eventId: string, stationId: string, resultData: VisualAcuityResultData) {
    return previewStation(eventId, stationId, 'visual-acuity', resultData);
  },

  saveVisualAcuity(eventId: string, stationId: string, body: VisualAcuityPayload) {
    return saveStation(eventId, stationId, 'visual-acuity', body);
  },

  previewRefraction(eventId: string, stationId: string, resultData: RefractionResultData) {
    return previewStation(eventId, stationId, 'refraction', resultData);
  },

  saveRefraction(eventId: string, stationId: string, body: ScreeningSavePayload<RefractionResultData>) {
    return saveStation(eventId, stationId, 'refraction', body);
  },

  previewColourVision(eventId: string, stationId: string, resultData: ColourVisionResultData) {
    return previewStation(eventId, stationId, 'colour-vision', resultData);
  },

  saveColourVision(eventId: string, stationId: string, body: ScreeningSavePayload<ColourVisionResultData>) {
    return saveStation(eventId, stationId, 'colour-vision', body);
  },

  previewEyeHealth(eventId: string, stationId: string, resultData: EyeHealthResultData) {
    return previewStation(eventId, stationId, 'eye-health', resultData);
  },

  saveEyeHealth(eventId: string, stationId: string, body: ScreeningSavePayload<EyeHealthResultData>) {
    return saveStation(eventId, stationId, 'eye-health', body);
  },

  previewDynamic(eventId: string, stationId: string, resultData: DynamicResultData) {
    return previewStation(eventId, stationId, 'dynamic', resultData);
  },

  saveDynamic(eventId: string, stationId: string, body: ScreeningSavePayload<DynamicResultData>) {
    return saveStation(eventId, stationId, 'dynamic', body);
  },
};

export function newIdempotencyKey() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID().replace(/-/g, '');
  return `${Date.now()}${Math.random().toString(16).slice(2)}`;
}
