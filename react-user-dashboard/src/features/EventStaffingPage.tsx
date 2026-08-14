import { ArrowLeftIcon, ArrowPathIcon, MagnifyingGlassIcon, PlusIcon, UserGroupIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AppDialog } from '../components/AppDialog';
import { appDialog } from '../components/appDialogStyles';
import { getApiError } from '../utils/apiClient';
import * as api from './stage4Api';

const EVENT_ROLES = [
  { value: 'EVENT_MANAGER', label: 'Event manager' },
  { value: 'REGISTRATION', label: 'Registration' },
  { value: 'SCREENER', label: 'Screener' },
  { value: 'REVIEWER', label: 'Clinical reviewer (doctor only)' },
  { value: 'SUPPORT', label: 'Support' },
] as const;

const list = <T,>(value: api.Page<T> | T[] | null) => Array.isArray(value) ? value : value?.memberships ?? value?.users ?? value?.items ?? [];
const roleName = (role: api.MembershipRole) => typeof role === 'string' ? role : role.role;
const roleLabel = (value: string) => EVENT_ROLES.find((role) => role.value === value)?.label ?? value;

export default function EventStaffingPage() {
  const { eventId = '' } = useParams();
  const [members, setMembers] = useState<api.MembershipRow[]>([]);
  const [eligible, setEligible] = useState<api.AccountProfile[]>([]);
  const [search, setSearch] = useState('');
  const [teamSearch, setTeamSearch] = useState('');
  const [accountIds, setAccountIds] = useState<string[]>([]);
  const [roles, setRoles] = useState<string[]>(['REGISTRATION']);
  const [addOpen, setAddOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [canManage, setCanManage] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [membershipPage, event] = await Promise.all([api.listMemberships(eventId), api.getEvent(eventId)]);
      setMembers(list(membershipPage));
      setCanManage(Boolean(event.canManage));
      setEligible(event.canManage ? list(await api.listEligibleUsers(eventId)) : []);
    } catch (cause) {
      setError(getApiError(cause, 'Event team could not be loaded.'));
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => { void load(); }, [load]);

  const candidates = useMemo(() => {
    const query = search.trim().toLowerCase();
    return eligible.filter((person) => !query || `${person.fullName} ${person.email}`.toLowerCase().includes(query));
  }, [eligible, search]);
  const selectedPeople = eligible.filter((person) => accountIds.includes(person.userId ?? person.id));
  const canAssignRole = (role: string) => selectedPeople.length > 0
    && (role !== 'REVIEWER' || selectedPeople.every((person) => person.professionalCategory === 'DOCTOR'))
    && (role !== 'EVENT_MANAGER' || selectedPeople.every((person) => person.roles?.includes('EVENT_MANAGER')));

  const selectPeople = (ids: string[]) => {
    setAccountIds(ids);
    const people = eligible.filter((person) => ids.includes(person.userId ?? person.id));
    setRoles((current) => current.filter((role) => (role !== 'REVIEWER' || people.every((person) => person.professionalCategory === 'DOCTOR')) && (role !== 'EVENT_MANAGER' || people.every((person) => person.roles?.includes('EVENT_MANAGER')))));
  };

  const toggleRole = (role: string) => setRoles((current) => current.includes(role) ? current.filter((item) => item !== role) : [...current, role]);

  const searchEligible = async () => {
    setBusy('search');
    setError('');
    try { setEligible(list(await api.listEligibleUsers(eventId, search.trim()))); }
    catch (cause) { setError(getApiError(cause, 'Staff search could not be completed.')); }
    finally { setBusy(''); }
  };

  const assign = async (submitEvent: FormEvent<HTMLFormElement>) => {
    submitEvent.preventDefault();
    if (!accountIds.length || !roles.length) return;
    setBusy('assign');
    setError('');
    try {
      await Promise.all(accountIds.map((accountId) => api.addMembership(eventId, accountId, roles)));
      setAccountIds([]);
      setRoles(['REGISTRATION']);
      setSearch('');
      setAddOpen(false);
      setNotice(`${accountIds.length} ${accountIds.length === 1 ? 'person' : 'people'} assigned to this event.`);
      await load();
    } catch (cause) {
      setError(getApiError(cause, 'The event assignment could not be saved.'));
    } finally {
      setBusy('');
    }
  };

  const addRole = async (member: api.MembershipRow, role: string) => {
    const membershipId = member.membershipId ?? member.id;
    if (!membershipId || !role) return;
    setBusy(`${membershipId}:${role}`);
    try {
      await api.addMembershipRole(eventId, membershipId, role);
      await load();
    } catch (cause) {
      setError(getApiError(cause, 'The event role could not be added.'));
    } finally {
      setBusy('');
    }
  };

  const removeRole = async (member: api.MembershipRow, role: string) => {
    const membershipId = member.membershipId ?? member.id;
    if (!membershipId) return;
    setBusy(`${membershipId}:${role}`);
    try {
      await api.removeMembershipRole(eventId, membershipId, role);
      await load();
    } catch (cause) {
      setError(getApiError(cause, 'The event role could not be removed.'));
    } finally {
      setBusy('');
    }
  };

  const removePerson = async (member: api.MembershipRow) => {
    const membershipId = member.membershipId ?? member.id;
    if (!membershipId) return;
    setBusy(membershipId);
    try {
      await api.removeMembership(eventId, membershipId, 'Removed from the event team');
      setNotice('Person removed from this event.');
      await load();
    } catch (cause) {
      setError(getApiError(cause, 'The person could not be removed from this event.'));
    } finally {
      setBusy('');
    }
  };

  const activeMembers = members.filter((member) => member.status !== 'REMOVED' && !member.removedAt);
  const visibleMembers = activeMembers.filter((member) => {
    const query = teamSearch.trim().toLowerCase();
    const person = member.user ?? member.account;
    return !query || `${person?.fullName ?? ''} ${person?.email ?? ''} ${(member.roles ?? []).map(roleName).join(' ')}`.toLowerCase().includes(query);
  });

  return <div className="stage4-page event-staffing-page">
    <header className="event-staffing-header">
      <div><Link className="event-staffing-back" to={`/events/${eventId}`}><ArrowLeftIcon />Back to event</Link><h1>People and roles</h1><p>{canManage ? 'Find approved staff, assign their event roles, and manage the active team.' : 'View everyone assigned to this event and their roles.'}</p></div>
      <div className="stage4-actions"><button className="secondary event-staffing-refresh" type="button" aria-label="Refresh event team" title="Refresh event team" disabled={loading} onClick={() => void load()}><ArrowPathIcon className={loading ? 'is-spinning' : ''} /></button>{canManage && <button type="button" onClick={() => { setAccountIds([]); setRoles(['REGISTRATION']); setSearch(''); setAddOpen(true); }}><PlusIcon />Add staff</button>}</div>
    </header>

    {notice && <div className="stage4-alert good" role="status">{notice}</div>}
    {error && <div className="stage4-alert" role="alert">{error}</div>}

    <section className="event-team" aria-labelledby="event-team-title">
      <div className="event-team-heading"><div><h2 id="event-team-title">Event team</h2><p>{activeMembers.length} {activeMembers.length === 1 ? 'person' : 'people'} assigned</p></div>{activeMembers.length > 5 && <label className="event-team-search"><MagnifyingGlassIcon /><span className="visually-hidden">Search event team</span><input type="search" value={teamSearch} onChange={(event) => setTeamSearch(event.target.value)} placeholder="Search team" /></label>}</div>
      {loading && !members.length ? <p aria-live="polite">Loading event team…</p> : visibleMembers.length ? <div className="event-team-grid">{visibleMembers.map((member) => {
        const memberId = member.membershipId ?? member.id;
        const currentRoles = (member.roles ?? []).map(roleName);
        const person = member.user ?? member.account;
        const availableRoles = EVENT_ROLES.filter((role) => !currentRoles.includes(role.value) && (role.value !== 'REVIEWER' || person?.professionalCategory === 'DOCTOR') && (role.value !== 'EVENT_MANAGER' || person?.roles?.includes('EVENT_MANAGER')));
        return <article className="event-team-card" key={memberId}>
          <header><span className="event-team-avatar"><UserGroupIcon /></span><div><h3>{person?.fullName ?? member.userId}</h3><p>{person?.email ?? 'Approved account'}</p></div>{canManage && <button className="secondary event-team-remove" type="button" disabled={busy === memberId} onClick={() => void removePerson(member)}>Remove</button>}</header>
          <div className="event-team-roles">{currentRoles.map((role) => <span key={role}>{roleLabel(role)}{canManage && <button type="button" aria-label={`Remove ${roleLabel(role)} from ${person?.fullName ?? 'person'}`} disabled={Boolean(busy)} onClick={() => void removeRole(member, role)}><XMarkIcon /></button>}</span>)}</div>
          {canManage && availableRoles.length > 0 && <label className="event-team-add-role">Add another role<select defaultValue="" onChange={(event) => { const role = event.target.value; event.currentTarget.value = ''; void addRole(member, role); }}><option value="">Choose role</option>{availableRoles.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}</select></label>}
        </article>;
      })}</div> : <div className="quiet-empty"><UserGroupIcon /><h2>{activeMembers.length ? 'No team members match' : 'No one assigned yet'}</h2><p>{activeMembers.length ? 'Try a different name, email, or role.' : 'Use Add staff to build this event team.'}</p></div>}
    </section>

    <AppDialog open={addOpen} onOpenChange={setAddOpen} title="Add staff" description="Select approved, enabled accounts and assign the same roles to all of them." className="event-staffing-dialog" initialFocusRef={searchRef}>
      <form className="event-staffing-dialog-form" onSubmit={(event) => void assign(event)}>
        <div className="event-staffing-search">
          <label><span>Search staff</span><div><MagnifyingGlassIcon /><input ref={searchRef} type="search" value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void searchEligible(); } }} placeholder="Name or email" /><button className="secondary" type="button" disabled={busy === 'search'} onClick={() => void searchEligible()}>{busy === 'search' ? 'Searching…' : 'Search'}</button></div></label>
        </div>
        <fieldset className="event-person-picker"><legend>Choose people</legend>{candidates.length > 1 && <label className="event-person-select-all"><input type="checkbox" checked={candidates.every((person) => accountIds.includes(person.userId ?? person.id))} onChange={(event) => selectPeople(event.target.checked ? Array.from(new Set([...accountIds, ...candidates.map((person) => person.userId ?? person.id)])) : accountIds.filter((id) => !candidates.some((person) => (person.userId ?? person.id) === id)))} /><span>Select all {candidates.length}</span></label>}<div>{candidates.length ? candidates.map((person) => { const id = person.userId ?? person.id; return <label key={id}><input type="checkbox" value={id} checked={accountIds.includes(id)} onChange={(event) => selectPeople(event.target.checked ? [...accountIds, id] : accountIds.filter((item) => item !== id))} /><span><strong>{person.fullName}</strong><small>{person.email}</small></span><span className="event-person-badges">{person.roles?.includes('EVENT_MANAGER') && <span>Event manager</span>}{person.professionalCategory === 'DOCTOR' && <span>Doctor</span>}</span></label>; }) : <p>No eligible staff match this search.</p>}</div></fieldset>
        <fieldset className="event-role-picker"><legend>Roles for this event</legend><div>{EVENT_ROLES.map((role) => { const disabled = !canAssignRole(role.value); return <label key={role.value} aria-disabled={disabled}><input type="checkbox" checked={roles.includes(role.value)} disabled={disabled} onChange={() => toggleRole(role.value)} /><span>{role.label}</span></label>; })}</div></fieldset>
        <div className={appDialog.actions}><button className="secondary" type="button" onClick={() => setAddOpen(false)}>Cancel</button><button type="submit" disabled={!accountIds.length || !roles.length || busy === 'assign'}><PlusIcon />{busy === 'assign' ? 'Adding…' : `Add ${accountIds.length || ''} to event`}</button></div>
      </form>
    </AppDialog>
  </div>;
}
