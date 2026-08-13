/* @vitest-environment jsdom */
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
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
    queue,
  }: {
    selectedId: string;
    onSelect: (id: string) => void;
    queue: Array<{ registrationId: string; participantDisplayName: string }>;
  }) => (
    <label>
      Participant
      <select value={selectedId} onChange={(event) => onSelect(event.target.value)}>
        {queue.map((row) => <option key={row.registrationId} value={row.registrationId}>{row.participantDisplayName}</option>)}
      </select>
    </label>
  ),
  RouteProgressionNotice: () => <div>Route updated</div>,
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
  existingResult: null,
};
const secondRegistration = {
  ...registration,
  registrationId: '55555555-5555-4555-8555-555555555555',
  participantDisplayName: 'Grace Hopper',
  queueNumber: 8,
};

beforeEach(() => {
  loadStationContext.mockReset();
  previewEyeHealth.mockReset();
  saveEyeHealth.mockReset();
  loadStationContext.mockResolvedValue({
    eventName: 'Vision Day',
    station,
    stations: [station],
    queue: [registration, secondRegistration],
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

  it('clears participant-specific fields, flags, acknowledgement, and success when the participant changes', async () => {
    previewEyeHealth.mockResolvedValue({
      overallFlag: 'REFER',
      isFlagged: true,
      flagSummary: 'Clinical risk present',
      ruleVersion: 'VSMS-EH-1.0',
      reasons: [{ flag: 'REFER', reason: 'Clinical risk present' }],
    });
    saveEyeHealth.mockResolvedValue({
      overallFlag: 'REFER',
      isFlagged: true,
      flagSummary: 'Clinical risk present',
      ruleVersion: 'VSMS-EH-1.0',
      queued: false,
    });
    renderPage();
    await screen.findByRole('heading', { name: 'Eye Health' });
    await userEvent.selectOptions(screen.getByLabelText(/Cataract risk/i), 'PRESENT');
    await userEvent.selectOptions(screen.getByLabelText(/Glaucoma risk/i), 'SUSPECTED');
    await userEvent.click(screen.getByLabelText(/Symptoms noted/i));
    await userEvent.type(screen.getByLabelText(/Symptom summary/i), 'Blurred vision');
    await userEvent.type(screen.getByLabelText(/^Observations/i), 'Lens opacity observed.');
    await userEvent.type(screen.getByLabelText(/Device findings/i), 'Imaging finding.');
    await userEvent.click(screen.getByRole('button', { name: /Check automatic flags/i }));
    await userEvent.click(await screen.findByLabelText(/I acknowledge/i));
    await userEvent.click(screen.getByRole('button', { name: /Save flagged result/i }));
    expect(await screen.findByText(/Saved with REFER flag/i)).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: /Check automatic flags/i }));
    await userEvent.click(await screen.findByLabelText(/I acknowledge/i));
    await userEvent.selectOptions(screen.getByLabelText(/^Participant$/i), secondRegistration.registrationId);

    expect((screen.getByLabelText(/Cataract risk/i) as HTMLSelectElement).value).toBe('NOT_ASSESSED');
    expect((screen.getByLabelText(/Glaucoma risk/i) as HTMLSelectElement).value).toBe('NOT_ASSESSED');
    expect((screen.getByLabelText(/Symptoms noted/i) as HTMLInputElement).checked).toBe(false);
    expect(screen.queryByLabelText(/Symptom summary/i)).toBeNull();
    expect((screen.getByLabelText(/^Observations/i) as HTMLTextAreaElement).value).toBe('');
    expect((screen.getByLabelText(/Device findings/i) as HTMLTextAreaElement).value).toBe('');
    expect(screen.queryByText(/Clinical risk present/i)).toBeNull();
    expect(screen.queryByLabelText(/I acknowledge/i)).toBeNull();
    expect(screen.queryByText(/Saved with REFER flag/i)).toBeNull();
    expect((screen.getByRole('button', { name: /Save Eye Health result/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('ignores a late save response after the participant changes', async () => {
    previewEyeHealth.mockResolvedValue({
      overallFlag: 'REFER',
      isFlagged: true,
      flagSummary: 'Participant A flag',
      ruleVersion: 'VSMS-EH-1.0',
      reasons: [{ flag: 'REFER', reason: 'Participant A flag' }],
    });
    let resolveSave!: (value: {
      overallFlag: string;
      isFlagged: boolean;
      flagSummary: string;
      ruleVersion: string;
      queued: boolean;
    }) => void;
    saveEyeHealth.mockReturnValueOnce(new Promise((resolve) => { resolveSave = resolve; }));
    renderPage();
    await screen.findByRole('heading', { name: 'Eye Health' });
    await userEvent.type(screen.getByLabelText(/^Observations/i), 'Participant A observation.');
    await userEvent.click(screen.getByRole('button', { name: /Check automatic flags/i }));
    await userEvent.click(await screen.findByLabelText(/I acknowledge/i));
    await userEvent.click(screen.getByRole('button', { name: /Save flagged result/i }));
    await waitFor(() => expect(saveEyeHealth).toHaveBeenCalled());

    await userEvent.selectOptions(screen.getByLabelText(/^Participant$/i), secondRegistration.registrationId);
    expect(screen.queryByText(/Participant A flag/i)).toBeNull();
    expect(screen.queryByText(/Saving…/i)).toBeNull();

    await act(async () => resolveSave({
      overallFlag: 'REFER',
      isFlagged: true,
      flagSummary: 'Participant A flag',
      ruleVersion: 'VSMS-EH-1.0',
      queued: false,
    }));

    expect(saveEyeHealth.mock.calls[0][2].registrationId).toBe(registration.registrationId);
    expect(screen.queryByText(/Participant A flag/i)).toBeNull();
    expect(screen.queryByText(/Saved with REFER flag/i)).toBeNull();
    expect(loadStationContext).toHaveBeenCalledTimes(1);
  });
});
