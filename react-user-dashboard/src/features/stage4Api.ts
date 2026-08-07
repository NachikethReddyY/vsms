import apiClient from '../utils/apiClient';

export type Page<T> = { items?: T[]; data?: T[]; accounts?: T[]; jobs?: T[]; memberships?: T[]; users?: T[]; total?: number; page?: number; limit?: number; pageSize?: number; pendingCount?: number };
export type Duty = { id: string; stationType?: string; assignmentRole?: string; startsAt?: string; endsAt?: string; removedAt?: string | null };
export type MembershipRole = string | { role: string; assignedAt?: string };
export type Membership = { id: string; membershipId?: string; userId?: string; eventId: string; eventName?: string; status?: string; roles?: MembershipRole[]; duties?: Duty[]; removedAt?: string | null; event?: { id?: string; eventId?: string; eventName?: string; name?: string; status?: string } };
export type AccountProfile = { id: string; userId?: string; fullName?: string; email?: string; contactNumber?: string | null; phoneNumber?: string | null; professionalCategory?: 'STAFF' | 'DOCTOR' | null; approvalState?: string; accessState?: string; nextAction?: string | null; roles?: string[]; memberships?: Membership[]; eventMemberships?: Membership[]; securityControls?: Record<string, unknown>; lastLoginAt?: string | null };
export type AdminAccount = AccountProfile & { decisions?: unknown[]; providerOperations?: unknown[] };
export type MembershipRow = Membership & { user?: AccountProfile; account?: AccountProfile };
export type EventShift = { shiftId: string; id?: string; name?: string; startsAt?: string; endsAt?: string; status?: string; staffAssignments?: StaffAssignment[] };
export type EventStation = { eventStationId: string; name?: string; stationType?: string; isAvailable?: boolean; stationOrder?: number };
export type StaffAssignment = { staffAssignmentId?: string; id?: string; assignmentRole: string; status?: string; user: { userId: string; username?: string; fullName?: string }; eventStation?: EventStation | null };
export type EventDetail = { eventId: string; name?: string; version: number; status?: string; canManage?: boolean; shifts: EventShift[]; eventStations: EventStation[] };
export type AnalyticsTable = { id: string; title?: string; columns?: Array<{ key: string; label?: string; definition?: string } | string>; rows?: Array<Record<string, unknown>> };
export type EventAnalytics = { schemaVersion: number; aggregateOnly: true; generatedAt: string; event?: Record<string, unknown>; timeBasis?: Record<string, unknown>; appliedFilters?: Record<string, unknown>; metricDefinitions?: Array<Record<string, unknown>>; smallCellSuppression?: Record<string, unknown>; tables?: AnalyticsTable[]; observations?: string[]; dataCompleteness?: Record<string, unknown> };
export type CleanupStatus = { eventId: string; cleanupState: 'QUEUED' | 'COMPLETED' | 'NEEDS_ATTENTION'; tasks: Array<{ id: string; artifactType: string; status: string; attemptCount: number; lastError?: string | null; completedAt?: string | null }> };
export type ReportJob = { id?: string; jobId?: string; reportExportJobId?: string; status: string; dataset?: string; format?: string; createdAt?: string; requestedAt?: string; expiresAt?: string | null; sha256?: string | null; artifactSha256?: string | null; artifact?: { sha256?: string; expiresAt?: string | null; mimeType?: string; sizeBytes?: number }; error?: string | null; failureCode?: string | null };
export type DeletionPreview = { previewToken: string; previewExpiresAt?: string; blockers: string[]; version?: number; event?: { name?: string; version?: number }; impactDigest?: string; [key: string]: unknown };

const unwrap = <T>(value: T | { data: T }) => (value && typeof value === 'object' && 'data' in value ? (value as { data: T }).data : value as T);
export const jobId = (job: ReportJob) => job.jobId || job.reportExportJobId || job.id || '';

export async function getCurrentAccount() { return (await apiClient.get('/account')).data as { account?: AccountProfile } | AccountProfile; }
export async function updateCurrentAccount(payload: Pick<AccountProfile, 'fullName' | 'contactNumber' | 'professionalCategory'>) { return (await apiClient.patch('/account', payload)).data; }
function compactParams(params: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined && value !== null && (typeof value !== 'string' || value.trim() !== '')));
}
export async function listAdminAccounts(params: Record<string, unknown>) { const { q, pageSize, ...rest } = params; return (await apiClient.get('/admin/accounts', { params: compactParams({ ...rest, search: q || rest.search, limit: pageSize || rest.limit }) })).data as Page<AdminAccount>; }
export async function getAdminAccount(id: string) { return (await apiClient.get('/admin/accounts/' + id)).data as { account?: AdminAccount } | AdminAccount; }
export async function decideAccount(id: string, action: string, reason?: string) { const route = action === 'revoke-session' ? 'revoke-sessions' : action === 'resend-notification' ? 'resend-lifecycle' : action; const bodyNeeded = ['approve','reject','suspend','reactivate','deprovision'].includes(route); return (await apiClient.post('/admin/accounts/' + id + '/' + route, bodyNeeded ? { reason } : undefined)).data; }
export async function listMemberships(eventId: string) { return (await apiClient.get('/events/' + eventId + '/memberships')).data as Page<MembershipRow> | MembershipRow[]; }
export async function getEvent(eventId: string) { return (await apiClient.get('/events/' + eventId)).data as EventDetail; }
export async function assignShiftStaff(eventId: string, shiftId: string, payload: { version: number; userId: string; assignmentRole: string; eventStationId?: string | null }) { return (await apiClient.post('/events/' + eventId + '/shifts/' + shiftId + '/assignments', payload)).data as EventDetail; }
export async function removeShiftAssignment(eventId: string, shiftId: string, assignmentId: string, version: number) { return (await apiClient.delete('/events/' + eventId + '/shifts/' + shiftId + '/assignments/' + assignmentId, { params: { version } })).data as EventDetail; }
export async function listEligibleUsers(eventId: string, search?: string) { return (await apiClient.get('/events/' + eventId + '/memberships/eligible-users', { params: { search: search || undefined, limit: 100 } })).data as Page<AccountProfile>; }
export async function addMembership(eventId: string, userId: string, roles: string[]) { return (await apiClient.post('/events/' + eventId + '/memberships', { userId, roles })).data; }
export async function removeMembership(eventId: string, membershipId: string, reason: string) { return (await apiClient.delete('/events/' + eventId + '/memberships/' + membershipId, { data: { reason } })).data; }
export async function addMembershipRole(eventId: string, membershipId: string, role: string) { return (await apiClient.post('/events/' + eventId + '/memberships/' + membershipId + '/roles', { role })).data; }
export async function removeMembershipRole(eventId: string, membershipId: string, role: string) { return (await apiClient.delete('/events/' + eventId + '/memberships/' + membershipId + '/roles/' + role)).data; }
export async function getAnalytics(eventId: string, params: Record<string, string> = {}) { return (await apiClient.get('/events/' + eventId + '/analytics', { params })).data as EventAnalytics; }
export async function listReportJobs(eventId: string, status?: string) { return (await apiClient.get('/events/' + eventId + '/report-exports', { params: { status: status || undefined, limit: 25 } })).data as Page<ReportJob> | ReportJob[]; }
export async function createReportJob(eventId: string, dataset: string, format: 'PDF' | 'CSV') { return (await apiClient.post('/events/' + eventId + '/report-exports', { dataset, format, filters: {} })).data as ReportJob; }
export async function getReportJob(eventId: string, id: string) { return (await apiClient.get('/events/' + eventId + '/report-exports/' + id)).data as ReportJob; }
export async function downloadReportBlob(eventId: string, id: string) { const response = await apiClient.get('/events/' + eventId + '/report-exports/' + id + '/download', { responseType: 'blob' }); const blob = response.data as Blob; const contentType = (response.headers?.['content-type'] || blob.type || 'application/octet-stream') as string; const ext = contentType.includes('csv') ? 'csv' : contentType.includes('pdf') ? 'pdf' : 'bin'; const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `event-${eventId}-report-${id}.${ext}`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url); return response; }
export async function getDeletionPreview(eventId: string) { return (await apiClient.get('/events/' + eventId + '/deletion-preview')).data as DeletionPreview; }
export async function getDeletionCleanup(eventId: string) { return (await apiClient.get('/events/' + eventId + '/deletion-cleanup')).data as CleanupStatus; }
export async function deleteEventPermanently(eventId: string, payload: { version: number; confirmationName: string; acknowledgePermanentDeletion: true; previewToken: string }) { return (await apiClient.delete('/events/' + eventId, { data: payload })).data; }
export { unwrap };
