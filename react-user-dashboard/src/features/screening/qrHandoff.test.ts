import { describe, expect, it } from 'vitest';
import { extractQrToken } from './qrHandoff';

describe('secure participant QR input', () => {
  it('accepts the same raw token or participant-status URL throughout the event', () => {
    const token = 'a'.repeat(64);
    expect(extractQrToken(token)).toBe(token);
    expect(extractQrToken(`https://example.test/participant-status/${token}`)).toBe(token);
  });
});
