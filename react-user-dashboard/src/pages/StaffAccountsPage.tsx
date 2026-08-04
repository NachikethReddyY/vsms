import { ArrowPathIcon, PencilSquareIcon, PlusIcon, UserGroupIcon } from '@heroicons/react/24/outline';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { AppDialog } from '../components/AppDialog';
import { AppToast } from '../components/AppToast';
import type { AppUser } from '../types';
import apiClient, { getApiError } from '../utils/apiClient';
import './StaffAccountsPage.css';

const ROLE_OPTIONS = [
  { value: 'ADMINISTRATOR', label: 'Administrator', description: 'Manage organisation accounts and all administrative controls.' },
  { value: 'EVENT_MANAGER', label: 'Event manager', description: 'Manage events they create or are assigned to.' },
  { value: 'REGISTRATION_OFFICER', label: 'Registration officer', description: 'Register participants only during an assigned active shift.' },
  { value: 'SCREENER', label: 'Screener', description: 'Record screening results only at an assigned active station.' },
  { value: 'REVIEWER', label: 'Reviewer / doctor', description: 'Review clinical results only during an assigned active shift.' },
  { value: 'SUPPORT', label: 'Support', description: 'View assigned event and shift instructions only; no participant data or clinical work.' },
] as const;

type ApplicationRole = typeof ROLE_OPTIONS[number]['value'];
type StaffDraft = {
  fullName: string;
  email: string;
  employeeNumber: string;
  department: string;
  designation: string;
  status: 'ACTIVE' | 'INACTIVE';
  roles: ApplicationRole[];
};

const emptyDraft = (): StaffDraft => ({
  fullName: '', email: '', employeeNumber: '', department: '', designation: '', status: 'INACTIVE', roles: [],
});

const labelRole = (role: string) => ROLE_OPTIONS.find((item) => item.value === role)?.label ?? role.replace(/_/g, ' ');
const initial = (name: string) => name.trim().split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase() || '?';

function toDraft(member: AppUser): StaffDraft {
  return {
    fullName: member.fullName,
    email: member.email,
    employeeNumber: member.employeeNumber ?? '',
    department: member.department ?? '',
    designation: member.designation ?? '',
    status: member.status === 'ACTIVE' ? 'ACTIVE' : 'INACTIVE',
    roles: member.roles.filter((role): role is ApplicationRole => ROLE_OPTIONS.some((item) => item.value === role)),
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
  const [editing, setEditing] = useState<AppUser | null>(null);
  const [draft, setDraft] = useState<StaffDraft>(emptyDraft);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await apiClient.get<{ success: true; data: AppUser[] }>('/users');
      setStaff(sortStaff(data.data));
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
  const toggleRole = (role: ApplicationRole) => {
    setDraft((current) => ({
      ...current,
      roles: current.roles.includes(role) ? current.roles.filter((item) => item !== role) : [...current.roles, role],
    }));
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draft.roles.length) {
      setFormError('Choose at least one application role.');
      return;
    }
    setSaving(true);
    setFormError('');
    const payload = {
      fullName: draft.fullName,
      ...(editing ? {} : { email: draft.email }),
      employeeNumber: draft.employeeNumber,
      department: draft.department || null,
      designation: draft.designation || null,
      status: draft.status,
      roles: draft.roles,
    };
    try {
      const { data } = editing
        ? await apiClient.patch<{ success: true; data: AppUser }>(`/users/${editing.id}`, payload)
        : await apiClient.post<{ success: true; data: AppUser }>('/users', payload);
      setStaff((current) => sortStaff(editing ? current.map((member) => member.id === data.data.id ? data.data : member) : [...current, data.data]));
      setDialogOpen(false);
      setNotice(editing ? 'Staff account updated.' : 'Staff account created.');
    } catch (cause) {
      setFormError(getApiError(cause, 'Staff account could not be saved.'));
    } finally {
      setSaving(false);
    }
  };
  const activeCount = staff.filter((member) => member.status === 'ACTIVE').length;

  return <div className="page-frame staff-accounts-page">
    <header className="staff-accounts-header">
      <div>
        <h1>Staff accounts</h1>
        <p>Manage the people and application roles in this organisation.</p>
      </div>
      <div className="staff-accounts-actions">
        <span className="staff-count"><UserGroupIcon aria-hidden="true" />{activeCount} active / {staff.length} total</span>
        <button className="primary" type="button" onClick={openCreate}><PlusIcon aria-hidden="true" />Add staff member</button>
      </div>
    </header>

    {error && <div className="alert error" role="alert"><span>{error}</span><button className="secondary compact" type="button" onClick={() => void load()}>Try again</button></div>}

    <div className="staff-directory-layout">
      <section className="staff-directory" aria-label="Organisation staff accounts">
        {loading ? <div className="staff-loading" aria-live="polite" aria-label="Loading staff accounts"><span /><span /><span /><span /></div> : staff.length ? <div className="staff-table-shell">
          <table className="staff-table">
            <thead><tr><th scope="col">Person</th><th scope="col">Team</th><th scope="col">Application roles</th><th scope="col">Access</th><th scope="col"><span className="visually-hidden">Actions</span></th></tr></thead>
            <tbody>{staff.map((member) => <tr key={member.id}>
              <th scope="row"><div className="staff-person"><span className="staff-account-avatar" aria-hidden="true">{initial(member.fullName)}</span><span><strong>{member.fullName}</strong><small>{member.email}</small></span></div></th>
              <td><span className="staff-team">{member.designation || 'No designation'}<small>{member.department || 'No department'}</small></span></td>
              <td><div className="staff-role-list">{member.roles.length ? member.roles.map((role) => <span className="staff-role-chip" key={role}>{labelRole(role)}</span>) : <span className="staff-empty-role">No role assigned</span>}</div></td>
              <td><span className={`staff-access ${member.status === 'ACTIVE' ? 'active' : 'inactive'}`}><i aria-hidden="true" />{member.status === 'ACTIVE' ? 'Active' : 'Inactive'}</span></td>
              <td><button className="secondary compact staff-edit-button" type="button" onClick={() => openEdit(member)}><PencilSquareIcon aria-hidden="true" />Edit</button></td>
            </tr>)}</tbody>
          </table>
        </div> : <div className="quiet-empty staff-empty"><UserGroupIcon aria-hidden="true" /><h2>No staff accounts yet</h2><p>Add a staff member to set their access before their first sign-in.</p><button className="secondary compact" type="button" onClick={openCreate}>Add staff member</button></div>}
        {!loading && <button className="secondary compact staff-refresh" type="button" onClick={() => void load()}><ArrowPathIcon aria-hidden="true" />Refresh list</button>}
      </section>

      <aside className="staff-role-guide" aria-labelledby="staff-role-guide-title">
        <h2 id="staff-role-guide-title">Role access</h2>
        <dl>{ROLE_OPTIONS.map((role) => <div key={role.value}><dt>{role.label}</dt><dd>{role.description}</dd></div>)}</dl>
      </aside>
    </div>

    <AppDialog
      open={dialogOpen}
      onOpenChange={closeDialog}
      title={editing ? `Edit ${editing.fullName}` : 'Add staff member'}
      description={editing ? 'Change the local account profile, access state, and application roles.' : 'This prepares a local account. The colleague also needs the matching Cognito group before they can sign in.'}
      dismissible={!saving}
      className="staff-account-dialog"
    >
      <form className="app-dialog-form staff-account-form" onSubmit={submit} noValidate>
        {formError && <p className="app-dialog-error" role="alert">{formError}</p>}
        <label className="app-dialog-field"><span>Full name</span><input required autoComplete="name" value={draft.fullName} onChange={(event) => setDraft((current) => ({ ...current, fullName: event.target.value }))} /></label>
        <div className="staff-account-form-grid">
          <label className="app-dialog-field"><span>Email</span><input required type="email" autoComplete="email" disabled={Boolean(editing)} value={draft.email} onChange={(event) => setDraft((current) => ({ ...current, email: event.target.value }))} />{editing && <small className="app-dialog-help">Email is managed by Cognito and cannot be changed here.</small>}</label>
          <label className="app-dialog-field"><span>Employee number</span><input required maxLength={20} value={draft.employeeNumber} onChange={(event) => setDraft((current) => ({ ...current, employeeNumber: event.target.value }))} /></label>
          <label className="app-dialog-field"><span>Department <small>Optional</small></span><input maxLength={100} value={draft.department} onChange={(event) => setDraft((current) => ({ ...current, department: event.target.value }))} /></label>
          <label className="app-dialog-field"><span>Designation <small>Optional</small></span><input maxLength={100} value={draft.designation} onChange={(event) => setDraft((current) => ({ ...current, designation: event.target.value }))} /></label>
        </div>
        <label className="app-dialog-field"><span>Access status</span><select value={draft.status} onChange={(event) => setDraft((current) => ({ ...current, status: event.target.value as StaffDraft['status'] }))}><option value="ACTIVE">Active — can sign in when Cognito access matches</option><option value="INACTIVE">Inactive — sign-in blocked</option></select></label>
        <fieldset className="staff-role-selector"><legend>Application roles</legend><p>Select every role this person is approved to perform.</p><div>{ROLE_OPTIONS.map((role) => <label key={role.value}><input type="checkbox" checked={draft.roles.includes(role.value)} onChange={() => toggleRole(role.value)} /><span><strong>{role.label}</strong><small>{role.description}</small></span></label>)}</div></fieldset>
        <div className="app-dialog-actions"><button className="secondary" type="button" disabled={saving} onClick={() => closeDialog(false)}>Cancel</button><button className="primary" type="submit" disabled={saving}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Create account'}</button></div>
      </form>
    </AppDialog>
    <AppToast message={notice} onDismiss={() => setNotice('')} />
  </div>;
}
