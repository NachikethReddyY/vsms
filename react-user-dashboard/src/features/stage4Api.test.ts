import { describe, expect, it, vi, beforeEach } from 'vitest';

const calls: Array<{ method: string; url: string; data?: unknown; config?: { params?: Record<string, unknown>; data?: unknown } }> = [];

vi.mock('../utils/apiClient', () => ({
  default: {
    get: vi.fn(async (url: string, config?: { params?: Record<string, unknown>; responseType?: string }) => { calls.push({ method: 'get', url, config }); if (config?.responseType === 'blob') return { data: new Blob(['report'], { type: 'text/csv; charset=utf-8' }), headers: { 'content-type': 'text/csv; charset=utf-8' } }; return { data: { items: [], jobs: [], previewToken: 'x'.repeat(32), blockers: [] } }; }),
    post: vi.fn(async (url: string, data?: unknown) => { calls.push({ method: 'post', url, data }); return { data: { jobId: 'job-1', status: 'QUEUED', artifact: null } }; }),
    patch: vi.fn(async (url: string, data?: unknown) => { calls.push({ method: 'patch', url, data }); return { data: { account: data } }; }),
    delete: vi.fn(async (url: string, config?: { data?: unknown }) => { calls.push({ method: 'delete', url, config }); return { data: { ok: true } }; }),
  },
}));

const api = await import('./stage4Api');

beforeEach(() => { calls.length = 0; vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:report'), revokeObjectURL: vi.fn() }); vi.stubGlobal('document', { body: { appendChild: vi.fn() }, createElement: vi.fn(() => ({ click: vi.fn(), remove: vi.fn(), href: '', download: '' })) }); });

describe('Stage 4 API contract wrappers', () => {
  it('sends only strict account profile fields accepted by the backend schema', async () => {
    await api.updateCurrentAccount({ fullName: 'Asha Rao', contactNumber: '+1555123456', professionalCategory: 'DOCTOR' });
    expect(calls[0]).toMatchObject({ method: 'patch', url: '/account' });
    expect(calls[0].data).toEqual({ fullName: 'Asha Rao', contactNumber: '+1555123456', professionalCategory: 'DOCTOR' });
    expect(JSON.stringify(calls[0].data)).not.toMatch(/department|designation|phoneNumber/);
  });

  it('uses membership-first staffing endpoints and payload names', async () => {
    await api.listEligibleUsers('event-1', 'asha');
    await api.addMembership('event-1', 'user-1', ['REGISTRATION']);
    await api.removeMembership('event-1', 'membership-1', 'No longer staffing this event');
    expect(calls[0]).toMatchObject({ method: 'get', url: '/events/event-1/memberships/eligible-users', config: { params: { search: 'asha', limit: 100 } } });
    expect(calls[1]).toMatchObject({ method: 'post', url: '/events/event-1/memberships', data: { userId: 'user-1', roles: ['REGISTRATION'] } });
    expect(calls[2]).toMatchObject({ method: 'delete', url: '/events/event-1/memberships/membership-1', config: { data: { reason: 'No longer staffing this event' } } });
  });

  it('omits blank admin account filters while preserving partial filters and pagination', async () => {
    await api.listAdminAccounts({ search: '', approvalState: '', accessState: '', page: 2, limit: 25 });
    expect(calls[0]).toMatchObject({ method: 'get', url: '/admin/accounts', config: { params: { page: 2, limit: 25 } } });
    await api.listAdminAccounts({ search: 'asha', approvalState: '', accessState: 'ENABLED', page: 3, pageSize: 10 });
    expect(calls[1]).toMatchObject({ method: 'get', url: '/admin/accounts', config: { params: { search: 'asha', accessState: 'ENABLED', page: 3, limit: 10 } } });
  });

  it('maps admin action routes and required reason bodies exactly', async () => {
    await api.decideAccount('user-1', 'approve', undefined, ['REVIEWER']);
    await api.decideAccount('user-1', 'revoke-session');
    await api.decideAccount('user-1', 'resend-notification');
    await api.decideAccount('user-1', 'deprovision', 'Left the organization');
    expect(calls.map((c) => c.url)).toEqual([
      '/admin/accounts/user-1/approve',
      '/admin/accounts/user-1/revoke-sessions',
      '/admin/accounts/user-1/resend-lifecycle',
      '/admin/accounts/user-1/deprovision',
    ]);
    expect(calls[0].data).toEqual({ reason: undefined, roles: ['REVIEWER'] });
    expect(calls[1].data).toBeUndefined();
    expect(calls[3].data).toEqual({ reason: 'Left the organization' });
  });

  it('creates, polls, and downloads report exports using dataset envelopes and job ids', async () => {
    const job = await api.createReportJob('event-1', 'CLINICAL', 'CSV');
    await api.getReportJob('event-1', api.jobId(job));
    expect(calls[0]).toMatchObject({ method: 'post', url: '/events/event-1/report-exports', data: { dataset: 'CLINICAL', format: 'CSV', filters: {} } });
    expect(calls[1]).toMatchObject({ method: 'get', url: '/events/event-1/report-exports/job-1' });
    await api.downloadReportBlob('event-1', 'job-1');
    expect(calls[2]).toMatchObject({ method: 'get', url: '/events/event-1/report-exports/job-1/download', config: { responseType: 'blob' } });
  });

  it('deletes events with version, exact confirmationName, acknowledgement, and previewToken', async () => {
    await api.deleteEventPermanently('event-1', { version: 7, confirmationName: 'Clinic Day', acknowledgePermanentDeletion: true, previewToken: 'signed-preview-token'.repeat(3) });
    expect(calls[0]).toMatchObject({ method: 'delete', url: '/events/event-1', config: { data: { version: 7, confirmationName: 'Clinic Day', acknowledgePermanentDeletion: true, previewToken: 'signed-preview-token'.repeat(3) } } });
  });
});
