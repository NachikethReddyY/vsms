/* @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getOfflineCanonicalRegistration = vi.fn();
const get = vi.fn();
const post = vi.fn();

vi.mock('../../auth/AuthProvider', () => ({
  useAuth: () => ({ session: { user: { id: 'owner-1' } } }),
}));
vi.mock('../../features/screening/offlineSync', () => ({
  getOfflineCanonicalRegistration: (...args: unknown[]) => getOfflineCanonicalRegistration(...args),
}));
vi.mock('../../utils/apiClient', () => ({
  default: {
    get: (...args: unknown[]) => get(...args),
    post: (...args: unknown[]) => post(...args),
  },
  getApiError: (_error: unknown, fallback: string) => fallback,
  newIdempotencyHeaders: () => ({ 'Idempotency-Key': 'test-key' }),
}));

import ParticipantQrPage from '../../pages/participant/ParticipantQrPage';

const eventId = '22222222-2222-4222-8222-222222222222';
const localRegistrationId = '44444444-4444-4444-8444-444444444444';
const canonicalRegistrationId = '88888888-8888-4888-8888-888888888888';
const qrImage = 'data:image/svg+xml;base64,PHN2Zy8+';

function renderPage() {
  return render(
    <MemoryRouter initialEntries={[`/participants/registrations/${localRegistrationId}/qr?eventId=${eventId}`]}>
      <Routes><Route path="/participants/registrations/:registrationId/qr" element={<ParticipantQrPage />} /></Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
  get.mockReset();
  post.mockReset();
  getOfflineCanonicalRegistration.mockReset().mockResolvedValue({
    localRegistrationId,
    registrationId: canonicalRegistrationId,
    qrId: '99999999-9999-4999-8999-999999999999',
    issuedAt: '2026-08-17T00:00:00.000Z',
    expiresAt: '2026-08-18T00:00:00.000Z',
    qrImage,
    queueNumber: 17,
    eventName: 'Vision Day',
  });
});

afterEach(() => {
  cleanup();
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
});

describe('offline canonical participant QR', () => {
  it('renders the encrypted cached server pass without any network request', async () => {
    renderPage();

    const image = await screen.findByRole('img', { name: /Secure QR code/i });
    expect(image.getAttribute('src')).toBe(qrImage);
    expect(getOfflineCanonicalRegistration).toHaveBeenCalledWith('owner-1', eventId, localRegistrationId);
    expect(get).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
    expect(screen.getByText('Server-issued pass')).toBeTruthy();
    expect(screen.getByText('Vision Day')).toBeTruthy();
    expect(screen.getByText('Q-017')).toBeTruthy();
  });
});
