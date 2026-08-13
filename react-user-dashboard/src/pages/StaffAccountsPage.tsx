import { ArrowPathIcon, EyeIcon, PencilSquareIcon, PlusIcon, TrashIcon, UserGroupIcon } from '@heroicons/react/24/outline';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { AppDialog } from '../components/AppDialog';
import { appDialog } from '../components/appDialogStyles';
import { AppToast } from '../components/AppToast';
import type { AppUser } from '../types';
import apiClient, { getApiError } from '../utils/apiClient';
import './StaffAccountsPage.css';

export const ROLE_OPTIONS = [
  { value: 'ADMINISTRATOR', label: 'Administrator', description: 'Manage organisation accounts and all administrative controls.' },
  { value: 'EVENT_MANAGER', label: 'Event manager', description: 'Manage events they create or are assigned to.' },
  { value: 'REVIEWER', label: 'Doctor', description: 'Clinical professional who can be assigned reviewer duties for specific events.' },
  { value: 'SUPPORT', label: 'Staff', description: 'Receives registration, screening, or support duties separately for each event.' },
] as const;

type ApplicationRole = typeof ROLE_OPTIONS[number]['value'];
type StaffDraft = {
  fullName: string;
  email: string;
  department: string;
  designation: string;
  status: 'ACTIVE' | 'INACTIVE';
  role: ApplicationRole;
};

const emptyDraft = (): StaffDraft => ({
  fullName: '', email: '', department: '', designation: '', status: 'INACTIVE', role: 'SUPPORT',
});

const labelRole = (role: string) => ROLE_OPTIONS.find((item) => item.value === role)?.label ?? role.replace(/_/g, ' ');
const initial = (name: string) => name.trim().split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase() || '?';
const accountTypeFor = (member: AppUser): ApplicationRole => member.professionalCategory === 'DOCTOR'
  ? 'REVIEWER'
  : ROLE_OPTIONS.find((option) => member.roles.includes(option.value))?.value ?? 'SUPPORT';

function toDraft(member: AppUser): StaffDraft {
  return {
    fullName: member.fullName,
    email: member.email,
    department: member.department ?? '',
    designation: member.designation ?? '',
    status: member.status === 'ACTIVE' ? 'ACTIVE' : 'INACTIVE',
    role: accountTypeFor(member),
  };
}

function sortStaff(staff: AppUser[]) {
  return [...staff].sort((left, right) => left.fullName.localeCompare(right.fullName, undefined, { sensitivity: 'base' }));
}

export default function StaffAccountsPage() {
  const [staff, setStaff] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [roleGuideOpen, setRoleGuideOpen] = useState(false);
  const [editing, setEditing] = useState<AppUser | null>(null);
  const [draft, setDraft] = useState<StaffDraft>(emptyDraft);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [reactivatingId, setReactivatingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');
  const [search, setSearch] = useState('');
  const [approvalFilter, setApprovalFilter] = useState('');
  const [accessFilter, setAccessFilter] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await apiClient.get<{ items?: AppUser[]; data?: AppUser[] }>('/admin/accounts', { params: { limit: 100 } });
      setStaff(sortStaff(data.items ?? data.data ?? []));
    } catch (cause) {
      setError(getApiError(cause, 'Staff accounts could not be loaded.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const openCreate = () => {
    setEditing(null);
    setDraft(emptyDraft());
    setFormError('');
    setDialogOpen(true);
  };
  const openEdit = (member: AppUser) => {
    setEditing(member);
    setDraft(toDraft(member));
    setFormError('');
    setDialogOpen(true);
  };
  const closeDialog = (open: boolean) => {
    if (open || saving) return;
    setDialogOpen(false);
    setFormError('');
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setFormError('');
    const accountTypeChanged = !editing || accountTypeFor(editing) !== draft.role;
    const payload = {
      fullName: draft.fullName.trim(),
      ...(editing ? {} : { email: draft.email.trim() }),
      department: draft.department.trim() || null,
      designation: draft.designation.trim() || null,
      ...(!editing ? { status: draft.status } : {}),
      ...(accountTypeChanged ? {
        roles: [draft.role],
        professionalCategory: draft.role === 'REVIEWER' ? 'DOCTOR' : 'STAFF',
      } : {}),
    };
    try {
      editing
        ? await apiClient.patch<{ success: true; data: AppUser }>(`/users/${editing.id}`, payload)
        : await apiClient.post<{ success: true; data: AppUser }>('/users', payload);
      await load();
      setDialogOpen(false);
      setNotice(editing ? 'Staff account updated.' : 'Staff account created.');
    } catch (cause) {
      setFormError(getApiError(cause, 'Staff account could not be saved.'));
    } finally {
      setSaving(false);
    }
  };
  const reactivate = async (member: AppUser) => {
    setReactivatingId(member.id);
    setActionError('');
    try {
      const response = await apiClient.post(`/admin/accounts/${member.id}/reactivate`, {});
      await load();
      setNotice(response.status === 202 ? 'Account reactivated. Identity-provider synchronization is pending.' : 'Account reactivated.');
    } catch (cause) {
      setActionError(getApiError(cause, `${member.fullName}'s account could not be reactivated.`));
    } finally {
      setReactivatingId(null);
    }
  };
  const deleteAccount = async () => {
    if (!editing || !window.confirm(`Delete ${editing.fullName}'s staff account? They will immediately lose access and disappear from the staff directory.`)) return;
    setSaving(true);
    setFormError('');
    try {
      await apiClient.post(`/admin/accounts/${editing.id}/deprovision`, { reason: 'Deleted from the staff directory by an administrator' });
      await load();
      setDialogOpen(false);
      setNotice('Staff account deleted and access revoked.');
    } catch (cause) {
      setFormError(getApiError(cause, 'Staff account could not be deleted.'));
    } finally {
      setSaving(false);
    }
  };
  const restore = async (member: AppUser) => {
    setReactivatingId(member.id);
    setActionError('');
    try {
      await apiClient.post(`/admin/accounts/${member.id}/reactivate`, {});
      await load();
      setNotice('Staff account restored.');
    } catch (cause) {
      setActionError(getApiError(cause, `${member.fullName}'s account could not be restored.`));
    } finally {
      setReactivatingId(null);
    }
  };
  const activeCount = staff.filter((member) => member.status === 'ACTIVE').length;
  const visibleStaff = staff.filter((member) => {
    const query = search.trim().toLowerCase();
    return (!query || `${member.fullName} ${member.email} ${member.department ?? ''} ${member.designation ?? ''}`.toLowerCase().includes(query))
      && (!approvalFilter || member.approvalState === approvalFilter)
      && (!accessFilter || member.accessState === accessFilter);
  });

  return <div className="page-frame staff-accounts-page">
    <header className="staff-accounts-header">
      <div>
        <h1>Staff accounts</h1>
        <p>Manage the people and application roles in this organisation.</p>
      </div>
      <div className="staff-accounts-actions">
        <span className="staff-count"><UserGroupIcon aria-hidden="true" />{activeCount} active / {staff.length} total</span>
        <button className="secondary compact staff-icon-button" type="button" onClick={() => setRoleGuideOpen(true)} aria-haspopup="dialog" aria-label="View role access" title="View role access"><EyeIcon aria-hidden="true" /></button>
        <button className="secondary compact staff-icon-button" type="button" disabled={loading} onClick={() => void load()} aria-label="Refresh list" title="Refresh list"><ArrowPathIcon className={loading ? 'is-spinning' : ''} aria-hidden="true" /></button>
        <button className="primary" type="button" onClick={openCreate}><PlusIcon aria-hidden="true" />Add staff member</button>
      </div>
    </header>

    {error && <div className="alert error" role="alert"><span>{error}</span><button className="secondary compact" type="button" onClick={() => void load()}>Try again</button></div>}
    {actionError && <div className="alert error" role="alert"><span>{actionError}</span></div>}

    <form className="staff-account-filters" onSubmit={(event) => event.preventDefault()}>
      <label><span>Search</span><input type="search" value={search} placeholder="Name, email, team or designation" onChange={(event) => setSearch(event.target.value)} /></label>
      <label><span>Approval</span><select value={approvalFilter} onChange={(event) => setApprovalFilter(event.target.value)}><option value="">Any</option><option value="PENDING">Pending</option><option value="APPROVED">Approved</option><option value="REJECTED">Rejected</option></select></label>
      <label><span>Access</span><select value={accessFilter} onChange={(event) => setAccessFilter(event.target.value)}><option value="">Any</option><option value="ENABLED">Enabled</option><option value="SUSPENDED">Suspended</option><option value="DISABLED">Disabled</option></select></label>
      {(search || approvalFilter || accessFilter) && <button className="secondary compact" type="button" onClick={() => { setSearch(''); setApprovalFilter(''); setAccessFilter(''); }}>Clear filters</button>}
    </form>

    <section className="staff-directory" aria-label="Organisation staff accounts">
      {loading ? <div className="staff-loading" aria-live="polite" aria-label="Loading staff accounts"><span /><span /><span /><span /></div> : visibleStaff.length ? <div className="staff-table-shell">
          <table className="staff-table">
            <thead><tr><th scope="col">Person</th><th scope="col">Team</th><th scope="col">Role</th><th scope="col">Approval</th><th scope="col">Access</th><th scope="col">Last login</th><th scope="col"><span className="visually-hidden">Actions</span></th></tr></thead>
            <tbody>{visibleStaff.map((member) => {
              const canReactivate = member.approvalState === 'APPROVED'
                && member.accessState !== 'DISABLED'
                && (member.status === 'INACTIVE' || member.status === 'SUSPENDED');
              return <tr key={member.id}>
              <th scope="row"><div className="staff-person"><span className="staff-account-avatar" aria-hidden="true">{initial(member.fullName)}</span><span><strong>{member.fullName}</strong><small>{member.email}</small></span></div></th>
              <td><span className="staff-team">{member.designation || 'No designation'}<small>{member.department || 'No department'}</small></span></td>
              <td><div className="staff-role-list"><span className="staff-role-chip">{member.professionalCategory === 'DOCTOR' ? 'Doctor' : labelRole(ROLE_OPTIONS.find((option) => member.roles.includes(option.value))?.value ?? 'SUPPORT')}</span></div></td>
              <td><span className={`staff-state ${member.approvalState?.toLowerCase()}`}>{member.approvalState ?? 'Unknown'}</span></td>
              <td><span className={`staff-access ${member.accessState === 'ENABLED' ? 'active' : 'inactive'}`}><i aria-hidden="true" />{member.accessState === 'DISABLED' ? 'Disabled' : member.accessState === 'SUSPENDED' ? 'Suspended' : 'Enabled'}</span></td>
              <td><span className="staff-last-login">{member.lastLoginAt ? new Date(member.lastLoginAt).toLocaleString() : 'Not recorded'}</span></td>
              <td><div className="staff-row-actions">{member.accessState === 'DISABLED' ? <button className="secondary compact staff-reactivate-button" type="button" disabled={reactivatingId !== null} onClick={() => void restore(member)}><ArrowPathIcon aria-hidden="true" />{reactivatingId === member.id ? 'Restoring…' : 'Restore'}</button> : canReactivate && <button className="secondary compact staff-reactivate-button" type="button" disabled={reactivatingId !== null} onClick={() => void reactivate(member)}><ArrowPathIcon aria-hidden="true" />{reactivatingId === member.id ? 'Reactivating…' : 'Reactivate'}</button>}<button className="secondary compact staff-edit-button" type="button" disabled={reactivatingId === member.id || member.accessState === 'DISABLED'} onClick={() => openEdit(member)}><PencilSquareIcon aria-hidden="true" />Edit</button></div></td>
            </tr>;
            })}</tbody>
          </table>
      </div> : <div className="quiet-empty staff-empty"><UserGroupIcon aria-hidden="true" /><h2>{staff.length ? 'No staff match these filters' : 'No staff accounts yet'}</h2><p>{staff.length ? 'Clear or change the filters above.' : 'Add a staff member to set their access before their first sign-in.'}</p>{!staff.length && <button className="secondary compact" type="button" onClick={openCreate}>Add staff member</button>}</div>}
    </section>

    <AppDialog
      open={roleGuideOpen}
      onOpenChange={setRoleGuideOpen}
      title="Role access"
      description="Account types stay stable. Registration, screening, reviewer, and support responsibilities are assigned per event."
      className="staff-role-guide-dialog"
    >
      <dl className="staff-role-guide-list">{ROLE_OPTIONS.map((role) => <div key={role.value}><dt>{role.label}</dt><dd>{role.description}</dd></div>)}</dl>
    </AppDialog>

    <AppDialog
      open={dialogOpen}
      onOpenChange={closeDialog}
      title={editing ? `Edit ${editing.fullName}` : 'Add staff member'}
      description={editing ? 'Update this person’s profile and account type. Use the account actions in the staff list to change access.' : 'Create a staff profile and send an email invitation. An employee number is generated automatically.'}
      dismissible={!saving}
      className="staff-account-dialog"
    >
      <form className={`${appDialog.form} staff-account-form`} onSubmit={submit}>
        <div className="staff-account-fields">
        {formError && <p className={appDialog.error} role="alert">{formError}</p>}
        <label className={appDialog.field}><span>Full name</span><input required autoComplete="name" value={draft.fullName} onChange={(event) => setDraft((current) => ({ ...current, fullName: event.target.value }))} /></label>
        <label className={appDialog.field}><span>Work email</span><input required type="email" autoComplete="email" disabled={Boolean(editing)} value={draft.email} onChange={(event) => setDraft((current) => ({ ...current, email: event.target.value }))} />{editing && <small className={appDialog.help}>Email is managed by the sign-in provider and cannot be changed here.</small>}</label>
        <div className="staff-account-form-grid">
          <label className={appDialog.field}><span>Department <small>Optional</small></span><input maxLength={100} value={draft.department} onChange={(event) => setDraft((current) => ({ ...current, department: event.target.value }))} /></label>
          <label className={appDialog.field}><span>Designation <small>Optional</small></span><input maxLength={100} value={draft.designation} onChange={(event) => setDraft((current) => ({ ...current, designation: event.target.value }))} /></label>
        </div>
        {!editing && <fieldset className="staff-access-selector"><legend>Initial access</legend><div>
          <label><input type="radio" name="accessStatus" checked={draft.status === 'ACTIVE'} onChange={() => setDraft((current) => ({ ...current, status: 'ACTIVE' }))} /><span><strong>Active now</strong><small>Send the invitation and allow VSMS access immediately.</small></span></label>
          <label><input type="radio" name="accessStatus" checked={draft.status === 'INACTIVE'} onChange={() => setDraft((current) => ({ ...current, status: 'INACTIVE' }))} /><span><strong>Activate later</strong><small>Send the invitation, but block VSMS access until an administrator reactivates the account.</small></span></label>
        </div></fieldset>}
        <fieldset className="staff-role-selector"><legend>Account type</legend><p>Choose the person’s organization-wide account type. Event duties are assigned inside each event.</p><div>{ROLE_OPTIONS.map((role) => <label key={role.value}><input type="radio" name="accountType" checked={draft.role === role.value} onChange={() => setDraft((current) => ({ ...current, role: role.value }))} /><span><strong>{role.label}</strong><small>{role.description}</small></span></label>)}</div></fieldset>
        </div>
        <div className={appDialog.actions}>{editing && <button className="danger staff-delete-account" type="button" disabled={saving} onClick={() => void deleteAccount()}><TrashIcon aria-hidden="true" />Delete account</button>}<button className="secondary" type="button" disabled={saving} onClick={() => closeDialog(false)}>Cancel</button><button className="primary" type="submit" disabled={saving}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Create account'}</button></div>
      </form>
    </AppDialog>
    <AppToast message={notice} onDismiss={() => setNotice('')} />
  </div>;
}
