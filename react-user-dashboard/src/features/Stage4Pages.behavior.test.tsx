/* @vitest-environment jsdom */
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const calls: Array<{ name: string; args: unknown[] }> = [];
let authUser: Record<string, unknown> = { approvalState: 'APPROVED', accessState: 'ENABLED', roles: [], eventMemberships: [{ id: 'm1', eventId: 'event-1', status: 'ACTIVE', roles: [{ role: 'EVENT_MANAGER' }] }] };
let eventMode: 'ok' | '403' | '404' = 'ok';
let accountMode: 'ok' | 'fail' | 'empty' = 'ok';
let membershipRoles = [{ role: 'REGISTRATION' }];
let stationMode: 'allow' | 'deny' = 'allow';
const eventData = {
  eventId: 'event-1', name: 'Clinic Day', version: 3, canManage: false,
  shifts: [{ shiftId: 'shift-1', name: 'Morning', startsAt: '2026-08-07T08:00:00.000Z', endsAt: '2026-08-07T12:00:00.000Z', status: 'PLANNED', staffAssignments: [{ staffAssignmentId: 'duty-1', assignmentRole: 'SCREENER', user: { userId: 'user-1', fullName: 'Asha Rao' }, eventStation: { eventStationId: 'station-1', name: 'VA' } }] }],
  eventStations: [{ eventStationId: 'station-1', name: 'VA', stationOrder: 1, isAvailable: true }],
};

vi.mock('../auth/AuthProvider', () => ({ useAuth: () => ({ isAuthenticated: true, isBootstrapping: false, session: { user: authUser, expiresAt: Date.now() + 100000 }, clearSession: vi.fn() }) }));
vi.mock('../utils/logout', () => ({ logoutAndReturnHome: vi.fn() }));
vi.mock('../features/screening/screeningApi', () => ({ screeningApi: { listStations: vi.fn(async () => ({ event: { eventId: 'event-1', name: 'Clinic Day', status: 'ACTIVE', venue: 'Hall' }, stations: stationMode === 'allow' ? [{ stationId: 'station-1', eventId: 'event-1', stationName: 'VA', stationType: 'VISUAL_ACUITY', stationOrder: 1, isActive: true }, { stationId: 'station-eh', eventId: 'event-1', stationName: 'Eye Health', stationType: 'EYE_HEALTH', stationOrder: 4, isActive: true }] : [] })) } }));
vi.mock('./stage4Api', async () => {
  const actual = await vi.importActual<typeof import('./stage4Api')>('./stage4Api');
  return {
    ...actual,
    getCurrentAccount: vi.fn(async () => { if (accountMode === 'fail') throw new Error('profile failed'); if (accountMode === 'empty') return { account: { id: 'user-1', fullName: 'Asha Rao', approvalState: 'APPROVED', accessState: 'ENABLED', eventMemberships: [] } }; return { account: { id: 'user-1', fullName: 'Asha Rao', contactNumber: '+1', professionalCategory: 'DOCTOR', approvalState: 'APPROVED', accessState: 'ENABLED', eventMemberships: [{ id: 'm1', eventId: 'event-1', status: 'ACTIVE', roles: [{ role: 'EVENT_MANAGER' }], event: { name: 'Clinic Day' } }], securityControls: { mfa: true } } }; }),
    updateCurrentAccount: vi.fn(async (...args: unknown[]) => { calls.push({ name: 'updateCurrentAccount', args }); return {}; }),
    listAdminAccounts: vi.fn(async (params: unknown) => { calls.push({ name: 'listAdminAccounts', args: [params] }); return { items: [{ id: 'user-1', fullName: 'Asha Rao', email: 'asha@example.test', approvalState: 'PENDING', accessState: 'ENABLED' }], page: 1, limit: 25, total: 1, pendingCount: 1 }; }),
    getAdminAccount: vi.fn(async () => ({ account: { id: 'user-1', fullName: 'Asha Rao', email: 'asha@example.test', approvalState: 'PENDING', roles: ['REVIEWER'], decisions: [], providerOperations: [], memberships: [] } })),
    decideAccount: vi.fn(async (...args: unknown[]) => { calls.push({ name: 'decideAccount', args }); return {}; }),
    listMemberships: vi.fn(async () => ({ memberships: [{ id: 'member-1', userId: 'user-1', status: 'ACTIVE', roles: membershipRoles, account: { id: 'user-1', userId: 'user-1', fullName: 'Asha Rao' } }] })),
    listEligibleUsers: vi.fn(async () => ({ users: [{ id: 'user-2', fullName: 'Ben Tan', email: 'ben@example.test', eventMemberships: [] }] })),
    addMembership: vi.fn(async (...args: unknown[]) => { calls.push({ name: 'addMembership', args }); return {}; }),
    addMembershipRole: vi.fn(async (...args: unknown[]) => { calls.push({ name: 'addMembershipRole', args }); return {}; }),
    removeMembershipRole: vi.fn(async (...args: unknown[]) => { calls.push({ name: 'removeMembershipRole', args }); return {}; }),
    removeMembership: vi.fn(async (...args: unknown[]) => { calls.push({ name: 'removeMembership', args }); return {}; }),
    getEvent: vi.fn(async () => { if (eventMode === '403') throw new Error('403 forbidden'); if (eventMode === '404') throw new Error('404 not found'); return eventData; }),
    assignShiftStaff: vi.fn(async (...args: unknown[]) => { calls.push({ name: 'assignShiftStaff', args }); return eventData; }),
    removeShiftAssignment: vi.fn(async (...args: unknown[]) => { calls.push({ name: 'removeShiftAssignment', args }); return eventData; }),
    getAnalytics: vi.fn(async () => ({ schemaVersion: 1, aggregateOnly: true, generatedAt: '2026-08-07T00:00:00.000Z', timeBasis: { interval: 'event' }, appliedFilters: {}, smallCellSuppression: { rule: 'n<5' }, dataCompleteness: { registrations: 'complete' }, metricDefinitions: [{ id: 'checkedIn', definition: 'Checked-in attendees' }], tables: [{ id: 'ops', title: 'Operations', columns: [{ key: 'checkedIn', label: 'Checked in' }], rows: [{ checkedIn: 12 }] }], observations: ['Aggregate only'] })),
    listReportJobs: vi.fn(async () => ({ jobs: [{ jobId: 'job-1', status: 'COMPLETED', dataset: 'CLINICAL', format: 'CSV', artifact: { sha256: 'abc123' } }] })),
    createReportJob: vi.fn(async (...args: unknown[]) => { calls.push({ name: 'createReportJob', args }); return { jobId: 'job-2', status: 'QUEUED' }; }),
    getReportJob: vi.fn(async (...args: unknown[]) => { calls.push({ name: 'getReportJob', args }); return { jobId: 'job-2', status: 'COMPLETED' }; }),
    downloadReportBlob: vi.fn(async (...args: unknown[]) => { calls.push({ name: 'downloadReportBlob', args }); return {}; }),
    getDeletionPreview: vi.fn(async () => ({ previewToken: 'preview-token', blockers: [], version: 7, eventName: 'Clinic Day', counts: { participants: 2, registrations: 2 }, impactDigest: '2 artifacts' })),
    getDeletionCleanup: vi.fn(async (...args: unknown[]) => { calls.push({ name: 'getDeletionCleanup', args }); return { eventId: 'event-1', cleanupState: 'COMPLETED', tasks: [{ id: 't1', artifactType: 'REPORT', status: 'COMPLETED', attemptCount: 1, completedAt: '2026-08-07T00:00:00.000Z' }] }; }),
    deleteEventPermanently: vi.fn(async (...args: unknown[]) => { calls.push({ name: 'deleteEventPermanently', args }); return { cleanupState: 'QUEUED' }; }),
  };
});

const pages = await import('./Stage4Pages');
const { EventCapabilityGuard } = await import('../auth/RoleGuard');
const { ProtectedRoute } = await import('../auth/ProtectedRoute');

beforeEach(() => {
  calls.length = 0; eventMode = 'ok'; accountMode = 'ok'; membershipRoles = [{ role: 'REGISTRATION' }]; stationMode = 'allow'; authUser = { approvalState: 'APPROVED', accessState: 'ENABLED', roles: [], eventMemberships: [{ id: 'm1', eventId: 'event-1', status: 'ACTIVE', roles: [{ role: 'EVENT_MANAGER' }] }] }; vi.useRealTimers();
  HTMLDialogElement.prototype.showModal = function showModal() { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function close() { this.removeAttribute('open'); };
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

function renderRoute(path: string, element: React.ReactNode) { render(<MemoryRouter initialEntries={[path]}><Routes><Route path={path.replace('event-1', ':eventId')} element={element} /></Routes></MemoryRouter>); }

describe('Stage 4 rendered route behavior', () => {
  it('uses event membership guard outcomes for allow, 403, and 404 without operational global-role bypass', async () => {
    authUser = { approvalState: 'APPROVED', accessState: 'ENABLED', roles: ['ADMINISTRATOR'], eventMemberships: [] }; accountMode = 'fail';
    render(<MemoryRouter initialEntries={["/events/event-1/staff"]}><Routes><Route element={<EventCapabilityGuard allowedRoles={['ADMINISTRATOR','EVENT_MANAGER']} />}><Route path="/events/:eventId/staff" element={<p>Allowed staff</p>} /></Route><Route path="/forbidden" element={<p>Forbidden page</p>} /><Route path="/not-found" element={<p>Missing page</p>} /></Routes></MemoryRouter>);
    expect(await screen.findByText('Forbidden page')).toBeTruthy();
    cleanup();
    authUser = { approvalState: 'APPROVED', accessState: 'ENABLED', roles: [], eventMemberships: [{ id: 'm1', eventId: 'event-1', status: 'ACTIVE', roles: [{ role: 'EVENT_MANAGER' }] }] }; accountMode = 'fail'; eventMode = 'ok';
    render(<MemoryRouter initialEntries={["/events/event-1/staff"]}><Routes><Route element={<EventCapabilityGuard allowedRoles={['ADMINISTRATOR','EVENT_MANAGER']} />}><Route path="/events/:eventId/staff" element={<p>Allowed staff</p>} /></Route><Route path="/forbidden" element={<p>Forbidden page</p>} /><Route path="/not-found" element={<p>Missing page</p>} /></Routes></MemoryRouter>);
    expect(await screen.findByText('Allowed staff')).toBeTruthy();
    cleanup();
    eventMode = '404'; accountMode = 'fail'; authUser = { approvalState: 'APPROVED', accessState: 'ENABLED', roles: [], eventMemberships: [] };
    render(<MemoryRouter initialEntries={["/events/event-1/staff"]}><Routes><Route element={<EventCapabilityGuard allowedRoles={['ADMINISTRATOR','EVENT_MANAGER']} />}><Route path="/events/:eventId/staff" element={<p>Allowed staff</p>} /></Route><Route path="/forbidden" element={<p>Forbidden page</p>} /><Route path="/not-found" element={<p>Missing page</p>} /></Routes></MemoryRouter>);
    expect(await screen.findByText('Missing page')).toBeTruthy();
  });

  it('routes approved enabled accounts without active membership to unassigned state while profile remains reachable', async () => {
    authUser = { approvalState: 'APPROVED', accessState: 'ENABLED', roles: [], eventMemberships: [] };
    render(<MemoryRouter initialEntries={["/events"]}><Routes><Route element={<ProtectedRoute />}><Route path="/events" element={<p>Events</p>} /><Route path="/account/state" element={<pages.AccountStatePage />} /></Route></Routes></MemoryRouter>);
    expect(await screen.findByText(/No event assignment yet/i)).toBeTruthy();
    render(<MemoryRouter initialEntries={["/account/profile"]}><Routes><Route element={<ProtectedRoute />}><Route path="/account/profile" element={<pages.ProfilePage />} /></Route></Routes></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'Profile and access' })).toBeTruthy();
  });



  it('does not treat absent public session memberships as confirmed unassigned until profile resolves', async () => {
    delete authUser.eventMemberships; delete authUser.memberships; accountMode = 'ok';
    render(<MemoryRouter initialEntries={["/events"]}><Routes><Route element={<ProtectedRoute />}><Route path="/events" element={<p>Events</p>} /><Route path="/account/state" element={<pages.AccountStatePage />} /></Route></Routes></MemoryRouter>);
    expect(await screen.findByText('Events')).toBeTruthy();
    cleanup();
    delete authUser.eventMemberships; delete authUser.memberships; accountMode = 'empty';
    render(<MemoryRouter initialEntries={["/events"]}><Routes><Route element={<ProtectedRoute />}><Route path="/events" element={<p>Events</p>} /><Route path="/account/state" element={<pages.AccountStatePage />} /></Route></Routes></MemoryRouter>);
    expect(await screen.findByText(/No event assignment yet/i)).toBeTruthy();
  });

  it('requires current station duty instead of membership-only station access', async () => {
    const { StationDutyGuard } = await import('../auth/RoleGuard');
    stationMode = 'deny';
    render(<MemoryRouter initialEntries={["/events/event-1/stations/visual-acuity"]}><Routes><Route element={<StationDutyGuard stationType="VISUAL_ACUITY" />}><Route path="/events/:eventId/stations/visual-acuity" element={<p>VA station</p>} /></Route><Route path="/forbidden" element={<p>Forbidden page</p>} /></Routes></MemoryRouter>);
    expect(await screen.findByText('Forbidden page')).toBeTruthy();
    cleanup(); stationMode = 'allow';
    render(<MemoryRouter initialEntries={["/events/event-1/stations/visual-acuity"]}><Routes><Route element={<StationDutyGuard stationType="VISUAL_ACUITY" />}><Route path="/events/:eventId/stations/visual-acuity" element={<p>VA station</p>} /></Route><Route path="/forbidden" element={<p>Forbidden page</p>} /></Routes></MemoryRouter>);
    expect(await screen.findByText('VA station')).toBeTruthy();
  });

  it('protects eye-health with the current station duty', async () => {
    const { Route, Routes } = await import('react-router-dom');
    const { StationDutyGuard } = await import('../auth/RoleGuard');
    render(
      <MemoryRouter initialEntries={['/events/event-1/stations/eye-health']}>
        <Routes>
          <Route element={<StationDutyGuard stationType="EYE_HEALTH" />}>
            <Route path="/events/:eventId/stations/eye-health" element={<p>Eye health station</p>} />
          </Route>
          <Route path="/forbidden" element={<p>Forbidden page</p>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText('Eye health station')).toBeTruthy();
  });

  it('renders profile eventMemberships exact field and profile failure', async () => {
    renderRoute('/account/profile', <pages.ProfilePage />);
    expect(await screen.findByText('Clinic Day')).toBeTruthy();
    accountMode = 'fail'; renderRoute('/account/profile', <pages.ProfilePage />);
    expect(await screen.findByText(/Could not load data/i)).toBeTruthy();
  });

  it('covers admin filters, required reasons, pagination metadata, keyboard selection, and errors', async () => {
    const user = userEvent.setup(); vi.spyOn(window, 'prompt').mockReturnValue('Not eligible');
    render(<MemoryRouter initialEntries={["/staff?page=2&search=&approvalState=&accessState=ENABLED"]}><Routes><Route path="/staff" element={<pages.AdminAccountsPage />} /></Routes></MemoryRouter>);
    expect(await screen.findByText('1 pending')).toBeTruthy();
    expect(calls.find(c => c.name === 'listAdminAccounts')?.args[0]).toEqual({ page: '2', search: '', approvalState: '', accessState: 'ENABLED' });
    await user.click(screen.getByRole('button', { name: /apply filters/i }));
    await waitFor(() => { const adminCalls = calls.filter(c => c.name === 'listAdminAccounts'); expect(adminCalls[adminCalls.length - 1]?.args[0]).toEqual({ accessState: 'ENABLED' }); });
    const accountButton = screen.getByRole('button', { name: 'Asha Rao' });
    accountButton.focus();
    expect(document.activeElement).toBe(accountButton);
    await user.keyboard('{Enter}');
    await user.click(await screen.findByRole('button', { name: 'Approve and synchronize roles' }));
    expect(calls.some(c => c.name === 'decideAccount' && c.args[1] === 'approve' && c.args[2] === undefined && JSON.stringify(c.args[3]) === JSON.stringify(['REVIEWER']))).toBe(true);
    await user.click(await screen.findByRole('button', { name: 'Reject' }));
    expect(calls.find(c => c.name === 'decideAccount' && c.args[1] === 'reject')?.args).toEqual(['user-1', 'reject', 'Not eligible', undefined]);
  });

  it('creates, polls, and downloads reports', async () => {
    const user = userEvent.setup(); vi.spyOn(window, 'setInterval').mockImplementation(((cb: TimerHandler) => { void (cb as () => void)(); return 1; }) as typeof window.setInterval);
    renderRoute('/events/event-1/reports', <pages.EventReportsPage />);
    expect(await screen.findByText('abc123')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /download/i }));
    await user.click(screen.getByRole('button', { name: /create csv/i }));
    await waitFor(() => expect(calls.some(c => c.name === 'getReportJob')).toBe(true));
    expect(calls.some(c => c.name === 'downloadReportBlob')).toBe(true);
  });

  it('submits deletion preview payload and polls cleanup', async () => {
    const user = userEvent.setup(); vi.spyOn(window, 'setInterval').mockImplementation(((cb: TimerHandler) => { void (cb as () => void)(); return 1; }) as typeof window.setInterval);
    renderRoute('/events/event-1/delete', <pages.EventDeletionPage />);
    await user.type(await screen.findByLabelText(/exact event name/i), 'Clinic Day');
    await user.click(screen.getByLabelText(/permanent/i));
    await user.click(screen.getByRole('button', { name: /delete permanently/i }));
    await waitFor(() => expect(calls.some(c => c.name === 'getDeletionCleanup')).toBe(true));
    expect(calls.find(c => c.name === 'deleteEventPermanently')?.args[1]).toEqual({ previewToken: 'preview-token', version: 7, confirmationName: 'Clinic Day', acknowledgePermanentDeletion: true });
  });

  it('assigns approved people and event-specific roles without changing account types', async () => {
    const user = userEvent.setup();
    renderRoute('/events/event-1/staff', <pages.EventStaffingPage />);
    await user.click(await screen.findByRole('button', { name: /add staff/i }));
    await user.click(screen.getByLabelText(/ben tan/i));
    await user.click(screen.getByLabelText(/screener/i));
    await user.click(screen.getByRole('button', { name: /add to event/i }));
    await waitFor(() => expect(calls.some(c => c.name === 'addMembership')).toBe(true));
    expect(calls.find(c => c.name === 'addMembership')?.args).toEqual(['event-1', 'user-2', ['REGISTRATION', 'SCREENER']]);
  });

  it('edits roles on an existing event assignment', async () => {
    const user = userEvent.setup();
    renderRoute('/events/event-1/staff', <pages.EventStaffingPage />);
    await user.selectOptions(await screen.findByLabelText(/add another role/i), 'SUPPORT');
    await waitFor(() => expect(calls.some(c => c.name === 'addMembershipRole')).toBe(true));
    expect(calls.find(c => c.name === 'addMembershipRole')?.args).toEqual(['event-1', 'member-1', 'SUPPORT']);
  });

  it('renders analytics as structured accessible tables with chart parity', async () => {
    renderRoute('/events/event-1/analytics', <pages.EventAnalyticsPage />);
    expect(await screen.findByRole('table', { name: /chart data table parity/i })).toBeTruthy();
    expect(screen.getByRole('table', { name: /operations contract table/i })).toBeTruthy();
    expect(screen.getByText('Small-cell suppression')).toBeTruthy();
    expect(screen.getByText('Checked-in attendees')).toBeTruthy();
  });
});
