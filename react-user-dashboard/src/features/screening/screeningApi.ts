import apiClient from '../../utils/apiClient';
import { getStoredSession } from '../../utils/session';
import { evaluateOfflineStation, isNetworkError, queueOfflineStationSave } from './offlineSync';

export type StationType = 'VISUAL_ACUITY' | 'REFRACTION' | 'COLOUR_VISION' | 'EYE_HEALTH';
export type OverallFlag = 'NORMAL' | 'REVIEW' | 'REFER' | 'URGENT';

export type Station = {
  stationId: string;
  eventId: string;
  stationName: string;
  stationType: StationType;
  stationOrder: number;
  isActive: boolean;
  offlineAccessExpiresAt?: string;
};

export type QueueRegistration = {
  registrationId: string;
  participantDisplayName: string;
  queueNumber: number | null;
  status: string;
  passToken: string | null;
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
  flagSummary: string;
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
};

export type VisualAcuityPayload = ScreeningSavePayload<VisualAcuityResultData>;

type ScreeningPath = 'visual-acuity' | 'refraction' | 'colour-vision' | 'eye-health';

async function previewStation<T extends VisualAcuityResultData | RefractionResultData | ColourVisionResultData | EyeHealthResultData>(
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
    return evaluateOfflineStation(path, resultData);
  }
}

async function saveStation<T extends VisualAcuityResultData | RefractionResultData | ColourVisionResultData | EyeHealthResultData>(
  eventId: string,
  stationId: string,
  path: ScreeningPath,
  body: ScreeningSavePayload<T>,
) {
  try {
    const { data } = await apiClient.post(`/events/${eventId}/stations/${stationId}/${path}`, body);
    return data as ScreeningSaveResponse<T>;
  } catch (error) {
    if (!isNetworkError(error)) throw error;
    const ownerId = getStoredSession()?.user.id;
    if (!ownerId) throw error;
    const evaluation = await queueOfflineStationSave(ownerId, eventId, stationId, path, body);
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
      passToken: string | null;
    }>(`/events/${eventId}/registrations/resolve`, { params });
    return data;
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
};

export function newIdempotencyKey() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID().replace(/-/g, '');
  return `${Date.now()}${Math.random().toString(16).slice(2)}`;
}
