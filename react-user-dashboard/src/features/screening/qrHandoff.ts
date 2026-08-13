import apiClient from '../../utils/apiClient';

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

/**
 * Pull a QR token from a pasted participant-status URL or raw secure token.
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
