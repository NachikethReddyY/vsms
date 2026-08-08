/**
 * Pull a QR token from a pasted URL (`…/participant-status/<token>`)
 * or raw hex/demo token.
 */
export function extractQrToken(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  try {
    const asUrl = new URL(trimmed);
    const pathMatch = asUrl.pathname.match(/\/participant-status\/([^/]+)\/?$/i);

    if (pathMatch?.[1]) {
      return decodeURIComponent(pathMatch[1]);
    }
  } catch {
    // not a full URL
  }

  const pathOnly = trimmed.match(/(?:^|\/)participant-status\/([^/?#]+)/i);

  if (pathOnly?.[1]) {
    return decodeURIComponent(pathOnly[1]);
  }

  return trimmed;
}