/* @vitest-environment jsdom */
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

let authUser: Record<string, unknown>;
const setupIdleTimerMock = vi.hoisted(() => vi.fn(() => vi.fn()));
const fullEvent = {
  eventId: 'event-1', name: 'Clinic Day', description: '', version: 7, canManage: true,
  status: 'COMPLETED', startsAt: '2026-08-07T08:00:00.000Z', endsAt: '2026-08-07T12:00:00.000Z', timezone: 'UTC', venue: 'Hall', address: '', postalCode: '', capacity: 100, expectedAttendance: 50, signupCount: 12, activeCapacityCount: 0, bannerKey: 'COMMUNITY_SCREENING', artworkDataUrl: '', cancellationReason: '',
  shifts: [], eventStations: [], eventDays: [],
};

vi.mock('./auth/AuthProvider', () => ({ useAuth: () => ({ isAuthenticated: true, isBootstrapping: false, session: { user: authUser, expiresAt: Date.now() + 100000 }, clearSession: vi.fn() }) }));
vi.mock('./utils/logout', () => ({ logoutAndReturnHome: vi.fn() }));
vi.mock('./utils/idleTimer', () => ({ setupIdleTimer: setupIdleTimerMock }));
vi.mock('./components/LandingPage', () => ({ default: () => <p>Landing</p> }));
vi.mock('./components/SettingsPage', () => ({ default: () => <p>Settings</p> }));
vi.mock('./components/EventsPage', () => ({ default: () => <p>Events page</p> }));
vi.mock('./components/qr/QRCodePage', () => ({ default: () => <p>QR page</p> }));
vi.mock('./features/events/EventFormPage', () => ({ default: ({ mode }: { mode: string }) => <p>{mode === 'create' ? 'Create event page' : 'Edit event page'}</p> }));
vi.mock('./features/events/PublicEventPage', () => ({ default: () => <p>Public event</p> }));
vi.mock('./features/reviews/ReviewWorkspacePage', () => ({ default: () => <p>Reviews page</p> }));
vi.mock('./features/reports/ReportsPage', () => ({ default: () => <p>Global reports page</p> }));
vi.mock('./features/operations/OperationsCenterPage', () => ({ default: () => <p>Operations center page</p> }));
vi.mock('./features/screening/ColourVisionStationPage', () => ({ default: () => <p>Colour vision station</p> }));
vi.mock('./features/screening/EyeHealthStationPage', () => ({ default: () => <p>Eye health station</p> }));
vi.mock('./features/screening/QRScannerPage', () => ({ default: () => <p>QR scanner</p> }));
vi.mock('./features/screening/RefractionStationPage', () => ({ default: () => <p>Refraction station</p> }));
vi.mock('./features/screening/VisualAcuityStationPage', () => ({ default: () => <p>Visual acuity station</p> }));
vi.mock('./features/screening/OfflineSyncControl', () => ({ OfflineSyncControl: () => <span>Offline sync</span> }));
vi.mock('./pages/AdminPages', () => ({ AuditLogsPage: () => <p>Audit logs</p> }));
vi.mock('./pages/StaffAccountsPage', () => ({
  default: () => <p>Staff directory</p>,
  ROLE_OPTIONS: [{ value: 'REVIEWER', label: 'Reviewer / doctor' }],
}));
vi.mock('./pages/StationLibraryPage', () => ({ default: () => <p>Station library</p> }));
vi.mock('./pages/AccountSecurityPage', () => ({ default: () => <p>Security</p> }));
vi.mock('./pages/QueuePages', () => ({ QueuePage: () => <p>Queue</p> }));
vi.mock('./pages/ParticipantStatusPage', () => ({ default: () => <p>Participant status</p> }));
vi.mock('./pages/ParticipantV2ConsentPage', () => ({ default: () => <p>V2 consent</p> }));
vi.mock('./pages/ParticipantV2Page', () => ({ default: () => <p>V2</p> }));
vi.mock('./pages/ParticipantV2ProfilePage', () => ({ default: () => <p>V2 profile</p> }));
vi.mock('./pages/ParticipantPages', () => ({
  ConsentPage: () => <p>Consent</p>, EmergencyContactsPage: () => <p>Emergency</p>, EventRegistrationStartPage: () => <p>Register</p>, EventRegistrationsPage: () => <p>Registrations</p>, ParticipantConsentsPage: () => <p>Consents</p>, ParticipantCreatePage: () => <p>Participant create</p>, ParticipantDetailPage: () => <p>Participant detail</p>, ParticipantEditPage: () => <p>Participant edit</p>, ParticipantHistoryPage: () => <p>History</p>, ParticipantSearchPage: () => <p>Participant search</p>, RegistrationConfirmationPage: () => <p>Confirmation</p>, RegistrationHistoryPage: () => <p>Reg history</p>, RegistrationQrPage: () => <p>Reg QR</p>, RegistrationReviewPage: () => <p>Reg review</p>,
}));
vi.mock('./auth/CognitoRoutes', () => ({ CognitoCallback: () => <p>Callback</p> }));
vi.mock('./features/stage4Api', async () => {
  const actual = await vi.importActual<typeof import('./features/stage4Api')>('./features/stage4Api');
  return { ...actual, getCurrentAccount: vi.fn(async () => ({ account: { id: 'user-1', approvalState: 'APPROVED', accessState: 'ENABLED', eventMemberships: [{ id: 'm1', eventId: 'event-1', status: 'ACTIVE', roles: [{ role: 'EVENT_MANAGER' }] }] } })), getEvent: vi.fn(async () => ({ eventId: 'event-1', canManage: true })), getAnalytics: vi.fn(async () => ({ schemaVersion: 1, aggregateOnly: true, generatedAt: '2026-08-07T00:00:00.000Z', timeBasis: { interval: 'event' }, appliedFilters: {}, smallCellSuppression: { rule: 'n<5' }, dataCompleteness: { registrations: 'complete' }, metricDefinitions: [], tables: [], observations: [] })), listReportJobs: vi.fn(async () => ({ jobs: [] })), getDeletionPreview: vi.fn(async () => ({ previewToken: 'preview-token', blockers: [], version: 7, eventName: 'Clinic Day', counts: { participants: 2, registrations: 2 }, impactDigest: '2 artifacts' })), getDeletionCleanup: vi.fn(async () => ({ eventId: 'event-1', cleanupState: 'COMPLETED', tasks: [] })) };
});
vi.mock('./features/events/eventApi', async () => {
  const actual = await vi.importActual<typeof import('./features/events/eventApi')>('./features/events/eventApi');
  return { ...actual, eventApi: { get: vi.fn(async () => fullEvent), audit: vi.fn(async () => ({ auditLogs: [] })), metrics: vi.fn(async () => ({ signupCount: 0, checkedInCount: 0, completedCount: 0, cancelledCount: 0, attendanceRatePercent: 0, activeCount: 0, capacity: 100, screeningResultCount: 0, flaggedResultCount: 0, referralCount: 0 })) } };
});

const App = (await import('./App')).default;

function renderPath(path: string) { render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>); }

beforeAll(() => { Element.prototype.scrollTo = vi.fn(); });
beforeEach(() => {
  setupIdleTimerMock.mockClear();
  authUser = { userId: 'user-1', systemRole: 'ADMIN', approvalState: 'APPROVED', accessState: 'ENABLED', roles: ['ADMINISTRATOR', 'EVENT_MANAGER'], eventMemberships: [] };
});
afterEach(() => cleanup());

describe('App route and navigation topology', () => {
  it('renders global operations, reports, and create-event routes without an eventId', async () => {
    renderPath('/operations');
    expect(await screen.findByText('Operations center page')).toBeTruthy();
    cleanup();
    renderPath('/reports');
    expect(await screen.findByText('Global reports page')).toBeTruthy();
    cleanup();
    renderPath('/events/new');
    expect(await screen.findByText('Create event page')).toBeTruthy();
  });

  it('blocks global event managers from create-event route and visible New event controls', async () => {
    authUser = { ...authUser, systemRole: 'EVENT_MANAGER', roles: ['EVENT_MANAGER'], eventMemberships: [{ id: 'm1', eventId: 'event-1', status: 'ACTIVE', roles: [{ role: 'EVENT_MANAGER' }] }] };
    renderPath('/events');
    expect(await screen.findByText('Events page')).toBeTruthy();
    expect(screen.queryByText('New event')).toBeNull();
    cleanup();
    renderPath('/events/new');
    expect(await screen.findByText('Access not available')).toBeTruthy();
    expect(screen.queryByText('Create event page')).toBeNull();
  });

  it('wraps the global events list in the authenticated idle-timer shell exactly once', async () => {
    renderPath('/events');
    expect(await screen.findByText('Events page')).toBeTruthy();
    expect(setupIdleTimerMock).toHaveBeenCalledTimes(1);
  });

  it('renders event analytics and reports routes behind event-scoped authorization', async () => {
    authUser.eventMemberships = [{ id: 'm1', eventId: 'event-1', status: 'ACTIVE', roles: [{ role: 'EVENT_MANAGER' }] }];
    renderPath('/events/event-1/analytics');
    expect(await screen.findByText('Completed-event analytics')).toBeTruthy();
    cleanup();
    renderPath('/events/event-1/reports');
    expect(await screen.findByText('Report exports')).toBeTruthy();
  });

  it('surfaces analytics, reports, and authorized deletion from event detail navigation', async () => {
    renderPath('/events/event-1');
    const eventTabs = await screen.findByRole('navigation', { name: 'Event sections' });
    expect(eventTabs.querySelector('a[href="/events/event-1/analytics"]')?.textContent).toBe('Analytics');
    expect(eventTabs.querySelector('a[href="/events/event-1/reports"]')?.textContent).toBe('Reports');
    expect(eventTabs.querySelector('a[href="/events/event-1/delete"]')?.textContent).toBe('Delete event');
  });

  it('renders admin deletion route for authorized administrators', async () => {
    renderPath('/events/event-1/delete');
    expect(await screen.findByRole('heading', { name: 'Delete event permanently' })).toBeTruthy();
  });

  it('consolidates staff invitations and lifecycle administration on /staff', async () => {
    renderPath('/staff');
    expect(await screen.findByText('Staff directory')).toBeTruthy();
    expect(await screen.findByText('Account administration')).toBeTruthy();
  });
});
