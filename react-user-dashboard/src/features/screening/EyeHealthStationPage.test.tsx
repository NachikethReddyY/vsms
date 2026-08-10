/* @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const loadStationContext = vi.fn();
const previewEyeHealth = vi.fn();
const saveEyeHealth = vi.fn();

vi.mock('./StationShared', () => ({
  loadStationContext: (...args: unknown[]) => loadStationContext(...args),
  FlagBanner: ({
    evaluation,
    acknowledged,
    onAcknowledgedChange,
  }: {
    evaluation: { overallFlag: string; flagSummary: string } | null;
    acknowledged: boolean;
    onAcknowledgedChange: (value: boolean) => void;
  }) => (
    evaluation ? (
      <div>
        <div role="status">{evaluation.overallFlag}: {evaluation.flagSummary}</div>
        <label>
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(event) => onAcknowledgedChange(event.target.checked)}
          />
          I acknowledge
        </label>
      </div>
    ) : null
  ),
  ParticipantLookup: ({
    selectedId,
    onSelect,
  }: {
    selectedId: string;
    onSelect: (id: string) => void;
    queue: Array<{ registrationId: string; participantDisplayName: string }>;
  }) => (
    <button type="button" onClick={() => onSelect(selectedId || '44444444-4444-4444-8444-444444444444')}>
      Select participant
    </button>
  ),
  StationHandoffLinks: () => <div>Handoff links</div>,
  StationPageFrame: ({
    title,
    children,
    lookup,
    handoff,
    error,
    success,
  }: {
    title: string;
    children: React.ReactNode;
    lookup?: React.ReactNode;
    handoff?: React.ReactNode;
    error?: string | null;
    success?: string | null;
  }) => (
    <section>
      <h1>{title}</h1>
      {error ? <p role="alert">{error}</p> : null}
      {success ? <p>{success}</p> : null}
      {lookup}
      {children}
      {handoff}
    </section>
  ),
}));

vi.mock('./screeningApi', () => ({
  newIdempotencyKey: () => 'idem-1',
  screeningApi: {
    previewEyeHealth: (...args: unknown[]) => previewEyeHealth(...args),
    saveEyeHealth: (...args: unknown[]) => saveEyeHealth(...args),
  },
}));

vi.mock('../../utils/apiClient', () => ({
  getApiError: (_cause: unknown, fallback: string) => fallback,
}));

import EyeHealthStationPage from './EyeHealthStationPage';

const station = {
  stationId: '33333333-3333-4333-8333-333333333333',
  eventId: '22222222-2222-4222-8222-222222222222',
  stationName: 'Eye Health',
  stationType: 'EYE_HEALTH' as const,
  stationOrder: 4,
  isActive: true,
};

const registration = {
  registrationId: '44444444-4444-4444-8444-444444444444',
  participantDisplayName: 'Ada Lovelace',
  queueNumber: 7,
  status: 'CHECKED_IN',
  passToken: null,
  existingResult: null,
};

beforeEach(() => {
  loadStationContext.mockReset();
  previewEyeHealth.mockReset();
  saveEyeHealth.mockReset();
  loadStationContext.mockResolvedValue({
    eventName: 'Vision Day',
    station,
    stations: [station],
    queue: [registration],
    nextSelectedId: registration.registrationId,
  });
});

afterEach(() => {
  cleanup();
});

function renderPage(path = `/events/${station.eventId}/stations/eye-health?registrationId=${registration.registrationId}`) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/events/:eventId/stations/eye-health" element={<EyeHealthStationPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('EyeHealthStationPage', () => {
  it('loads station context and shows empty validation when observations are missing', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Eye Health' })).toBeTruthy();
    await waitFor(() => expect(loadStationContext).toHaveBeenCalledWith(
      station.eventId,
      'EYE_HEALTH',
      'Eye Health',
      registration.registrationId,
    ));

    await userEvent.click(screen.getByRole('button', { name: /Check automatic flags/i }));
    expect(await screen.findByText(/Observations are required before checking flags/i)).toBeTruthy();
    expect(previewEyeHealth).not.toHaveBeenCalled();
  });

  it('shows load error state when context fails', async () => {
    loadStationContext.mockRejectedValueOnce(new Error('duty missing'));
    renderPage(`/events/${station.eventId}/stations/eye-health`);
    expect(await screen.findByText(/Could not load the Eye Health station/i)).toBeTruthy();
  });

  it('requires symptom summary when symptoms are noted', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Eye Health' });
    await userEvent.type(screen.getByLabelText(/^Observations/i), 'Quiet media.');
    await userEvent.click(screen.getByLabelText(/Symptoms noted/i));
    await userEvent.click(screen.getByRole('button', { name: /Check automatic flags/i }));
    expect(await screen.findByText(/Symptom summary is required when symptoms are noted/i)).toBeTruthy();
  });

  it('previews flags and blocks save until acknowledgement', async () => {
    previewEyeHealth.mockResolvedValueOnce({
      overallFlag: 'REFER',
      isFlagged: true,
      flagSummary: 'Cataract PRESENT',
      ruleVersion: 'VSMS-EH-1.0',
      reasons: [{ flag: 'REFER', reason: 'Cataract PRESENT' }],
    });
    renderPage();
    await screen.findByRole('heading', { name: 'Eye Health' });
    await userEvent.selectOptions(screen.getByLabelText(/Cataract risk/i), 'PRESENT');
    await userEvent.type(screen.getByLabelText(/^Observations/i), 'Mature cataract OD.');
    await userEvent.click(screen.getByRole('button', { name: /Check automatic flags/i }));
    expect(await screen.findByText(/REFER: Cataract PRESENT/i)).toBeTruthy();
    expect(previewEyeHealth).toHaveBeenCalled();

    const saveButton = screen.getByRole('button', { name: /Save flagged result/i });
    expect((saveButton as HTMLButtonElement).disabled).toBe(true);
    expect(saveEyeHealth).not.toHaveBeenCalled();
  });

  it('saves after acknowledgement on a flagged result', async () => {
    previewEyeHealth.mockResolvedValue({
      overallFlag: 'REVIEW',
      isFlagged: true,
      flagSummary: 'Symptoms noted',
      ruleVersion: 'VSMS-EH-1.0',
      reasons: [{ flag: 'REVIEW', reason: 'Symptoms noted' }],
    });
    saveEyeHealth.mockResolvedValue({
      overallFlag: 'REVIEW',
      isFlagged: true,
      flagSummary: 'Symptoms noted',
      ruleVersion: 'VSMS-EH-1.0',
      queued: false,
    });
    renderPage();
    await screen.findByRole('heading', { name: 'Eye Health' });
    await userEvent.click(screen.getByLabelText(/Symptoms noted/i));
    await userEvent.type(screen.getByLabelText(/Symptom summary/i), 'Blurry vision');
    await userEvent.type(screen.getByLabelText(/^Observations/i), 'Symptoms reported by participant.');
    await userEvent.click(screen.getByRole('button', { name: /Check automatic flags/i }));
    expect(await screen.findByText(/REVIEW: Symptoms noted/i)).toBeTruthy();
    await userEvent.click(screen.getByLabelText(/I acknowledge/i));
    await userEvent.click(screen.getByRole('button', { name: /Save flagged result/i }));
    await waitFor(() => expect(saveEyeHealth).toHaveBeenCalled());
    expect(await screen.findByText(/Saved with REVIEW flag/i)).toBeTruthy();
  });
});
