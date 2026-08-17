/* @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const eventGet = vi.fn();
const ensureOfflineReady = vi.fn();
const queueOfflineWalkInRegistration = vi.fn();
const getOfflineCanonicalRegistration = vi.fn();
const post = vi.fn();
let online = true;

vi.mock('../../features/events/eventApi', () => ({
  eventApi: { get: (...args: unknown[]) => eventGet(...args) },
}));
vi.mock('../../features/screening/OfflineSyncProvider', () => ({
  useOfflineSync: () => ({ online, ensureOfflineReady }),
}));
vi.mock('../../features/screening/offlineSync', () => ({
  queueOfflineWalkInRegistration: (...args: unknown[]) => queueOfflineWalkInRegistration(...args),
  getOfflineCanonicalRegistration: (...args: unknown[]) => getOfflineCanonicalRegistration(...args),
  offlineSyncChangeEvent: 'vsms-offline-sync',
}));
vi.mock('../../auth/AuthProvider', () => ({
  useAuth: () => ({ session: { user: { id: 'owner-1' } } }),
}));
vi.mock('../../utils/apiClient', () => ({ default: { post } }));
vi.mock('../../components/PhoneInput', () => ({
  PhoneInput: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
    <input value={value} onChange={(event) => onChange(event.target.value)} />
  ),
}));

import EventRegistrationPage from '../../pages/participant/EventRegistrationPage';

const eventId = '22222222-2222-4222-8222-222222222222';

function renderPage() {
  return render(
    <MemoryRouter initialEntries={[`/events/${eventId}/register`]}>
      <Routes><Route path="/events/:eventId/register" element={<EventRegistrationPage />} /></Routes>
    </MemoryRouter>,
  );
}

async function completeForm() {
  const user = userEvent.setup();
  await screen.findByRole('heading', { name: 'Register participant' });
  await user.type(screen.getByLabelText(/First name/i), 'Ada');
  await user.type(screen.getByLabelText(/Last name/i), 'Lovelace');
  fireEvent.change(screen.getByLabelText(/Date of birth/i), { target: { value: '1980-01-01' } });
  await user.type(screen.getByLabelText(/NRIC \/ FIN/i), 'S1234567D');
  await user.type(screen.getByLabelText(/^Contact number/i), '+6591234567');
  await user.type(screen.getByLabelText(/^Email/i), 'ada@example.test');
  await user.type(screen.getByLabelText(/^Race/i), 'Other');
  await user.type(screen.getByLabelText(/Street address/i), '1 Test Street');
  await user.type(screen.getByLabelText(/Unit number/i), '#01-01');
  await user.type(screen.getByLabelText(/Postal code/i), '123456');
  await user.type(screen.getByLabelText(/Contact name/i), 'Grace Hopper');
  await user.type(screen.getByLabelText(/Relationship/i), 'Friend');
  await user.type(screen.getByLabelText(/Contact phone/i), '+6597654321');
  await user.type(screen.getByLabelText(/Contact email/i), 'grace@example.test');
  await user.click(screen.getByRole('button', { name: 'Register participant' }));
}

beforeEach(() => {
  online = true;
  eventGet.mockReset().mockResolvedValue({
    eventId,
    name: 'Vision Day',
    venue: 'Community Hall',
    startsAt: '2026-08-18T01:00:00.000Z',
  });
  ensureOfflineReady.mockReset().mockResolvedValue(undefined);
  queueOfflineWalkInRegistration.mockReset().mockResolvedValue({
    participantId: 'participant-1',
    registrationId: 'registration-1',
    queueNumber: 17,
    stationId: 'station-1',
    stationName: 'Visual Acuity',
    stationNumber: 1,
    savedOnDevice: true,
  });
  getOfflineCanonicalRegistration.mockReset().mockResolvedValue(null);
  post.mockReset();
});

afterEach(cleanup);

describe('local-first event registration', () => {
  it('prepares the pack online but commits through the encrypted local queue without a participant POST', async () => {
    renderPage();
    await completeForm();

    await waitFor(() => expect(queueOfflineWalkInRegistration).toHaveBeenCalled());
    expect(ensureOfflineReady).toHaveBeenCalledWith(eventId);
    expect(ensureOfflineReady.mock.invocationCallOrder[0]).toBeLessThan(queueOfflineWalkInRegistration.mock.invocationCallOrder[0]);
    expect(queueOfflineWalkInRegistration).toHaveBeenCalledWith('owner-1', eventId, expect.objectContaining({
      participant: expect.objectContaining({ firstName: 'Ada', nric: 'S1234567D' }),
      emergencyContact: {
        contactName: 'Grace Hopper',
        relationship: 'Friend',
        phoneNumber: '+6597654321',
        email: 'grace@example.test',
      },
      paperFormUsed: false,
    }));
    expect(post).not.toHaveBeenCalled();
  });

  it('shows only the provisional queue and station numbers offline, with no QR', async () => {
    online = false;
    queueOfflineWalkInRegistration.mockResolvedValueOnce({
      participantId: 'participant-2',
      registrationId: 'registration-2',
      queueNumber: 23,
      stationId: 'station-4',
      stationName: 'Eye Health',
      stationNumber: 4,
      savedOnDevice: true,
    });
    renderPage();
    await completeForm();

    expect(await screen.findByText('Q-023')).toBeTruthy();
    expect(screen.getByText('Station 4')).toBeTruthy();
    expect(screen.queryByText('Eye Health')).toBeNull();
    expect(screen.getByText(/No QR code exists until the server confirms/i)).toBeTruthy();
    expect(screen.queryByRole('img', { name: /QR/i })).toBeNull();
    expect(ensureOfflineReady).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });

  it('reveals the canonical QR link only after encrypted sync storage reports it ready', async () => {
    renderPage();
    await completeForm();
    expect(await screen.findByText(/No QR code exists until the server confirms/i)).toBeTruthy();
    expect(screen.queryByRole('link', { name: /View canonical QR/i })).toBeNull();

    getOfflineCanonicalRegistration.mockResolvedValue({
      localRegistrationId: 'registration-1',
      registrationId: '88888888-8888-4888-8888-888888888888',
      qrId: '99999999-9999-4999-8999-999999999999',
      issuedAt: '2026-08-17T00:00:00.000Z',
      expiresAt: '2026-08-18T00:00:00.000Z',
      qrImage: 'data:image/svg+xml;base64,PHN2Zy8+',
      queueNumber: 17,
      eventName: 'Vision Day',
    });
    window.dispatchEvent(new Event('vsms-offline-sync'));

    const link = await screen.findByRole('link', { name: /View canonical QR/i });
    expect(link.getAttribute('href')).toBe(`/participants/registrations/88888888-8888-4888-8888-888888888888/qr?eventId=${eventId}`);
    expect(screen.getByText(/canonical QR pass is ready/i)).toBeTruthy();
  });
});
