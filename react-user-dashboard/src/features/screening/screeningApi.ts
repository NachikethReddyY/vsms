import apiClient from '../../utils/apiClient';

export type StationType = 'VISUAL_ACUITY' | 'REFRACTION' | 'COLOUR_VISION' | 'EYE_HEALTH';
export type OverallFlag = 'NORMAL' | 'REVIEW' | 'REFER' | 'URGENT';

export type Station = {
  stationId: string;
  eventId: string;
  stationName: string;
  stationType: StationType;
  stationOrder: number;
  isActive: boolean;
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

export type VisualAcuityPayload = {
  registrationId: string;
  idempotencyKey: string;
  acknowledged: true;
  resultData: {
    chartDistanceMetres: 3 | 6;
    od: EyeReading;
    os: EyeReading;
    withUsualDistanceGlasses: boolean | null;
  };
};

export const screeningApi = {
  async listStations(eventId: string) {
    const { data } = await apiClient.get<{
      event: { eventId: string; name: string; status: string; venue: string };
      stations: Station[];
    }>(`/api/events/${eventId}/stations`);
    return data;
  },

  async listQueue(eventId: string, stationId: string) {
    const { data } = await apiClient.get<{
      station: Station;
      registrations: QueueRegistration[];
    }>(`/api/events/${eventId}/stations/${stationId}/queue`);
    return data;
  },

  async resolve(eventId: string, params: { passToken?: string; registrationId?: string }) {
    const { data } = await apiClient.get<{
      registrationId: string;
      participantDisplayName: string;
      queueNumber: number | null;
      status: string;
      passToken: string | null;
    }>(`/api/events/${eventId}/registrations/resolve`, { params });
    return data;
  },

  async saveVisualAcuity(eventId: string, stationId: string, body: VisualAcuityPayload) {
    const { data } = await apiClient.post(`/api/events/${eventId}/stations/${stationId}/visual-acuity`, body);
    return data as {
      resultId: string;
      overallFlag: OverallFlag;
      isFlagged: boolean;
      flagSummary: string | null;
      resultData: VisualAcuityPayload['resultData'];
    };
  },
};
