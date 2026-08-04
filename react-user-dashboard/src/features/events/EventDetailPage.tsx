import {
  ArrowLeftIcon,
  ArrowUpTrayIcon,
  CalendarDaysIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ClipboardDocumentListIcon,
  ClipboardDocumentCheckIcon,
  ClockIcon,
  DocumentDuplicateIcon,
  MapPinIcon,
  PhotoIcon,
  PencilSquareIcon,
  PlusIcon,
  TrashIcon,
  UserGroupIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider';
import { AppDialog } from '../../components/AppDialog';
import { AppToast } from '../../components/AppToast';
import { getApiError as getApiMessage } from '../../utils/apiClient';
import { getDisplayName } from '../../utils/identity';
import { eventApi, formatEventDate, STATUS_LABEL, type AuditRecord, type EventRecord, type EventStatus, type StaffAssignmentRole, type StaffDirectoryEntry, type StationTemplate } from './eventApi';
import { EVENT_BANNERS, getEventArtwork, type EventBannerKey } from './eventBanners';

type AssignmentDraft = { userId: string; assignmentRole: StaffAssignmentRole; eventStationId: string };
const emptyAssignment: AssignmentDraft = { userId: '', assignmentRole: 'SUPPORT', eventStationId: '' };
const assignmentRoles: StaffAssignmentRole[] = ['EVENT_MANAGER', 'REGISTRATION', 'SCREENER', 'REVIEWER', 'SUPPORT'];
const applicationRoleByAssignment: Record<StaffAssignmentRole, StaffDirectoryEntry['roles'][number]> = {
  EVENT_MANAGER: 'EVENT_MANAGER', REGISTRATION: 'REGISTRATION_OFFICER', SCREENER: 'SCREENER', REVIEWER: 'REVIEWER', SUPPORT: 'SUPPORT',
};
const roleLabel = (role: string) => role.toLowerCase().replace(/_/g, ' ').replace(/^\w/, (letter: string) => letter.toUpperCase());

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
  const navigate = useNavigate();
  const [event, setEvent] = useState<EventRecord | null>(null);
  const [audit, setAudit] = useState<AuditRecord[]>([]);
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
  const deleteDialog = useRef<HTMLDialogElement>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [deleteAcknowledged, setDeleteAcknowledged] = useState(false);
  const [deletePending, setDeletePending] = useState(false);
  const [deleteError, setDeleteError] = useState('');
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

  const load = async () => {
    setLoading(true); setError('');
    try {
      const detail = await eventApi.get(eventId); setEvent(detail);
      if (detail.canManage) void refreshAudit(detail.eventId);
    } catch (cause) { setError(getApiMessage(cause, 'Event details could not be loaded.')); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [eventId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const dialog = deleteDialog.current;
    if (!dialog) return;
    if (deleteOpen && !dialog.open) dialog.showModal();
    if (!deleteOpen && dialog.open) dialog.close();
  }, [deleteOpen]);

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

  const closeDeleteDialog = () => {
    setDeleteOpen(false);
    setDeleteConfirmation('');
    setDeleteAcknowledged(false);
    setDeleteError('');
  };

  const deleteEvent = async (submitEvent: FormEvent<HTMLFormElement>) => {
    submitEvent.preventDefault();
    if (!event || deleteConfirmation !== event.name || !deleteAcknowledged) return;
    setDeletePending(true);
    setDeleteError('');
    try {
      await eventApi.delete(event.eventId, {
        version: event.version,
        confirmationName: deleteConfirmation,
        acknowledgePermanentDeletion: true,
      });
      window.sessionStorage.removeItem('vsms_event_id');
      navigate('/events', { replace: true });
    } catch (cause) {
      setDeleteError(getApiMessage(cause, 'The event could not be permanently deleted. Refresh and try again.'));
    } finally {
      setDeletePending(false);
    }
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
    if (!event || !draft.userId) return;
    if (draft.assignmentRole === 'SCREENER' && !draft.eventStationId) {
      setError('Choose an event station for the screener.');
      return;
    }
    setStaffingPending(true); setError('');
    try {
      const updated = await eventApi.assignStaff(event.eventId, shiftId, {
        version: event.version,
        userId: draft.userId,
        assignmentRole: draft.assignmentRole,
        eventStationId: draft.eventStationId || null,
      });
      setEvent(updated);
      setAssignmentDrafts((current) => ({ ...current, [shiftId]: emptyAssignment }));
      setNotice('Staff schedule updated.');
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
      setNotice('Station imported into the event route.');
      void refreshAudit(event.eventId);
    } catch (cause) { setError(getApiMessage(cause, 'The station could not be imported.')); }
    finally { setStationPending(''); }
  };

  const updateStation = async (eventStationId: string, changes: { stationOrder?: number; capacity?: number; isAvailable?: boolean }) => {
    if (!event) return;
    setStationPending(eventStationId); setError('');
    try {
      setEvent(await eventApi.updateStation(event.eventId, eventStationId, { version: event.version, ...changes }));
      setNotice('Station configuration updated.');
      void refreshAudit(event.eventId);
    } catch (cause) { setError(getApiMessage(cause, 'The station configuration could not be saved.')); }
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
  const canConfigureStations = canManage && ['DRAFT', 'PUBLISHED', 'IN_PROGRESS'].includes(event.status);
  const canEditStaffing = canManage && ['DRAFT', 'PUBLISHED', 'IN_PROGRESS'].includes(event.status);
  const availableTemplates = stationTemplates.filter((template) => !event.eventStations.some((station) => station.stationTemplateId === template.stationTemplateId));
  const canCancel = canManage && !terminal && (event.status !== 'IN_PROGRESS' || user?.systemRole === 'ADMIN');
  const isAdministrator = user?.roles.includes('ADMINISTRATOR') ?? false;
  const canPermanentlyDelete = terminal && user?.systemRole === 'ADMIN' && isAdministrator;
  const canReview = !isAdministrator && user?.roles.includes('REVIEWER') && event.status === 'IN_PROGRESS' && event.shifts.some((shift) => (
    shift.status === 'ACTIVE' && shift.staffAssignments.some((assignment) => (
      assignment.assignmentRole === 'REVIEWER'
      && ['ASSIGNED', 'CONFIRMED'].includes(assignment.status)
      && assignment.user.userId === user?.userId
    ))
  ));
  const assignedStationTypes = new Set(!isAdministrator && user?.roles.includes('SCREENER') ? event.shifts.flatMap((shift) => shift.staffAssignments.flatMap((assignment) => {
    if (shift.status !== 'ACTIVE'
      || assignment.assignmentRole !== 'SCREENER'
      || !['ASSIGNED', 'CONFIRMED'].includes(assignment.status)
      || assignment.user.userId !== user?.userId
      || !assignment.eventStation) return [];
    const station = event.eventStations.find((candidate) => candidate.eventStationId === assignment.eventStation?.eventStationId);
    return station ? [station.stationType] : [];
  })) : []);
  const activeStage = lifecycleStages.findIndex((stage) => stage.status === event.status);
  const totalRequiredStaff = event.shifts.reduce((total, shift) => total + shift.requiredStaff, 0);
  const next = nextAction[event.status];
  const routeSection = location.pathname.split('/').filter(Boolean).pop();
  const requestedView = routeSection && ['stations', 'staff', 'activity'].includes(routeSection) ? routeSection : 'overview';
  const view = canManage ? requestedView : 'overview';
  const eventPath = `/events/${event.eventId}`;

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
            {terminal && canManage && <Link className="secondary compact" to="/events/new" state={{ duplicateFrom: event }}><DocumentDuplicateIcon />Duplicate event</Link>}
          </div>
        </div>

        <div className="event-role-actions">
          {assignedStationTypes.has('VISUAL_ACUITY') && <Link className="primary" to={`${eventPath}/stations/visual-acuity`}>Open Visual Acuity station</Link>}
          {assignedStationTypes.has('REFRACTION') && <Link className="primary" to={`${eventPath}/stations/refraction`}>Open Refraction station</Link>}
          {assignedStationTypes.has('COLOUR_VISION') && <Link className="primary" to={`${eventPath}/stations/colour-vision`}>Open Colour Vision station</Link>}
          {canReview && <Link className="secondary" to={`${eventPath}/reviews`}><ClipboardDocumentCheckIcon />Open clinical review</Link>}
        </div>
      </div>
    </section>

    {canManage && <nav className="event-detail-tabs" aria-label="Event sections">
      <Link className={view === 'overview' ? 'active' : undefined} to={eventPath}>Overview</Link>
      <Link className={view === 'stations' ? 'active' : undefined} to={`${eventPath}/stations`}>Stations</Link>
      <Link className={view === 'staff' ? 'active' : undefined} to={`${eventPath}/staff`}>Staff</Link>
      <Link className={view === 'activity' ? 'active' : undefined} to={`${eventPath}/activity`}>Activity</Link>
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
      <div className="event-view-heading"><h2>Overview</h2>{canManage && !terminal && <Link className="secondary compact" to={`${eventPath}/edit`}><PencilSquareIcon />Edit overview</Link>}</div>
      <section className="event-metric-grid" aria-label="Event overview">
        <div className="event-info-row"><CalendarDaysIcon /><div><small>Date and time</small><strong>{dateParts.weekday}, {dateParts.month} {dateParts.day}, {dateParts.year}</strong><span>{formatTime(event.startsAt, event.timezone)} to {formatTime(event.endsAt, event.timezone)}, {eventDuration(event.startsAt, event.endsAt)}</span></div></div>
        <div className="event-info-row"><MapPinIcon /><div><small>Venue</small><strong>{event.venue}</strong><span>{event.address || 'Address entered manually'}{event.postalCode ? ` · Singapore ${event.postalCode}` : ''} · {event.timezone}</span></div></div>
        {canManage && <div className="event-info-row"><UserGroupIcon /><div><small>At venue now</small><strong>{event.activeCapacityCount.toLocaleString()} of {event.capacity.toLocaleString()} people</strong><span>Signed up or checked in</span></div></div>}
        {canManage && <div className="event-info-row"><ClipboardDocumentListIcon /><div><small>Expected</small><strong>{event.expectedAttendance?.toLocaleString() || 'Not set'} visitors</strong><span>{event.signupCount.toLocaleString()} signups collected</span></div></div>}
        <div className="event-info-row"><ClockIcon /><div><small>Staffing plan</small><strong>{event.shifts.length} {event.shifts.length === 1 ? 'shift' : 'shifts'}, {totalRequiredStaff} required</strong><span>Event operations coverage</span></div></div>
      </section>
      <section className="lifecycle" aria-labelledby="lifecycle-title">
        <div className="lifecycle-heading"><h2 id="lifecycle-title">Event lifecycle</h2><span>{event.status === 'CANCELLED' ? 'Cancelled before completion' : `${STATUS_LABEL[event.status]} stage`}</span></div>
        <ol className={event.status === 'CANCELLED' ? 'is-cancelled' : ''}>{lifecycleStages.map((stage, index) => <li className={index < activeStage ? 'complete' : index === activeStage ? 'current' : ''} key={stage.status}><i>{index < activeStage ? <CheckIcon /> : null}</i><span>{stage.label}</span></li>)}</ol>
      </section>
      {event.status === 'CANCELLED' && <section className="cancellation"><strong>Cancellation reason</strong><p>{event.cancellationReason}</p></section>}
      {canPermanentlyDelete && <section className="event-danger-zone" aria-labelledby="event-danger-zone-title">
        <div><h2 id="event-danger-zone-title">Danger zone</h2><p>This completed event can be permanently deleted. Its event-owned operational records will be removed; shared accounts and participant profiles will remain.</p></div>
        <button className="danger-button compact" type="button" onClick={() => setDeleteOpen(true)}><TrashIcon />Delete event</button>
      </section>}
    </div>}

    {view === 'stations' && <section className="event-view station-section" aria-labelledby="stations-title">
          <div className="section-title">
            <div><h2 id="stations-title">Event stations</h2><p>Availability follows the event’s scheduled days.</p></div>
            {canConfigureStations && <button className="secondary compact" type="button" aria-expanded={stationPanelOpen} aria-controls="station-template-panel" onClick={() => void openStationTemplates()}><PlusIcon />Import station</button>}
          </div>
          {stationPanelOpen && <div className="station-template-panel" id="station-template-panel" aria-live="polite">
            <div><strong>Station templates</strong><span>Importing creates an event-owned copy. Changes here will not alter the reusable template.</span></div>
            {stationLoading ? <p>Loading station templates…</p> : stationTemplatesError ? <div className="inline-retry" role="alert"><p>{stationTemplatesError}</p><button className="secondary compact" type="button" onClick={() => void loadStationTemplates()}>Retry</button></div> : stationTemplatesLoaded && availableTemplates.length === 0 ? <p>All active station templates are already in this event.</p> : <ul>{availableTemplates.map((template) => <li key={template.stationTemplateId}><span><strong>{template.name}</strong><small>{template.description || 'No template description.'} · Default capacity {template.defaultCapacity}</small></span><button className="secondary compact" type="button" disabled={!!stationPending} onClick={() => void importStation(template.stationTemplateId)}>{stationPending === template.stationTemplateId ? 'Importing…' : 'Import'}</button></li>)}</ul>}
          </div>}
          {event.eventStations.length === 0 ? <p className="quiet-empty">{canConfigureStations ? 'No stations imported yet. Import a template to build the screening route.' : 'No stations are configured for this event.'}</p> : <div className="station-table">{event.eventStations.map((station, index) => <article className={`station-record ${station.isAvailable ? '' : 'is-unavailable'}`} key={station.eventStationId}>
            <div className="station-order"><strong>{station.stationOrder}</strong><span>Route order</span></div>
            <div className="station-record-copy"><strong>{station.name}</strong><span>{station.description || 'No station instructions.'}</span><small>Template v{station.templateVersion}</small><div className="station-day-list">{(station.availabilities.length ? station.availabilities : event.eventDays.map((day) => ({ eventStationAvailabilityId: `${station.eventStationId}-${day.eventDayId}`, eventDay: day, isAvailable: station.isAvailable, capacity: station.capacity }))).map((availability) => <span className={availability.isAvailable ? 'is-available' : 'is-unavailable'} key={availability.eventStationAvailabilityId}>{formatEventDate(availability.eventDay.date, event.timezone, false)} · {availability.isAvailable ? `${availability.capacity} places` : 'Unavailable'}</span>)}</div></div>
            {canConfigureStations ? <div className="station-controls">
              <div className="station-reorder" aria-label={`Change ${station.name} route order`}>
                <button className="icon-button" type="button" aria-label={`Move ${station.name} earlier`} disabled={index === 0 || !!stationPending} onClick={() => void updateStation(station.eventStationId, { stationOrder: station.stationOrder - 1 })}><ChevronUpIcon /></button>
                <button className="icon-button" type="button" aria-label={`Move ${station.name} later`} disabled={index === event.eventStations.length - 1 || !!stationPending} onClick={() => void updateStation(station.eventStationId, { stationOrder: station.stationOrder + 1 })}><ChevronDownIcon /></button>
              </div>
              <form className="station-capacity" noValidate onSubmit={(submitEvent) => saveStationCapacity(submitEvent, station.eventStationId)}>
                <label><span>Capacity</span><input key={`${station.eventStationId}-${station.capacity}`} name="capacity" type="number" min="1" max="1000" step="1" required defaultValue={station.capacity} aria-label={`${station.name} capacity`} aria-invalid={!!capacityErrors[station.eventStationId]} aria-describedby={capacityErrors[station.eventStationId] ? `capacity-error-${station.eventStationId}` : undefined} onInput={() => setCapacityErrors((current) => ({ ...current, [station.eventStationId]: '' }))} />{capacityErrors[station.eventStationId] && <span className="field-error" id={`capacity-error-${station.eventStationId}`} role="alert">{capacityErrors[station.eventStationId]}</span>}</label>
                <button className="secondary compact" type="submit" disabled={!!stationPending}>{stationPending === station.eventStationId ? 'Saving…' : 'Save'}</button>
              </form>
              <button className="secondary compact" type="button" disabled={!!stationPending} onClick={() => void updateStation(station.eventStationId, { isAvailable: !station.isAvailable })}>{station.isAvailable ? 'Mark unavailable' : 'Make available'}</button>
            </div> : <strong className="station-capacity-readonly">{station.capacity} concurrent</strong>}
          </article>)}</div>}
    </section>}

    {view === 'staff' && <section className="event-view shift-section" aria-labelledby="shift-title">
        <div className="section-title"><h2 id="shift-title">Shifts</h2><span>{event.shifts.length} scheduled</span></div>
        {event.shifts.length === 0 ? <p className="quiet-empty">No shifts have been added. The event can still be saved as a draft.</p> : <div className="shift-table">{event.shifts.map((shift) => {
          const draft = assignmentDrafts[shift.shiftId] ?? emptyAssignment;
          const selectedStaff = staffDirectory.find((person) => person.userId === draft.userId);
          const compatibleRoles = selectedStaff
            ? assignmentRoles.filter((role) => selectedStaff.roles.includes(applicationRoleByAssignment[role]))
            : [];
          return <article className="shift-record" key={shift.shiftId}>
            <div className="shift-record-summary"><span><strong>{shift.name}</strong><small>{STATUS_LABEL[shift.status as keyof typeof STATUS_LABEL] ?? shift.status.toLowerCase()}</small></span><span><small>Schedule</small>{formatTime(shift.startsAt, event.timezone)}–{formatTime(shift.endsAt, event.timezone)}</span><span><small>Coverage</small>{shift.staffAssignments.length} of {shift.requiredStaff} assigned</span>{canEditStaffing && <button className="secondary compact" type="button" aria-expanded={staffingOpen === shift.shiftId} onClick={() => void openStaffing(shift.shiftId)}><PlusIcon />Assign</button>}</div>
            {shift.staffAssignments.length > 0 ? <ul className="assignment-list">{shift.staffAssignments.map((assignment) => <li key={assignment.staffAssignmentId}><span><strong>{getDisplayName(assignment.user.username)}</strong><small>{roleLabel(assignment.assignmentRole)}{assignment.eventStation ? ` · ${assignment.eventStation.name}` : ''}</small></span>{canEditStaffing && <button className="assignment-remove" type="button" aria-label={`Remove ${getDisplayName(assignment.user.username)} from ${shift.name}`} title={`Remove ${getDisplayName(assignment.user.username)}`} onClick={() => void removeStaff(shift.shiftId, assignment.staffAssignmentId)} disabled={staffingPending}><TrashIcon /></button>}</li>)}</ul> : <p className="shift-empty">No staff assigned to this shift.</p>}
            {canEditStaffing && staffingOpen === shift.shiftId && <form className="staffing-editor" onSubmit={(submitEvent) => { submitEvent.preventDefault(); void assignStaff(shift.shiftId); }}>
              {directoryLoading ? <p>Loading available staff…</p> : directoryError ? <div className="inline-retry" role="alert"><p>{directoryError}</p><button className="secondary compact" type="button" onClick={() => void loadStaffDirectory()}>Retry</button></div> : directoryLoaded && staffDirectory.length === 0 ? <p>No active staff members are available.</p> : <>
                <label><span>Staff member</span><select required value={draft.userId} disabled={staffingPending} onChange={(change) => { const person = staffDirectory.find((candidate) => candidate.userId === change.target.value); const role = assignmentRoles.find((candidate) => person?.roles.includes(applicationRoleByAssignment[candidate])) ?? 'SUPPORT'; updateAssignmentDraft(shift.shiftId, { userId: change.target.value, assignmentRole: role, eventStationId: role === 'SCREENER' ? draft.eventStationId : '' }); }}><option value="">Choose staff</option>{staffDirectory.map((person) => <option value={person.userId} key={person.userId}>{getDisplayName(person.username)} · {person.roles.map(roleLabel).join(', ')}</option>)}</select></label>
                <label><span>Shift role</span><select value={draft.assignmentRole} disabled={staffingPending || !draft.userId} onChange={(change) => updateAssignmentDraft(shift.shiftId, { assignmentRole: change.target.value as StaffAssignmentRole })}>{compatibleRoles.map((role) => <option value={role} key={role}>{roleLabel(role)}</option>)}</select></label>
                <label><span>Station {draft.assignmentRole === 'SCREENER' ? '(required)' : '(optional)'}</span><select required={draft.assignmentRole === 'SCREENER'} value={draft.eventStationId} disabled={staffingPending} onChange={(change) => updateAssignmentDraft(shift.shiftId, { eventStationId: change.target.value })}><option value="">No station</option>{event.eventStations.filter((station) => station.isAvailable).map((station) => <option value={station.eventStationId} key={station.eventStationId}>{station.stationOrder}. {station.name}</option>)}</select></label>
                <button className="primary compact" type="submit" disabled={staffingPending || !draft.userId || (draft.assignmentRole === 'SCREENER' && !draft.eventStationId)}>{staffingPending ? 'Saving…' : 'Save assignment'}</button>
              </>}
            </form>}
          </article>;
        })}</div>}
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
      <div className="app-dialog-actions">
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
      <form className="app-dialog-form" noValidate onSubmit={(submitEvent) => { submitEvent.preventDefault(); void cancel(); }}>
        <label className="app-dialog-field"><span>Cancellation reason</span><textarea required minLength={10} maxLength={500} rows={4} value={cancellationReason} data-dialog-autofocus aria-invalid={!!cancellationError} aria-describedby={cancellationError ? 'event-cancellation-help event-cancellation-error' : 'event-cancellation-help'} onChange={(change) => { setCancellationReason(change.target.value); setCancellationError(''); }} /></label>
        <p className="app-dialog-help" id="event-cancellation-help">{cancellationReason.length}/500 characters</p>
        {cancellationError && <p className="app-dialog-error" id="event-cancellation-error" role="alert">{cancellationError}</p>}
        <div className="app-dialog-actions"><button className="secondary" type="button" disabled={pending} onClick={() => { setCancelOpen(false); setCancellationReason(''); setCancellationError(''); }}>Keep event</button><button className="danger-button" type="submit" disabled={pending}>{pending ? 'Cancelling…' : 'Cancel event'}</button></div>
      </form>
    </AppDialog>
    <dialog className="event-delete-dialog" ref={deleteDialog} aria-labelledby="event-delete-title" onClose={() => setDeleteOpen(false)}>
      <form method="dialog" onSubmit={(submitEvent) => void deleteEvent(submitEvent)}>
        <div className="event-delete-dialog-heading"><div><span>Permanent deletion</span><h2 id="event-delete-title">Delete {event.name}?</h2></div><button className="icon-button" type="button" onClick={closeDeleteDialog} aria-label="Close delete event confirmation"><XMarkIcon /></button></div>
        <p>This cannot be undone. Type the event name and acknowledge the deletion to continue.</p>
        <label><span>Event name</span><input value={deleteConfirmation} autoFocus onChange={(change) => setDeleteConfirmation(change.target.value)} aria-describedby="event-delete-name-help" /></label>
        <small id="event-delete-name-help">Type <strong>{event.name}</strong> exactly.</small>
        <label className="event-delete-acknowledgement"><input type="checkbox" checked={deleteAcknowledged} onChange={(change) => setDeleteAcknowledged(change.target.checked)} /><span>I understand that this permanently deletes this event’s operational records.</span></label>
        {deleteError && <p className="event-delete-error" role="alert">{deleteError}</p>}
        <div className="event-delete-dialog-actions"><button className="secondary" type="button" onClick={closeDeleteDialog}>Cancel</button><button className="danger-button" type="submit" disabled={deletePending || deleteConfirmation !== event.name || !deleteAcknowledged}>{deletePending ? 'Deleting…' : 'Permanently delete'}</button></div>
      </form>
    </dialog>
  </div>;
}
