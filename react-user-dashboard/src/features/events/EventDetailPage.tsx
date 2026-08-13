import {
  ArrowLeftIcon,
  ArrowUpTrayIcon,
  CalendarDaysIcon,
  CheckIcon,
  ChevronDownIcon,
  ClipboardDocumentListIcon,
  ClipboardDocumentCheckIcon,
  ClockIcon,
  DocumentDuplicateIcon,
  MapPinIcon,
  PhotoIcon,
  PencilSquareIcon,
  PlusIcon,
  PrinterIcon,
  UserPlusIcon,
  TrashIcon,
  UserGroupIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider';
import { AppDialog } from '../../components/AppDialog';
import { appDialog } from '../../components/appDialogStyles';
import { AppToast } from '../../components/AppToast';
import { getApiError as getApiMessage } from '../../utils/apiClient';
import { getDisplayName } from '../../utils/identity';
import { eventApi, formatEventDate, STATUS_LABEL, type AuditRecord, type EventAttendee, type EventMetrics, type EventRecord, type EventStatus, type StaffAssignmentRole, type StaffDirectoryEntry, type StationTemplate } from './eventApi';
import { EVENT_BANNERS, getEventArtwork, type EventBannerKey } from './eventBanners';
import { managementPercent } from './eventReport';
import { customStationPath } from '../screening/stationConfig';

type AssignmentDraft = { userId: string; assignmentRole: StaffAssignmentRole; eventStationId: string };
const emptyAssignment: AssignmentDraft = { userId: '', assignmentRole: 'SUPPORT', eventStationId: '' };
const assignmentRoles: StaffAssignmentRole[] = ['EVENT_MANAGER', 'REGISTRATION', 'SCREENER', 'REVIEWER', 'SUPPORT'];
const applicationRoleByAssignment: Record<StaffAssignmentRole, StaffDirectoryEntry['roles'][number]> = {
  EVENT_MANAGER: 'EVENT_MANAGER', REGISTRATION: 'REGISTRATION_OFFICER', SCREENER: 'SCREENER', REVIEWER: 'REVIEWER', SUPPORT: 'SUPPORT',
};
const roleLabel = (role: string) => role.toLowerCase().replace(/_/g, ' ').replace(/^\w/, (letter: string) => letter.toUpperCase());
const toInstant = (date: string, time: string) => new Date(`${date}T${time}:00+08:00`).toISOString();

const nextAction: Record<string, { action: 'publish' | 'start' | 'complete'; status: EventStatus; label: string; prompt: string } | undefined> = {
  DRAFT: { action: 'publish', status: 'PUBLISHED', label: 'Publish event', prompt: 'Publish this event? Staff with access will see it as ready for operations.' },
  PUBLISHED: { action: 'start', status: 'IN_PROGRESS', label: 'Start event', prompt: 'Start operations now? Planned shifts will become active.' },
  IN_PROGRESS: { action: 'complete', status: 'COMPLETED', label: 'Complete event', prompt: 'Complete this event? This is a terminal action and cannot be undone.' },
};

const lifecycleStages = [
  { status: 'DRAFT', label: 'Draft' },
  { status: 'PUBLISHED', label: 'Published' },
  { status: 'IN_PROGRESS', label: 'In progress' },
  { status: 'COMPLETED', label: 'Completed' },
] as const;

function getDateParts(value: string, timezone: string) {
  const date = new Date(value);
  const parts = new Intl.DateTimeFormat(undefined, {
    weekday: 'long', month: 'short', day: 'numeric', year: 'numeric', timeZone: timezone,
  }).formatToParts(date);
  return Object.fromEntries(parts.map(({ type, value: part }) => [type, part]));
}

function formatTime(value: string, timezone: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric', minute: '2-digit', timeZone: timezone,
  }).format(new Date(value));
}

function formatTimeInput(value: string, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: timezone,
  }).formatToParts(new Date(value));
  return `${parts.find(({ type }) => type === 'hour')?.value}:${parts.find(({ type }) => type === 'minute')?.value}`;
}

function eventDuration(startsAt: string, endsAt: string) {
  const minutes = Math.max(0, Math.round((new Date(endsAt).getTime() - new Date(startsAt).getTime()) / 60_000));
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (!hours) return `${remainder} min`;
  return remainder ? `${hours} hr ${remainder} min` : `${hours} hr`;
}

export default function EventDetailPage() {
  const { eventId = '' } = useParams();
  const { session } = useAuth();
  const user = session?.user;
  const location = useLocation();
  const [event, setEvent] = useState<EventRecord | null>(null);
  const [audit, setAudit] = useState<AuditRecord[]>([]);
  const [metrics, setMetrics] = useState<EventMetrics | null>(null);
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [metricsError, setMetricsError] = useState('');
  const [attendees, setAttendees] = useState<EventAttendee[]>([]);
  const [attendeeTotal, setAttendeeTotal] = useState(0);
  const [attendeeNextCursor, setAttendeeNextCursor] = useState<string | null>(null);
  const [attendeeLoading, setAttendeeLoading] = useState(false);
  const [attendeeError, setAttendeeError] = useState('');
  const [attendeeSearch, setAttendeeSearch] = useState('');
  const [attendeeStatus, setAttendeeStatus] = useState<EventAttendee['registrationStatus'] | ''>('');
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [bannerPending, setBannerPending] = useState(false);
  const [bannerOpen, setBannerOpen] = useState(false);
  const [artworkFile, setArtworkFile] = useState('');
  const [selectedBannerKey, setSelectedBannerKey] = useState<EventBannerKey>('COMMUNITY_SCREENING');
  const [staffDirectory, setStaffDirectory] = useState<StaffDirectoryEntry[]>([]);
  const [staffingOpen, setStaffingOpen] = useState<string | null>(null);
  const [staffingPending, setStaffingPending] = useState(false);
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const [directoryLoaded, setDirectoryLoaded] = useState(false);
  const [directoryError, setDirectoryError] = useState('');
  const [assignmentDrafts, setAssignmentDrafts] = useState<Record<string, AssignmentDraft>>({});
  const [selectedStaffIds, setSelectedStaffIds] = useState<Record<string, string[]>>({});
  const [stationTemplates, setStationTemplates] = useState<StationTemplate[]>([]);
  const [stationPanelOpen, setStationPanelOpen] = useState(false);
  const [stationLoading, setStationLoading] = useState(false);
  const [stationTemplatesLoaded, setStationTemplatesLoaded] = useState(false);
  const [stationTemplatesError, setStationTemplatesError] = useState('');
  const [stationPending, setStationPending] = useState('');
  const [capacityErrors, setCapacityErrors] = useState<Record<string, string>>({});
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const [statusConfirmOpen, setStatusConfirmOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancellationReason, setCancellationReason] = useState('');
  const [cancellationError, setCancellationError] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState((location.state as { notice?: string } | null)?.notice ?? '');

  const refreshAudit = async (id = eventId) => {
    setAuditLoading(true); setAuditError('');
    try { setAudit((await eventApi.audit(id)).auditLogs); }
    catch (cause) { setAuditError(getApiMessage(cause, 'Activity could not be loaded.')); }
    finally { setAuditLoading(false); }
  };

  const loadMetrics = async (id = eventId) => {
    setMetricsLoading(true); setMetricsError('');
    try { setMetrics(await eventApi.metrics(id)); }
    catch (cause) { setMetricsError(getApiMessage(cause, 'Operational metrics could not be loaded.')); }
    finally { setMetricsLoading(false); }
  };

  const loadAttendees = async (cursor?: string, append = false) => {
    if (!event) return;
    setAttendeeLoading(true); setAttendeeError('');
    try {
      const page = await eventApi.attendees(event.eventId, {
        cursor,
        limit: 50,
        status: attendeeStatus || undefined,
        search: attendeeSearch.trim() || undefined,
      });
      setAttendees((current) => append ? [...current, ...page.attendees] : page.attendees);
      setAttendeeTotal(page.total);
      setAttendeeNextCursor(page.nextCursor);
    } catch (cause) { setAttendeeError(getApiMessage(cause, 'Attendees could not be loaded.')); }
    finally { setAttendeeLoading(false); }
  };

  const load = async () => {
    setLoading(true); setError('');
    try {
      const detail = await eventApi.get(eventId); setEvent(detail);
      if (detail.canManage) { void refreshAudit(detail.eventId); void loadMetrics(detail.eventId); }
    } catch (cause) { setError(getApiMessage(cause, 'Event details could not be loaded.')); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [eventId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (event?.canManage && location.pathname.endsWith('/attendees')) void loadAttendees();
  // The attendee query is explicitly initiated by its form or pagination controls.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event?.eventId, location.pathname]);

  const transition = async () => {
    const next = event && nextAction[event.status]; if (!event || !next) return;
    setPending(true); setError('');
    try { const updated = await eventApi.transition(event.eventId, next.action, event.version); setEvent(updated); setStatusConfirmOpen(false); setNotice(`${STATUS_LABEL[updated.status]} status saved.`); await refreshAudit(event.eventId); }
    catch (cause) { setError(getApiMessage(cause, 'The status could not be changed. Refresh and try again.')); }
    finally { setPending(false); }
  };

  const cancel = async () => {
    if (!event) return;
    const reason = cancellationReason.trim();
    if (reason.length < 10 || reason.length > 500) {
      setCancellationError('Enter a cancellation reason between 10 and 500 characters.');
      return;
    }
    setPending(true); setError('');
    try { const updated = await eventApi.cancel(event.eventId, event.version, reason); setEvent(updated); setCancelOpen(false); setCancellationReason(''); setCancellationError(''); setNotice('Event cancelled and reason recorded.'); void refreshAudit(event.eventId); }
    catch (cause) { setError(getApiMessage(cause, 'The event could not be cancelled.')); }
    finally { setPending(false); }
  };

  const saveBanner = async () => {
    if (!event) return;
    setBannerPending(true); setError('');
    try {
      const updated = await eventApi.update(event.eventId, { version: event.version, bannerKey: selectedBannerKey, artworkDataUrl: artworkFile || null });
      setEvent(updated); setBannerOpen(false); setNotice('Event banner updated.'); void refreshAudit(event.eventId);
    } catch (cause) { setError(getApiMessage(cause, 'The banner could not be updated. Refresh and try again.')); }
    finally { setBannerPending(false); }
  };

  const chooseArtwork = (change: ChangeEvent<HTMLInputElement>) => {
    const file = change.target.files?.[0];
    change.target.value = '';
    if (!file) return;
    if (!['image/jpeg', 'image/webp'].includes(file.type) || file.size > 130_000) {
      setError('Choose a JPEG or WebP image smaller than 130 KB. Use Edit details to crop larger files.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => { setArtworkFile(String(reader.result)); setError(''); };
    reader.onerror = () => setError('The selected image could not be read.');
    reader.readAsDataURL(file);
  };

  const loadStaffDirectory = async () => {
    setDirectoryLoading(true); setDirectoryError('');
    try { setStaffDirectory(await eventApi.staffDirectory()); setDirectoryLoaded(true); }
    catch (cause) { setDirectoryError(getApiMessage(cause, 'Staff could not be loaded.')); setDirectoryLoaded(false); }
    finally { setDirectoryLoading(false); }
  };

  const openStaffing = async (shiftId: string) => {
    const opening = staffingOpen !== shiftId;
    setStaffingOpen(opening ? shiftId : null);
    setAssignmentDrafts((current) => current[shiftId] ? current : { ...current, [shiftId]: emptyAssignment });
    if (opening && !directoryLoaded && !directoryLoading) await loadStaffDirectory();
  };

  const updateAssignmentDraft = (shiftId: string, changes: Partial<AssignmentDraft>) => {
    setAssignmentDrafts((current) => ({ ...current, [shiftId]: { ...(current[shiftId] ?? emptyAssignment), ...changes } }));
  };

  const assignStaff = async (shiftId: string) => {
    const draft = assignmentDrafts[shiftId] ?? emptyAssignment;
    const userIds = selectedStaffIds[shiftId] ?? [];
    if (!event || userIds.length === 0) return;
    if (draft.assignmentRole === 'SCREENER' && !draft.eventStationId) {
      setError('Choose an event station for the screener.');
      return;
    }
    setStaffingPending(true); setError('');
    try {
      const updated = await eventApi.assignStaff(event.eventId, shiftId, {
        version: event.version,
        userIds,
        assignmentRole: draft.assignmentRole,
        eventStationId: draft.eventStationId || null,
      });
      setEvent(updated);
      setAssignmentDrafts((current) => ({ ...current, [shiftId]: emptyAssignment }));
      setSelectedStaffIds((current) => ({ ...current, [shiftId]: [] }));
      setNotice(`${userIds.length} staff assignment${userIds.length === 1 ? '' : 's'} saved.`);
      void refreshAudit(event.eventId);
    }
    catch (cause) { setError(getApiMessage(cause, 'The staff assignment could not be saved.')); }
    finally { setStaffingPending(false); }
  };

  const removeStaff = async (shiftId: string, assignmentId: string) => {
    if (!event) return;
    setStaffingPending(true); setError('');
    try { setEvent(await eventApi.removeStaff(event.eventId, shiftId, assignmentId, event.version)); setNotice('Staff assignment removed.'); void refreshAudit(event.eventId); }
    catch (cause) { setError(getApiMessage(cause, 'The staff assignment could not be removed.')); }
    finally { setStaffingPending(false); }
  };

  const loadStationTemplates = async () => {
    setStationLoading(true); setStationTemplatesError('');
    try { setStationTemplates(await eventApi.stationTemplates()); setStationTemplatesLoaded(true); }
    catch (cause) { setStationTemplatesError(getApiMessage(cause, 'Station templates could not be loaded.')); setStationTemplatesLoaded(false); }
    finally { setStationLoading(false); }
  };

  const openStationTemplates = async () => {
    const opening = !stationPanelOpen;
    setStationPanelOpen(opening);
    if (opening && !stationTemplatesLoaded && !stationLoading) await loadStationTemplates();
  };

  const importStation = async (stationTemplateId: string) => {
    if (!event) return;
    setStationPending(stationTemplateId); setError('');
    try {
      setEvent(await eventApi.importStations(event.eventId, event.version, [stationTemplateId]));
      setNotice('Station added to this event.');
      void refreshAudit(event.eventId);
    } catch (cause) { setError(getApiMessage(cause, 'The station could not be imported.')); }
    finally { setStationPending(''); }
  };

  const updateStation = async (eventStationId: string, changes: { stationOrder?: number; capacity?: number; isAvailable?: boolean; availabilities?: Array<{ date: string; isAvailable: boolean; startsAt: string | null; endsAt: string | null; capacity: number }> }) => {
    if (!event) return;
    setStationPending(eventStationId); setError('');
    try {
      setEvent(await eventApi.updateStation(event.eventId, eventStationId, { version: event.version, ...changes }));
      setNotice('Station configuration updated.');
      void refreshAudit(event.eventId);
    } catch (cause) { setError(getApiMessage(cause, 'The station configuration could not be saved.')); }
    finally { setStationPending(''); }
  };

  const saveStationSchedule = (submitEvent: FormEvent<HTMLFormElement>, eventStationId: string) => {
    submitEvent.preventDefault();
    const data = new FormData(submitEvent.currentTarget);
    const availabilities = event?.eventDays.map((day, index) => {
      const isAvailable = data.get(`available-${index}`) === 'on';
      const capacity = Number(data.get(`capacity-${index}`));
      const startsAt = String(data.get(`starts-${index}`));
      const endsAt = String(data.get(`ends-${index}`));
      return {
        date: day.date,
        isAvailable,
        startsAt: isAvailable ? toInstant(day.date, startsAt) : null,
        endsAt: isAvailable ? toInstant(day.date, endsAt) : null,
        capacity,
      };
    });
    if (availabilities) void updateStation(eventStationId, { availabilities });
  };

  const removeStation = async (eventStationId: string, name: string) => {
    if (!event || !window.confirm(`Remove ${name} from this event? This cannot be undone.`)) return;
    setStationPending(eventStationId); setError('');
    try {
      setEvent(await eventApi.removeStation(event.eventId, eventStationId, event.version));
      setNotice(`${name} removed from this event.`);
      void refreshAudit(event.eventId);
    } catch (cause) { setError(getApiMessage(cause, 'The station could not be removed.')); }
    finally { setStationPending(''); }
  };

  const saveStationCapacity = (submitEvent: FormEvent<HTMLFormElement>, eventStationId: string) => {
    submitEvent.preventDefault();
    const input = submitEvent.currentTarget.elements.namedItem('capacity');
    if (!(input instanceof HTMLInputElement)) return;
    const capacity = input.valueAsNumber;
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 1000) {
      setCapacityErrors((current) => ({ ...current, [eventStationId]: 'Enter a whole number from 1 to 1,000.' }));
      input.focus();
      return;
    }
    setCapacityErrors((current) => ({ ...current, [eventStationId]: '' }));
    void updateStation(eventStationId, { capacity });
  };

  const dateParts = useMemo(() => event ? getDateParts(event.startsAt, event.timezone) : null, [event]);

  if (loading) return <div className="detail-loading" aria-live="polite" aria-label="Loading event"><span /><span /><span /></div>;
  if (!event || !dateParts) return <div className="center-state error-state"><h1>Event unavailable</h1><p>{error}</p><div className="error-state-actions"><button className="primary" type="button" onClick={() => void load()}>Try again</button><Link className="secondary" to="/events">Return to events</Link></div></div>;

  const terminal = event.status === 'COMPLETED' || event.status === 'CANCELLED';
  const canManage = event.canManage;
  const canCreateEvent = user?.roles.includes('ADMINISTRATOR') ?? false;
  const canConfigureStations = canManage && ['DRAFT', 'PUBLISHED'].includes(event.status);
  const canEditStaffing = canManage && ['DRAFT', 'PUBLISHED'].includes(event.status);
  const availableTemplates = stationTemplates.filter((template) => {
    if (template.stationType === 'CUSTOM') {
      return !event.eventStations.some((station) => station.stationTemplateId === template.stationTemplateId);
    }
    return !event.eventStations.some((station) => station.stationType === template.stationType);
  });
  const canCancel = canManage && !terminal && (event.status !== 'IN_PROGRESS' || user?.systemRole === 'ADMIN');
  const isAdministrator = user?.roles.includes('ADMINISTRATOR') ?? false;
  const canRegisterParticipants = !isAdministrator && event.status === 'IN_PROGRESS' && event.shifts.some((shift) => (
    shift.status === 'ACTIVE' && shift.staffAssignments.some((assignment) => (
      assignment.assignmentRole === 'REGISTRATION'
      && ['ASSIGNED', 'CONFIRMED'].includes(assignment.status)
      && assignment.user.userId === user?.userId
    ))
  ));
  const canPermanentlyDelete = ['DRAFT', 'COMPLETED', 'CANCELLED'].includes(event.status) && user?.systemRole === 'ADMIN' && isAdministrator;
  const canReview = !isAdministrator && event.status === 'IN_PROGRESS' && event.shifts.some((shift) => (
    shift.status === 'ACTIVE' && shift.staffAssignments.some((assignment) => (
      assignment.assignmentRole === 'REVIEWER'
      && ['ASSIGNED', 'CONFIRMED'].includes(assignment.status)
      && assignment.user.userId === user?.userId
    ))
  ));
  const assignedStationCandidates = !isAdministrator ? event.shifts.flatMap((shift) => shift.staffAssignments.flatMap((assignment) => {
    if (shift.status !== 'ACTIVE'
      || assignment.assignmentRole !== 'SCREENER'
      || !['ASSIGNED', 'CONFIRMED'].includes(assignment.status)
      || assignment.user.userId !== user?.userId
      || !assignment.eventStation) return [];
    const station = event.eventStations.find((candidate) => candidate.eventStationId === assignment.eventStation?.eventStationId);
    return station ? [station] : [];
  })) : [];
  const assignedStations = [...new Map(assignedStationCandidates.map((station) => [station.eventStationId, station])).values()];
  const assignedStationTypes = new Set(assignedStations.map((station) => station.stationType));
  const activeStage = lifecycleStages.findIndex((stage) => stage.status === event.status);
  const totalRequiredStaff = event.shifts.reduce((total, shift) => total + shift.requiredStaff, 0);
  const totalAssignedStaff = event.shifts.reduce((total, shift) => total + shift.staffAssignments.length, 0);
  const next = nextAction[event.status];
  const routeSection = location.pathname.split('/').filter(Boolean).pop();
  const requestedView = routeSection && ['stations', 'staff', 'analytics', 'reports', 'attendees', 'activity'].includes(routeSection) ? routeSection : 'overview';
  const view = canManage ? requestedView : 'overview';
  const eventPath = `/events/${event.eventId}`;
  const managementMeasures = metrics ? [
    { label: 'Attendance', value: metrics.attendanceRatePercent, detail: `${metrics.checkedInCount.toLocaleString()} of ${metrics.signupCount.toLocaleString()} registrations checked in` },
    { label: 'Visit completion', value: managementPercent(metrics.completedCount, metrics.signupCount), detail: `${metrics.completedCount.toLocaleString()} completed visits` },
    { label: 'Live capacity use', value: managementPercent(metrics.activeCount, metrics.capacity), detail: `${metrics.activeCount.toLocaleString()} of ${metrics.capacity.toLocaleString()} places in use` },
    { label: 'Staffing coverage', value: managementPercent(totalAssignedStaff, totalRequiredStaff), detail: `${totalAssignedStaff.toLocaleString()} of ${totalRequiredStaff.toLocaleString()} planned positions filled` },
  ] : [];

  return <div className="page-frame detail-page">
    <div className="detail-topline"><Link className="event-detail-back" to="/events"><ArrowLeftIcon />Back to events</Link><span className="event-record-reference">Event record / {event.eventId.slice(0, 8)}</span></div>

    <section className="event-detail-hero" aria-labelledby="event-title">
      <figure className="event-hero-artwork" aria-label={`Artwork for ${event.name}`}>
        <img src={getEventArtwork(event.bannerKey, event.artworkDataUrl)} alt="" />
        {canManage && !terminal && <button type="button" aria-expanded={bannerOpen} aria-controls="event-banner-picker" onClick={() => { setSelectedBannerKey(event.bannerKey ?? 'COMMUNITY_SCREENING'); setArtworkFile(event.artworkDataUrl ?? ''); setBannerOpen((open) => !open); }}><PhotoIcon />Edit artwork</button>}
      </figure>

      <div className="event-summary">
        <div className="event-summary-heading">
          <h1 id="event-title">{event.name}</h1>
          <p>{event.description || 'No event description has been added.'}</p>
          <div className="event-summary-actions">
            {canManage ? <details className="event-status-control">
              <summary><i className={`status-dot ${event.status.toLowerCase()}`} />{STATUS_LABEL[event.status]}<ChevronDownIcon /></summary>
              <div>
                {next ? <><span>Next stage</span><button className="primary compact" type="button" disabled={pending} onClick={() => setStatusConfirmOpen(true)}>{pending ? 'Saving…' : next.label}</button></> : <span>This lifecycle is complete.</span>}
                {canCancel && <button className="danger-button compact" type="button" disabled={pending} onClick={() => { setCancellationReason(''); setCancellationError(''); setCancelOpen(true); }}>Cancel event</button>}
              </div>
            </details> : <span className="event-status-readonly"><i className={`status-dot ${event.status.toLowerCase()}`} />{STATUS_LABEL[event.status]}</span>}
            {terminal && canCreateEvent && <Link className="secondary compact" to="/events/new" state={{ duplicateFrom: event }}><DocumentDuplicateIcon />Duplicate event</Link>}
          </div>
        </div>

        <div className="event-role-actions">
          {canRegisterParticipants && <Link className="secondary" to={`${eventPath}/register`}><UserPlusIcon />Start registration</Link>}
          {assignedStationTypes.has('VISUAL_ACUITY') && <Link className="primary" to={`${eventPath}/stations/visual-acuity`}>Open Visual Acuity station</Link>}
          {assignedStationTypes.has('REFRACTION') && <Link className="primary" to={`${eventPath}/stations/refraction`}>Open Refraction station</Link>}
          {assignedStationTypes.has('COLOUR_VISION') && <Link className="primary" to={`${eventPath}/stations/colour-vision`}>Open Colour Vision station</Link>}
          {assignedStationTypes.has('EYE_HEALTH') && <p className="quiet-empty">Eye health is captured during clinical review, not as a screener station.</p>}
          {assignedStations.filter((station) => station.stationType === 'CUSTOM').map((station) => <Link className="primary" key={station.eventStationId} to={customStationPath(event.eventId, station.eventStationId)}>Open {station.name}</Link>)}
          {assignedStationTypes.size > 0 && <Link className="secondary" to="/qr-scanner">Scan QR → station</Link>}
          {canReview && <Link className="secondary" to={`${eventPath}/reviews`}><ClipboardDocumentCheckIcon />Open clinical review</Link>}
        </div>
      </div>
    </section>

    {canManage && <nav className="event-detail-tabs" aria-label="Event sections">
      <Link className={view === 'overview' ? 'active' : undefined} to={eventPath}>Overview</Link>
      <Link className={view === 'stations' ? 'active' : undefined} to={`${eventPath}/stations`}>Stations</Link>
      <Link className={view === 'staff' ? 'active' : undefined} to={`${eventPath}/staff`}>Staff</Link>
      <Link className={view === 'analytics' ? 'active' : undefined} to={`${eventPath}/analytics`}>Analytics</Link>
      <Link className={view === 'reports' ? 'active' : undefined} to={`${eventPath}/reports`}>Reports</Link>
      <Link className={view === 'attendees' ? 'active' : undefined} to={`${eventPath}/attendees`}>Attendees</Link>
      <Link className={view === 'activity' ? 'active' : undefined} to={`${eventPath}/activity`}>Activity</Link>
      {canPermanentlyDelete && <Link className="danger-link" to={`${eventPath}/delete`}>Delete event</Link>}
    </nav>}

    <AppToast message={notice} onDismiss={() => setNotice('')} />
    {error && <div className="alert error" role="alert">{error}</div>}

    {bannerOpen && !terminal && <section className="banner-picker event-hero-banner-picker" id="event-banner-picker" aria-labelledby="banner-picker-title">
      <div className="banner-picker-heading"><div><h2 id="banner-picker-title">Choose event artwork</h2><p>Use a built-in image or select your own file.</p></div><button className="icon-button" type="button" onClick={() => setBannerOpen(false)} aria-label="Close artwork picker"><XMarkIcon /></button></div>
      <input ref={fileInput} className="visually-hidden" type="file" accept="image/jpeg,image/webp" onChange={chooseArtwork} />
      <div className="banner-options" role="radiogroup" aria-label="Available event artwork">
        {EVENT_BANNERS.map((option) => <button className={`banner-option ${!artworkFile && selectedBannerKey === option.key ? 'selected' : ''}`} type="button" role="radio" aria-checked={!artworkFile && selectedBannerKey === option.key} key={option.key} onClick={() => { setSelectedBannerKey(option.key); setArtworkFile(''); }}><span className="banner-option-image"><img src={option.src} alt="" />{!artworkFile && selectedBannerKey === option.key && <i><CheckIcon /></i>}</span><span><strong>{option.label}</strong><small>{option.description}</small></span></button>)}
        <button className={`banner-option banner-upload-option ${artworkFile ? 'selected' : ''}`} type="button" role="radio" aria-checked={!!artworkFile} onClick={() => fileInput.current?.click()}><span className="banner-option-image"><ArrowUpTrayIcon />{artworkFile && <i><CheckIcon /></i>}</span><span><strong>Upload your image</strong><small>JPEG or WebP, up to 130 KB</small></span></button>
      </div>
      <div className="banner-picker-actions"><button className="secondary" type="button" onClick={() => setBannerOpen(false)}>Cancel</button><button className="primary" type="button" disabled={bannerPending} onClick={() => void saveBanner()}>{bannerPending ? 'Saving…' : 'Use selected artwork'}</button></div>
    </section>}

    {view === 'overview' && <div className="event-view">
      <div className="event-view-heading"><div><h2>Overview</h2><p>Key details and operational performance for this event.</p></div><div className="event-view-actions">{canManage && metrics && <button className="secondary compact event-print-button" type="button" onClick={() => window.print()}><PrinterIcon />Print / save PDF</button>}{canManage && !terminal && <Link className="secondary compact" to={`${eventPath}/edit`}><PencilSquareIcon />Edit overview</Link>}</div></div>
      <section className="event-metric-grid" aria-label="Event overview">
        <div className="event-info-row"><CalendarDaysIcon /><div><small>Date and time</small><strong>{dateParts.weekday}, {dateParts.month} {dateParts.day}, {dateParts.year}</strong><span>{formatTime(event.startsAt, event.timezone)} to {formatTime(event.endsAt, event.timezone)}, {eventDuration(event.startsAt, event.endsAt)}</span></div></div>
        <div className="event-info-row"><MapPinIcon /><div><small>Venue</small><strong>{event.venue}</strong><span>{event.address || 'Address entered manually'}{event.postalCode ? ` · Singapore ${event.postalCode}` : ''} · {event.timezone}</span></div></div>
        {canManage && <div className="event-info-row"><UserGroupIcon /><div><small>At venue now</small><strong>{event.activeCapacityCount.toLocaleString()} of {event.capacity.toLocaleString()} people</strong><span>Signed up or checked in</span></div></div>}
        {canManage && <div className="event-info-row"><ClipboardDocumentListIcon /><div><small>Expected</small><strong>{event.expectedAttendance?.toLocaleString() || 'Not set'} visitors</strong><span>{event.signupCount.toLocaleString()} signups collected</span></div></div>}
        <div className="event-info-row"><ClockIcon /><div><small>Staffing plan</small><strong>{event.shifts.length} {event.shifts.length === 1 ? 'shift' : 'shifts'}, {totalRequiredStaff} required</strong><span>Event operations coverage</span></div></div>
      </section>
      {canManage && <section className="event-metric-grid" aria-label="Operational metrics">
        {metricsLoading ? <p>Loading operational metrics…</p> : metricsError ? <div className="inline-retry" role="alert"><p>{metricsError}</p><button className="secondary compact" type="button" onClick={() => void loadMetrics(event.eventId)}>Retry</button></div> : metrics && <>
          <div className="event-info-row"><ClipboardDocumentListIcon /><div><small>Signups</small><strong>{metrics.signupCount.toLocaleString()}</strong><span>Non-cancelled registrations</span></div></div>
          <div className="event-info-row"><UserGroupIcon /><div><small>Checked in</small><strong>{metrics.checkedInCount.toLocaleString()}</strong><span>{metrics.attendanceRatePercent}% attendance</span></div></div>
          <div className="event-info-row"><ClockIcon /><div><small>Active</small><strong>{metrics.activeCount.toLocaleString()}</strong><span>Of {metrics.capacity.toLocaleString()} capacity</span></div></div>
          <div className="event-info-row"><ClipboardDocumentCheckIcon /><div><small>Clinical results</small><strong>{metrics.screeningResultCount.toLocaleString()}</strong><span>{metrics.flaggedResultCount.toLocaleString()} flagged · {metrics.referralCount.toLocaleString()} referrals</span></div></div>
        </>}
      </section>}
      {canManage && metrics && <section className="management-report" aria-labelledby="management-report-title">
        <header className="management-report-heading">
          <div><h2 id="management-report-title">Management report — {event.name}</h2><p>Aggregate operational data only. Participant identity and clinical detail are excluded.</p></div>
          <dl><div><dt>Status</dt><dd>{STATUS_LABEL[event.status]}</dd></div><div><dt>Event date</dt><dd>{dateParts.month} {dateParts.day}, {dateParts.year}</dd></div><div><dt>Venue</dt><dd>{event.venue}</dd></div></dl>
        </header>
        <div className="management-chart-grid" aria-label="Management performance charts">
          {managementMeasures.map((measure) => <article key={measure.label}>
            <div><h3>{measure.label}</h3><strong>{measure.value}%</strong></div>
            <progress max="100" value={measure.value} aria-label={`${measure.label}: ${measure.value}%`} />
            <p>{measure.detail}</p>
          </article>)}
        </div>
        <div className="management-outcomes">
          <div><span>Screening results</span><strong>{metrics.screeningResultCount.toLocaleString()}</strong></div>
          <div><span>Flagged results</span><strong>{metrics.flaggedResultCount.toLocaleString()}</strong></div>
          <div><span>Referrals</span><strong>{metrics.referralCount.toLocaleString()}</strong></div>
          <div><span>Cancelled registrations</span><strong>{metrics.cancelledCount.toLocaleString()}</strong></div>
        </div>
      </section>}
      <section className="lifecycle" aria-labelledby="lifecycle-title">
        <div className="lifecycle-heading"><h2 id="lifecycle-title">Event lifecycle</h2><span>{event.status === 'CANCELLED' ? 'Cancelled before completion' : `${STATUS_LABEL[event.status]} stage`}</span></div>
        <ol className={event.status === 'CANCELLED' ? 'is-cancelled' : ''}>{lifecycleStages.map((stage, index) => <li className={index < activeStage ? 'complete' : index === activeStage ? 'current' : ''} key={stage.status}><i>{index < activeStage ? <CheckIcon /> : null}</i><span>{stage.label}</span></li>)}</ol>
      </section>
      {event.status === 'CANCELLED' && <section className="cancellation"><strong>Cancellation reason</strong><p>{event.cancellationReason}</p></section>}
      {canPermanentlyDelete && <section className="event-danger-zone" aria-labelledby="event-danger-zone-title">
        <div><h2 id="event-danger-zone-title">Danger zone</h2><p>Permanently delete this event, its operational records, and participant profiles created only for this event. Profiles reused by another event are preserved.</p></div>
        <Link className="danger-button compact" to={`${eventPath}/delete`}><TrashIcon />Review deletion</Link>
      </section>}
    </div>}

    {view === 'stations' && <section className="event-view station-section" aria-labelledby="stations-title">
          <div className="section-title">
            <div><h2 id="stations-title">Event stations</h2><p>Availability follows the event’s scheduled days.</p></div>
            {canConfigureStations && <button className="secondary compact" type="button" aria-expanded={stationPanelOpen} aria-controls="station-template-panel" onClick={() => void openStationTemplates()}><PlusIcon />Import station</button>}
          </div>
          {stationPanelOpen && <div className="station-template-panel" id="station-template-panel" aria-live="polite">
            <div><strong>Add one station</strong><span>Choose the station this event needs. Daily availability is configured independently.</span></div>
            {stationLoading ? <p>Loading station templates…</p> : stationTemplatesError ? <div className="inline-retry" role="alert"><p>{stationTemplatesError}</p><button className="secondary compact" type="button" onClick={() => void loadStationTemplates()}>Retry</button></div> : stationTemplatesLoaded && availableTemplates.length === 0 ? <p>All active station templates are already in this event.</p> : <ul>{availableTemplates.map((template) => <li key={template.stationTemplateId}><span><strong>{template.name}</strong><small>{template.description || 'No template description.'} · Default capacity {template.defaultCapacity}</small></span><button className="secondary compact" type="button" disabled={!!stationPending} onClick={() => void importStation(template.stationTemplateId)}>{stationPending === template.stationTemplateId ? 'Importing…' : 'Import'}</button></li>)}</ul>}
          </div>}
          {event.eventStations.length === 0 ? <p className="quiet-empty">{canConfigureStations ? 'No stations added yet. Import the first station this event needs.' : 'No stations are configured for this event.'}</p> : <div className="station-table">{event.eventStations.map((station) => {
            const availabilities = station.availabilities.length ? station.availabilities : event.eventDays.map((day) => ({ eventStationAvailabilityId: `${station.eventStationId}-${day.eventDayId}`, eventDay: day, isAvailable: station.isAvailable, startsAt: day.startsAt, endsAt: day.endsAt, capacity: station.capacity }));
            return <article className={`station-record ${station.isAvailable ? '' : 'is-unavailable'}`} key={station.eventStationId}>
              <div className="station-record-copy"><strong>{station.name}</strong><span>{station.description || 'No station instructions.'}</span><small>Template v{station.templateVersion}</small></div>
              {canConfigureStations ? <div className="station-stacked-controls">
                <form className="station-capacity" noValidate onSubmit={(submitEvent) => saveStationCapacity(submitEvent, station.eventStationId)}>
                  <label><span>Set capacity for every day</span><input key={`${station.eventStationId}-${station.capacity}`} name="capacity" type="number" min="1" max="1000" step="1" required defaultValue={station.capacity} aria-label={`${station.name} capacity for every day`} aria-invalid={!!capacityErrors[station.eventStationId]} aria-describedby={capacityErrors[station.eventStationId] ? `capacity-error-${station.eventStationId}` : undefined} onInput={() => setCapacityErrors((current) => ({ ...current, [station.eventStationId]: '' }))} />{capacityErrors[station.eventStationId] && <span className="field-error" id={`capacity-error-${station.eventStationId}`} role="alert">{capacityErrors[station.eventStationId]}</span>}</label>
                  <button className="secondary compact" type="submit" disabled={!!stationPending}>{stationPending === station.eventStationId ? 'Saving…' : 'Apply'}</button>
                </form>
                <form className="station-schedule" onSubmit={(submitEvent) => saveStationSchedule(submitEvent, station.eventStationId)}>
                  {availabilities.map((availability, index) => <fieldset key={availability.eventStationAvailabilityId}>
                    <legend>{formatEventDate(availability.eventDay.date, event.timezone, false)}</legend>
                    <label className="station-available"><input name={`available-${index}`} type="checkbox" defaultChecked={availability.isAvailable} /> Available</label>
                    <label><span>From</span><input name={`starts-${index}`} type="time" defaultValue={availability.startsAt ? formatTimeInput(availability.startsAt, event.timezone) : ''} /></label>
                    <label><span>Until</span><input name={`ends-${index}`} type="time" defaultValue={availability.endsAt ? formatTimeInput(availability.endsAt, event.timezone) : ''} /></label>
                    <label><span>Capacity</span><input name={`capacity-${index}`} type="number" min="1" max="1000" step="1" required defaultValue={availability.capacity} /></label>
                  </fieldset>)}
                  <button className="primary compact" type="submit" disabled={!!stationPending}>{stationPending === station.eventStationId ? 'Saving…' : 'Save daily schedule'}</button>
                </form>
                <button className="secondary compact station-remove" type="button" disabled={!!stationPending} onClick={() => void removeStation(station.eventStationId, station.name)}><TrashIcon />Remove station</button>
              </div> : <div className="station-day-list">{availabilities.map((availability) => <span className={availability.isAvailable ? 'is-available' : 'is-unavailable'} key={availability.eventStationAvailabilityId}>{formatEventDate(availability.eventDay.date, event.timezone, false)} · {availability.isAvailable ? `${availability.capacity} places` : 'Unavailable'}</span>)}</div>}
            </article>;
          })}</div>}
    </section>}

    {view === 'staff' && <section className="event-view shift-section" aria-labelledby="shift-title">
        <div className="section-title"><h2 id="shift-title">Shifts</h2><span>{event.shifts.length} scheduled</span></div>
        {event.shifts.length === 0 ? <p className="quiet-empty">No shifts have been added. The event can still be saved as a draft.</p> : <div className="shift-table">{event.shifts.map((shift) => {
          const draft = assignmentDrafts[shift.shiftId] ?? emptyAssignment;
          const selectedIds = selectedStaffIds[shift.shiftId] ?? [];
          const eligibleStaff = staffDirectory.filter((person) => person.roles.includes(applicationRoleByAssignment[draft.assignmentRole]));
          return <article className="shift-record" key={shift.shiftId}>
            <div className="shift-record-summary"><span><strong>{shift.name}</strong><small>{STATUS_LABEL[shift.status as keyof typeof STATUS_LABEL] ?? shift.status.toLowerCase()}</small></span><span><small>Schedule</small>{formatTime(shift.startsAt, event.timezone)}–{formatTime(shift.endsAt, event.timezone)}</span><span><small>Coverage</small>{shift.staffAssignments.length} of {shift.requiredStaff} assigned</span>{canEditStaffing && <button className="secondary compact" type="button" aria-expanded={staffingOpen === shift.shiftId} onClick={() => void openStaffing(shift.shiftId)}><PlusIcon />Assign</button>}</div>
            {shift.staffAssignments.length > 0 ? <ul className="assignment-list">{shift.staffAssignments.map((assignment) => <li key={assignment.staffAssignmentId}><span><strong>{getDisplayName(assignment.user.username)}</strong><small>{roleLabel(assignment.assignmentRole)}{assignment.eventStation ? ` · ${assignment.eventStation.name}` : ''}</small></span>{canEditStaffing && <button className="assignment-remove" type="button" aria-label={`Remove ${getDisplayName(assignment.user.username)} from ${shift.name}`} title={`Remove ${getDisplayName(assignment.user.username)}`} onClick={() => void removeStaff(shift.shiftId, assignment.staffAssignmentId)} disabled={staffingPending}><TrashIcon /></button>}</li>)}</ul> : <p className="shift-empty">No staff assigned to this shift.</p>}
            {canEditStaffing && staffingOpen === shift.shiftId && <form className="staffing-editor" onSubmit={(submitEvent) => { submitEvent.preventDefault(); void assignStaff(shift.shiftId); }}>
              {directoryLoading ? <p>Loading available staff…</p> : directoryError ? <div className="inline-retry" role="alert"><p>{directoryError}</p><button className="secondary compact" type="button" onClick={() => void loadStaffDirectory()}>Retry</button></div> : directoryLoaded && staffDirectory.length === 0 ? <p>No active staff members are available.</p> : <>
                <label><span>Shift role</span><select value={draft.assignmentRole} disabled={staffingPending} onChange={(change) => { updateAssignmentDraft(shift.shiftId, { assignmentRole: change.target.value as StaffAssignmentRole, eventStationId: '' }); setSelectedStaffIds((current) => ({ ...current, [shift.shiftId]: [] })); }}>{assignmentRoles.map((role) => <option value={role} key={role}>{roleLabel(role)}</option>)}</select></label>
                <label><span>Station {draft.assignmentRole === 'SCREENER' ? '(required)' : '(optional)'}</span><select required={draft.assignmentRole === 'SCREENER'} value={draft.eventStationId} disabled={staffingPending} onChange={(change) => updateAssignmentDraft(shift.shiftId, { eventStationId: change.target.value })}><option value="">No station</option>{event.eventStations.filter((station) => station.isAvailable).map((station) => <option value={station.eventStationId} key={station.eventStationId}>{station.stationOrder}. {station.name}</option>)}</select></label>
                <fieldset className="staff-picker"><legend>Staff members</legend><label><input type="checkbox" checked={eligibleStaff.length > 0 && selectedIds.length === eligibleStaff.length} onChange={(change) => setSelectedStaffIds((current) => ({ ...current, [shift.shiftId]: change.target.checked ? eligibleStaff.map(({ userId }) => userId) : [] }))} /> Select all {eligibleStaff.length}</label>{eligibleStaff.map((person) => <label key={person.userId}><input type="checkbox" checked={selectedIds.includes(person.userId)} onChange={(change) => setSelectedStaffIds((current) => ({ ...current, [shift.shiftId]: change.target.checked ? [...selectedIds, person.userId] : selectedIds.filter((id) => id !== person.userId) }))} /> {getDisplayName(person.username)}</label>)}</fieldset>
                <button className="primary compact" type="submit" disabled={staffingPending || selectedIds.length === 0 || (draft.assignmentRole === 'SCREENER' && !draft.eventStationId)}>{staffingPending ? 'Saving…' : `Assign ${selectedIds.length || ''} staff`}</button>
              </>}
            </form>}
          </article>;
        })}</div>}
    </section>}

    {view === 'attendees' && <section className="event-view" aria-labelledby="attendees-title">
      <div className="event-view-heading"><div><h2 id="attendees-title">Attendees</h2><p>{attendeeTotal.toLocaleString()} matching registrations</p></div></div>
      <form className="event-attendee-filters" onSubmit={(submitEvent) => { submitEvent.preventDefault(); void loadAttendees(); }}>
        <label><span>Search attendee</span><input type="search" value={attendeeSearch} onChange={(change) => setAttendeeSearch(change.target.value)} placeholder="Name or participant reference" /></label>
        <label><span>Registration status</span><select value={attendeeStatus} onChange={(change) => setAttendeeStatus(change.target.value as EventAttendee['registrationStatus'] | '')}><option value="">All statuses</option><option value="SIGNED_UP">Signed up</option><option value="CHECKED_IN">Checked in</option><option value="COMPLETED">Completed</option><option value="CANCELLED">Cancelled</option></select></label>
        <button className="primary compact" type="submit" disabled={attendeeLoading}>{attendeeLoading ? 'Loading…' : 'Apply filters'}</button>
      </form>
      {attendeeError && <div className="inline-retry" role="alert"><p>{attendeeError}</p><button className="secondary compact" type="button" onClick={() => void loadAttendees()}>Retry</button></div>}
      {!attendeeError && !attendeeLoading && attendees.length === 0 ? <p className="quiet-empty">No attendees match these filters.</p> : <div className="station-table">{attendees.map((attendee) => <article className="station-record" key={attendee.registrationId}><div className="station-record-copy"><strong>{attendee.participantDisplayName || attendee.participantReference}</strong><span>{attendee.participantReference} · {attendee.registrationStatus.toLowerCase().replace('_', ' ')}</span><small>{attendee.checkedInAt ? `Checked in ${formatEventDate(attendee.checkedInAt, event.timezone)}` : `Registered ${formatEventDate(attendee.createdAt, event.timezone)}`}</small></div><strong className="station-capacity-readonly">{attendee.queueNumber ? `#${attendee.queueNumber}` : '—'}</strong></article>)}</div>}
      {attendeeNextCursor && <button className="secondary compact" type="button" disabled={attendeeLoading} onClick={() => void loadAttendees(attendeeNextCursor, true)}>{attendeeLoading ? 'Loading…' : 'Load more'}</button>}
    </section>}

    {view === 'activity' && <section className="event-view history event-activity" aria-labelledby="activity-title">
      <h2 id="activity-title">Activity</h2>
      <p>Consequential event actions retain the authenticated actor and timestamp.</p>
      {!canManage ? <p>History is available to the event’s managers and administrators.</p> : <>
        {auditError && <div className="inline-retry" role="alert"><p>{auditError}</p><button className="secondary compact" type="button" onClick={() => void refreshAudit(event.eventId)}>Retry</button></div>}
        {auditLoading && audit.length === 0 ? <p>Loading activity…</p> : !auditError && audit.length === 0 ? <p>No history is available.</p> : audit.length > 0 ? <ol>{audit.map((item) => <li key={item.eventAuditLogId}><i /><div><strong>{item.action.toLowerCase().replace(/_/g, ' ')}</strong><span>{item.actor?.email ?? 'System actor'}</span><time dateTime={item.createdAt}>{formatEventDate(item.createdAt, event.timezone)}</time></div></li>)}</ol> : null}
      </>}
    </section>}
    <AppDialog
      open={statusConfirmOpen}
      onOpenChange={setStatusConfirmOpen}
      title={next?.label ?? 'Update event status'}
      description={next?.prompt}
      dismissible={!pending}
    >
      <div className={appDialog.actions}>
        <button className="secondary" type="button" data-dialog-autofocus disabled={pending} onClick={() => setStatusConfirmOpen(false)}>Keep current status</button>
        <button className="primary" type="button" disabled={pending} onClick={() => void transition()}>{pending ? 'Saving…' : next?.label ?? 'Save status'}</button>
      </div>
    </AppDialog>
    <AppDialog
      open={cancelOpen}
      onOpenChange={(open) => { if (!open && !pending) { setCancelOpen(false); setCancellationReason(''); setCancellationError(''); } }}
      title="Cancel this event?"
      description="Record a clear reason before cancelling. This action cannot be reversed."
      dismissible={!pending}
    >
      <form className={appDialog.form} noValidate onSubmit={(submitEvent) => { submitEvent.preventDefault(); void cancel(); }}>
        <label className={appDialog.field}><span>Cancellation reason</span><textarea required minLength={10} maxLength={500} rows={4} value={cancellationReason} data-dialog-autofocus aria-invalid={!!cancellationError} aria-describedby={cancellationError ? 'event-cancellation-help event-cancellation-error' : 'event-cancellation-help'} onChange={(change) => { setCancellationReason(change.target.value); setCancellationError(''); }} /></label>
        <p className={appDialog.help} id="event-cancellation-help">{cancellationReason.length}/500 characters</p>
        {cancellationError && <p className={appDialog.error} id="event-cancellation-error" role="alert">{cancellationError}</p>}
        <div className={appDialog.actions}><button className="secondary" type="button" disabled={pending} onClick={() => { setCancelOpen(false); setCancellationReason(''); setCancellationError(''); }}>Keep event</button><button className="danger-button" type="submit" disabled={pending}>{pending ? 'Cancelling…' : 'Cancel event'}</button></div>
      </form>
    </AppDialog>
  </div>;
}
