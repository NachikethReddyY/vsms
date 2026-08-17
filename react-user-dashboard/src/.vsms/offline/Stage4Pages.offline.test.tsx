/* @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAnalytics: vi.fn(),
  listReportJobs: vi.fn(),
  createReportJob: vi.fn(),
  getReportJob: vi.fn(),
  downloadReportBlob: vi.fn(),
  getOfflineEvent: vi.fn(),
  operations: vi.fn(),
}));

vi.mock('../../auth/AuthProvider', () => ({
  useAuth: () => ({ session: { user: { id: 'staff-1' } } }),
}));

vi.mock('../../utils/logout', () => ({ logoutAndReturnHome: vi.fn() }));

vi.mock('../../features/stage4Api', () => ({
  getAnalytics: mocks.getAnalytics,
  listReportJobs: mocks.listReportJobs,
  createReportJob: mocks.createReportJob,
  getReportJob: mocks.getReportJob,
  downloadReportBlob: mocks.downloadReportBlob,
  jobId: (job: { jobId?: string; id?: string }) => job.jobId || job.id || '',
}));

vi.mock('../../features/screening/offlineSync', () => ({
  getOfflineEvent: mocks.getOfflineEvent,
}));

vi.mock('../../features/reports/reportApi', () => ({
  reportApi: { operations: mocks.operations },
}));

import { EventAnalyticsPage, EventReportsPage } from '../../features/Stage4Pages';

const localReport = {
  filters: { eventId: 'event-1', from: '2026-08-17', to: '2026-08-17' },
  summary: {
    events: 1,
    registrations: { total: 18, checkedIn: 12, completed: 0, completionRate: 0 },
    queue: { waiting: 4, active: 2, completed: 6 },
    referrals: { total: 0, actionRequired: 0, sentOrAcknowledged: 0 },
    deliveries: { inFlight: 0, delivered: 0, issues: 0 },
    sync: { total: 4, pending: 3, applied: 0, issues: 1 },
  },
  events: [],
  eventOptions: [],
  truncated: false,
  eventOptionsTruncated: false,
  scope: 'DEVICE_LOCAL',
};

function setOnline(online: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: online });
}

function renderRoute(path: string, element: React.ReactNode) {
  render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/events/:eventId/:section" element={element} /></Routes></MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
  setOnline(false);
  mocks.getOfflineEvent.mockResolvedValue({
    eventId: 'event-1',
    name: 'Clinic Day',
    startsAt: '2026-08-17T08:00:00.000Z',
    endsAt: '2026-08-17T16:00:00.000Z',
  });
  mocks.operations.mockResolvedValue(localReport);
});

afterEach(() => cleanup());

describe('Stage 4 offline event routes', () => {
  it('renders analytics as a labeled device-local provisional operational snapshot', async () => {
    renderRoute('/events/event-1/analytics', <EventAnalyticsPage />);

    expect(await screen.findByRole('heading', { name: 'Device-local provisional operational snapshot' })).toBeTruthy();
    expect(screen.getByText(/Offline · provisional device-local view/i)).toBeTruthy();
    expect(screen.getByRole('table', { name: 'Provisional operational totals stored on this device' })).toBeTruthy();
    expect(screen.getByText('18')).toBeTruthy();
    expect(screen.getByText('Unsynced local changes')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(mocks.getAnalytics).not.toHaveBeenCalled();
    expect(mocks.operations).toHaveBeenCalledWith({ eventId: 'event-1', from: '2026-08-17', to: '2026-08-17' });
  });

  it('keeps cloud export creation and download unavailable while showing the local summary', async () => {
    const user = userEvent.setup();
    renderRoute('/events/event-1/reports', <EventReportsPage />);

    expect(await screen.findByText(/Cloud exports are online-only/i)).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Device-local provisional operational snapshot' })).toBeTruthy();
    expect(screen.getByText('Cloud export history is unavailable offline.')).toBeTruthy();
    const pdfButton = screen.getByRole('button', { name: 'Create PDF' });
    const csvButton = screen.getByRole('button', { name: 'Create CSV' });
    expect(pdfButton).toHaveProperty('disabled', true);
    expect(csvButton).toHaveProperty('disabled', true);
    await user.click(csvButton);
    expect(mocks.listReportJobs).not.toHaveBeenCalled();
    expect(mocks.createReportJob).not.toHaveBeenCalled();
    expect(mocks.downloadReportBlob).not.toHaveBeenCalled();
  });

  it('retains the existing cloud report path when online', async () => {
    setOnline(true);
    mocks.listReportJobs.mockResolvedValue({ jobs: [{ jobId: 'job-1', status: 'COMPLETED', dataset: 'OPERATIONS', format: 'CSV', artifact: { sha256: 'abc123' } }] });
    renderRoute('/events/event-1/reports', <EventReportsPage />);

    const download = await screen.findByRole('button', { name: 'Download' });
    expect(download).toHaveProperty('disabled', false);
    expect(screen.queryByText(/Cloud exports are online-only/i)).toBeNull();
    expect(mocks.listReportJobs).toHaveBeenCalledWith('event-1');
    expect(mocks.operations).not.toHaveBeenCalled();
    await userEvent.click(download);
    await waitFor(() => expect(mocks.downloadReportBlob).toHaveBeenCalledWith('event-1', 'job-1'));
  });
});
