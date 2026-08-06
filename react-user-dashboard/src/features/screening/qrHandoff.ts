import apiClient from '../../utils/apiClient';
import { STATION_LABEL, STATION_PATH_SLUG, stationPath } from './stationConfig';
import type { StationType } from './screeningApi';

export type QrVerifyResult = {
  valid: boolean;
  qrId: string;
  registrationId: string;
  participant: {
    id: string;
    firstName: string;
    lastName: string;
  };
  event: {
    id: string;
    name: string;
  };
  queueNumber: number | null;
};

/** Default station after a successful scan. Staff can switch via picker links. */
export const DEFAULT_HANDOFF_STATION: StationType = 'VISUAL_ACUITY';

export const HANDOFF_STATION_OPTIONS: StationType[] = (
  Object.keys(STATION_PATH_SLUG) as StationType[]
).filter((type) => Boolean(STATION_PATH_SLUG[type]));

/**
 * Pull a QR token from a pasted URL (`…/participant-status/<token>`) or raw hex / demo token.
 */
export function extractQrToken(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  try {
    const asUrl = new URL(trimmed);
    const pathMatch = asUrl.pathname.match(/\/participant-status\/([^/]+)\/?$/i);
    if (pathMatch?.[1]) return decodeURIComponent(pathMatch[1]);
  } catch {
    // not a full URL — fall through
  }

  const pathOnly = trimmed.match(/(?:^|\/)participant-status\/([^/?#]+)/i);
  if (pathOnly?.[1]) return decodeURIComponent(pathOnly[1]);

  return trimmed;
}

export async function verifyQrToken(token: string, eventId?: string): Promise<QrVerifyResult> {
  const { data } = await apiClient.post<{ success: boolean; data: QrVerifyResult }>('/qr/verify', {
    token,
    ...(eventId ? { eventId } : {}),
  });
  return data.data;
}

export function stationHandoffUrl(
  eventId: string,
  registrationId: string,
  stationType: StationType = DEFAULT_HANDOFF_STATION,
): string | null {
  return stationPath(eventId, stationType, registrationId);
}

export { STATION_LABEL };
