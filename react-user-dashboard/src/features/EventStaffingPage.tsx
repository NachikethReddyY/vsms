import { ArrowPathIcon, PlusIcon, UserGroupIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
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
  const [accountId, setAccountId] = useState('');
  const [roles, setRoles] = useState<string[]>(['REGISTRATION']);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [membershipPage, eligiblePage] = await Promise.all([api.listMemberships(eventId), api.listEligibleUsers(eventId)]);
      setMembers(list(membershipPage));
      setEligible(list(eligiblePage));
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
  const selectedPerson = eligible.find((person) => (person.userId ?? person.id) === accountId);

  const toggleRole = (role: string) => setRoles((current) => current.includes(role) ? current.filter((item) => item !== role) : [...current, role]);

  const assign = async () => {
    if (!accountId || !roles.length) return;
    setBusy('assign');
    setError('');
    try {
      await api.addMembership(eventId, accountId, roles);
      setAccountId('');
      setRoles(['REGISTRATION']);
      setNotice('Person assigned to this event.');
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

  return <div className="stage4-page event-staffing-page">
    <header className="event-staffing-header">
      <div><p className="eyebrow">Event access</p><h1>People and roles</h1><p>Assign approved people to this event, then choose what they can do here. Organization account types do not change.</p></div>
      <div className="stage4-actions"><button className="secondary event-staffing-refresh" type="button" aria-label="Refresh event team" title="Refresh event team" disabled={loading} onClick={() => void load()}><ArrowPathIcon className={loading ? 'is-spinning' : ''} /></button><Link className="stage4-button secondary" to={`/events/${eventId}`}>Event detail</Link></div>
    </header>

    {notice && <div className="stage4-alert good" role="status">{notice}</div>}
    {error && <div className="stage4-alert" role="alert">{error}</div>}

    <section className="stage4-card event-staffing-assign" aria-labelledby="assign-person-title">
      <div><h2 id="assign-person-title">Assign a person</h2><p className="stage4-muted">Only approved, enabled accounts are listed.</p></div>
      <div className="event-staffing-person-picker">
        <label>Find a person<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by name or email" /></label>
        <label>Eligible account<select value={accountId} onChange={(event) => { const nextId = event.target.value; const person = eligible.find((candidate) => (candidate.userId ?? candidate.id) === nextId); setAccountId(nextId); setRoles((current) => current.filter((role) => (role !== 'REVIEWER' || person?.professionalCategory === 'DOCTOR') && (role !== 'EVENT_MANAGER' || person?.roles?.includes('EVENT_MANAGER')))); }}><option value="">Choose a person</option>{candidates.map((person) => <option key={person.userId ?? person.id} value={person.userId ?? person.id}>{person.fullName} · {person.email}</option>)}</select></label>
      </div>
      <fieldset className="event-role-picker"><legend>Roles for this event</legend><div>{EVENT_ROLES.map((role) => { const disabled = (role.value === 'REVIEWER' && selectedPerson?.professionalCategory !== 'DOCTOR') || (role.value === 'EVENT_MANAGER' && !selectedPerson?.roles?.includes('EVENT_MANAGER')); return <label key={role.value} aria-disabled={disabled}><input type="checkbox" checked={roles.includes(role.value)} disabled={disabled} onChange={() => toggleRole(role.value)} /><span>{role.label}</span></label>; })}</div></fieldset>
      <button type="button" disabled={!accountId || !roles.length || busy === 'assign'} onClick={() => void assign()}><PlusIcon />{busy === 'assign' ? 'Assigning…' : 'Assign to event'}</button>
    </section>

    <section className="event-team" aria-labelledby="event-team-title">
      <div className="event-team-heading"><div><h2 id="event-team-title">Event team</h2><p>{activeMembers.length} {activeMembers.length === 1 ? 'person' : 'people'} assigned</p></div></div>
      {loading && !members.length ? <p aria-live="polite">Loading event team…</p> : activeMembers.length ? <div className="event-team-grid">{activeMembers.map((member) => {
        const memberId = member.membershipId ?? member.id;
        const currentRoles = (member.roles ?? []).map(roleName);
        const person = member.user ?? member.account;
        const availableRoles = EVENT_ROLES.filter((role) => !currentRoles.includes(role.value) && (role.value !== 'REVIEWER' || person?.professionalCategory === 'DOCTOR') && (role.value !== 'EVENT_MANAGER' || person?.roles?.includes('EVENT_MANAGER')));
        return <article className="event-team-card" key={memberId}>
          <header><span className="event-team-avatar"><UserGroupIcon /></span><div><h3>{person?.fullName ?? member.userId}</h3><p>{person?.email ?? 'Approved account'}</p></div><button className="secondary event-team-remove" type="button" disabled={busy === memberId} onClick={() => void removePerson(member)}>Remove</button></header>
          <div className="event-team-roles">{currentRoles.map((role) => <span key={role}>{roleLabel(role)}<button type="button" aria-label={`Remove ${roleLabel(role)} from ${person?.fullName ?? 'person'}`} disabled={Boolean(busy)} onClick={() => void removeRole(member, role)}><XMarkIcon /></button></span>)}</div>
          {availableRoles.length > 0 && <label className="event-team-add-role">Add another role<select defaultValue="" onChange={(event) => { const role = event.target.value; event.currentTarget.value = ''; void addRole(member, role); }}><option value="">Choose role</option>{availableRoles.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}</select></label>}
        </article>;
      })}</div> : <div className="quiet-empty"><UserGroupIcon /><h2>No one assigned yet</h2><p>Choose an approved account and one or more event roles above.</p></div>}
    </section>
  </div>;
}
