import {
  ArrowDownTrayIcon,
  ArrowLeftIcon,
  ArrowTopRightOnSquareIcon,
  ArrowUpTrayIcon,
  CalendarDaysIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ClipboardDocumentCheckIcon,
  ClockIcon,
  DocumentDuplicateIcon,
  MapPinIcon,
  PhotoIcon,
  PencilSquareIcon,
  PlusIcon,
  QueueListIcon,
  TrashIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider';
import { getApiError as getApiMessage } from '../../utils/apiClient';
import { getDisplayName } from '../../utils/identity';
import {
  eventApi,
  formatEventDate,
  STATUS_LABEL,
  type AuditRecord,
  type EventAttendee,
  type EventMetrics,
  type EventRecord,
  type StaffAssignmentRole,
  type StaffDirectoryEntry,
  type StationTemplate,
} from './eventApi';
import { EVENT_BANNERS, getEventArtwork, type EventBannerKey } from './eventBanners';
import './EventWorkspace.css';

type AssignmentDraft = { userId: string; assignmentRole: StaffAssignmentRole; eventStationId: string };
type WorkspaceTab = 'overview' | 'attendees' | 'operations' | 'settings';

const emptyAssignment: AssignmentDraft = { userId: '', assignmentRole: 'SUPPORT', eventStationId: '' };
const assignmentRoles: StaffAssignmentRole[] = ['EVENT_MANAGER', 'REGISTRATION', 'SCREENER', 'REVIEWER', 'SUPPORT'];
const tabs: Array<{ id: WorkspaceTab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'attendees', label: 'Attendees' },
  { id: 'operations', label: 'Operations' },
  { id: 'settings', label: 'Settings' },
];
const lifecycleStages = [
  { status: 'DRAFT', label: 'Draft' },
  { status: 'PUBLISHED', label: 'Published' },
  { status: 'IN_PROGRESS', label: 'Live' },
  { status: 'COMPLETED', label: 'Past' },
] as const;
const nextAction: Record<string, { action: 'publish' | 'start' | 'complete'; label: string; prompt: string } | undefined> = {
  DRAFT: { action: 'publish', label: 'Publish event', prompt: 'Publish this event? Staff with access will see it as ready for operations.' },
  PUBLISHED: { action: 'start', label: 'Start operations', prompt: 'Start operations now? Planned shifts will become active.' },
  IN_PROGRESS: { action: 'complete', label: 'Complete event', prompt: 'Complete this event? This is a terminal action and cannot be undone.' },
};

const roleLabel = (role: string) => role.toLowerCase().replace(/_/g, ' ').replace(/^\w/, (letter) => letter.toUpperCase());
const formatTime = (value: string, timezone: string) => new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZone: timezone }).format(new Date(value));
const formatDay = (value: string) => new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`));

function eventDuration(startsAt: string, endsAt: string) {
  const minutes = Math.max(0, Math.round((new Date(endsAt).getTime() - new Date(startsAt).getTime()) / 60_000));
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours} hr${minutes % 60 ? ` ${minutes % 60} min` : ''}` : `${minutes} min`;
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div className="workspace-metric"><strong>{value}</strong><span>{label}</span><small>{detail}</small></div>;
}

function MetricsStatus({ loading, error, onRetry }: { loading: boolean; error: string; onRetry: () => void }) {
  if (loading) return <div className="workspace-inline-error" aria-live="polite"><p>Loading operational metrics…</p></div>;
  return <div className="workspace-inline-error" role="alert"><p>Operational metrics unavailable. {error}</p><button type="button" onClick={onRetry}>Try again</button></div>;
}

export default function EventDetailPage() {
  const { eventId = '' } = useParams();
  const { session } = useAuth();
  const user = session?.user;
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get('tab');
  const activeTab: WorkspaceTab = tabs.some((tab) => tab.id === requestedTab) ? requestedTab as WorkspaceTab : 'overview';
  const [event, setEvent] = useState<EventRecord | null>(null);
  const [metrics, setMetrics] = useState<EventMetrics | null>(null);
  const [metricsLoading, setMetricsLoading] = useState(true);
  const [metricsError, setMetricsError] = useState('');
  const [audit, setAudit] = useState<AuditRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState((location.state as { notice?: string } | null)?.notice ?? '');
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
  const [attendees, setAttendees] = useState<EventAttendee[]>([]);
  const [attendeeTotal, setAttendeeTotal] = useState(0);
  const [attendeeNextCursor, setAttendeeNextCursor] = useState<string | null>(null);
  const [attendeeLoading, setAttendeeLoading] = useState(false);
  const [attendeeError, setAttendeeError] = useState('');
  const [attendeeSearch, setAttendeeSearch] = useState('');
  const [appliedAttendeeSearch, setAppliedAttendeeSearch] = useState('');
  const [attendeeStatus, setAttendeeStatus] = useState<EventAttendee['registrationStatus'] | ''>('');
  const [exportPending, setExportPending] = useState(false);
  const [exportReceipt, setExportReceipt] = useState('');
  const [deletePending, setDeletePending] = useState(false);
  const [deleteName, setDeleteName] = useState('');
  const [cancelReason, setCancelReason] = useState('');
  const [cancelError, setCancelError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const deleteDialog = useRef<HTMLDialogElement>(null);
  const cancelDialog = useRef<HTMLDialogElement>(null);
  const attendeeRequestId = useRef(0);
  const metricsRequestId = useRef(0);
  const auditRequestId = useRef(0);
  const applyEventUpdate = (updated: EventRecord) => { setEvent(updated); setExportReceipt(''); };

  const refreshAudit = useCallback(async (id = eventId) => {
    const requestId = ++auditRequestId.current;
    setAuditLoading(true); setAuditError('');
    try {
      const result = await eventApi.audit(id);
      if (requestId === auditRequestId.current) setAudit(result.auditLogs);
    } catch (cause) {
      if (requestId === auditRequestId.current) setAuditError(getApiMessage(cause, 'Activity could not be loaded.'));
    } finally {
      if (requestId === auditRequestId.current) setAuditLoading(false);
    }
  }, [eventId]);

  const loadMetrics = useCallback(async (id = eventId) => {
    const requestId = ++metricsRequestId.current;
    setMetricsLoading(true); setMetricsError(''); setMetrics(null);
    try {
      const result = await eventApi.metrics(id);
      if (requestId === metricsRequestId.current) setMetrics(result);
    } catch (cause) {
      if (requestId === metricsRequestId.current) setMetricsError(getApiMessage(cause, 'Metrics could not be loaded.'));
    } finally {
      if (requestId === metricsRequestId.current) setMetricsLoading(false);
    }
  }, [eventId]);

  const loadAttendees = useCallback(async (params?: { cursor?: string; status?: EventAttendee['registrationStatus']; search?: string }, append = false) => {
    const requestId = ++attendeeRequestId.current;
    setAttendeeLoading(true); setAttendeeError('');
    try {
      const result = await eventApi.attendees(eventId, { ...params, limit: 50 });
      if (requestId !== attendeeRequestId.current) return;
      setAttendees((current) => append ? [...current, ...result.attendees] : result.attendees);
      setAttendeeTotal(result.total); setAttendeeNextCursor(result.nextCursor);
    } catch (cause) {
      if (requestId === attendeeRequestId.current) setAttendeeError(getApiMessage(cause, 'Attendees could not be loaded.'));
    } finally {
      if (requestId === attendeeRequestId.current) setAttendeeLoading(false);
    }
  }, [eventId]);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setError(''); setEvent(null); setExportReceipt('');
    try {
      const detail = await eventApi.get(eventId, signal);
      if (signal?.aborted) return;
      setEvent(detail);
      if (detail.canManage) { void loadMetrics(detail.eventId); void refreshAudit(detail.eventId); }
      else { setMetricsLoading(false); setMetrics(null); setMetricsError(''); }
    } catch (cause) {
      if (!signal?.aborted) setError(getApiMessage(cause, 'Event details could not be loaded.'));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [eventId, loadMetrics, refreshAudit]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);
  useEffect(() => {
    const previousTitle = document.title;
    document.title = `${event?.name ?? (error ? 'Event unavailable' : 'Event workspace')} · VSMS`;
    return () => { document.title = previousTitle; };
  }, [error, event?.name]);
  useEffect(() => {
    if (activeTab === 'attendees' && event?.canManage) void loadAttendees({ status: attendeeStatus || undefined, search: appliedAttendeeSearch || undefined });
  }, [activeTab, appliedAttendeeSearch, attendeeStatus, event?.canManage, loadAttendees]);

  const transition = async () => {
    const next = event && nextAction[event.status];
    if (!event || !next || !window.confirm(next.prompt)) return;
    setPending(true); setError('');
    try {
      const updated = await eventApi.transition(event.eventId, next.action, event.version);
      applyEventUpdate(updated); setNotice(`${STATUS_LABEL[updated.status]} status saved.`); void refreshAudit(event.eventId); void loadMetrics(event.eventId);
    } catch (cause) { setError(getApiMessage(cause, 'The status could not be changed. Refresh and try again.')); }
    finally { setPending(false); }
  };

  const cancel = async () => {
    if (!event) return;
    const reason = cancelReason.trim();
    if (reason.length < 10) { setCancelError('Enter at least 10 characters so staff understand why the event was cancelled.'); return; }
    setPending(true); setCancelError('');
    try {
      const updated = await eventApi.cancel(event.eventId, event.version, reason);
      applyEventUpdate(updated); cancelDialog.current?.close(); setNotice('Event cancelled and reason recorded.'); void refreshAudit(event.eventId);
    } catch (cause) { setCancelError(getApiMessage(cause, 'The event could not be cancelled.')); }
    finally { setPending(false); }
  };

  const saveBanner = async () => {
    if (!event) return;
    setBannerPending(true); setError('');
    try {
      const updated = await eventApi.update(event.eventId, { version: event.version, bannerKey: selectedBannerKey, artworkDataUrl: artworkFile || null });
      applyEventUpdate(updated); setBannerOpen(false); setNotice('Event banner updated.'); void refreshAudit(event.eventId);
    } catch (cause) { setError(getApiMessage(cause, 'The banner could not be updated. Refresh and try again.')); }
    finally { setBannerPending(false); }
  };

  const chooseArtwork = (change: ChangeEvent<HTMLInputElement>) => {
    const file = change.target.files?.[0]; change.target.value = '';
    if (!file) return;
    if (!['image/jpeg', 'image/webp'].includes(file.type) || file.size > 130_000) { setError('Choose a JPEG or WebP image smaller than 130 KB.'); return; }
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

  const updateAssignmentDraft = (shiftId: string, changes: Partial<AssignmentDraft>) => setAssignmentDrafts((current) => ({ ...current, [shiftId]: { ...(current[shiftId] ?? emptyAssignment), ...changes } }));

  const assignStaff = async (shiftId: string) => {
    const draft = assignmentDrafts[shiftId] ?? emptyAssignment;
    if (!event || !draft.userId) return;
    if (draft.assignmentRole === 'SCREENER' && !draft.eventStationId) { setError('Choose an event station for the screener.'); return; }
    setStaffingPending(true); setError('');
    try {
      const updated = await eventApi.assignStaff(event.eventId, shiftId, { version: event.version, userId: draft.userId, assignmentRole: draft.assignmentRole, eventStationId: draft.eventStationId || null });
      applyEventUpdate(updated); setAssignmentDrafts((current) => ({ ...current, [shiftId]: emptyAssignment })); setNotice('Staff schedule updated.'); void refreshAudit(event.eventId);
    } catch (cause) { setError(getApiMessage(cause, 'The staff assignment could not be saved.')); }
    finally { setStaffingPending(false); }
  };

  const removeStaff = async (shiftId: string, assignmentId: string) => {
    if (!event) return;
    setStaffingPending(true); setError('');
    try { applyEventUpdate(await eventApi.removeStaff(event.eventId, shiftId, assignmentId, event.version)); setNotice('Staff assignment removed.'); void refreshAudit(event.eventId); }
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
    const opening = !stationPanelOpen; setStationPanelOpen(opening);
    if (opening && !stationTemplatesLoaded && !stationLoading) await loadStationTemplates();
  };

  const importStation = async (stationTemplateId: string) => {
    if (!event) return;
    setStationPending(stationTemplateId); setError('');
    try { applyEventUpdate(await eventApi.importStations(event.eventId, event.version, [stationTemplateId])); setNotice('Station imported into the participant route.'); void refreshAudit(event.eventId); }
    catch (cause) { setError(getApiMessage(cause, 'The station could not be imported.')); }
    finally { setStationPending(''); }
  };

  const updateStation = async (eventStationId: string, changes: { stationOrder?: number; capacity?: number; isAvailable?: boolean }) => {
    if (!event) return;
    setStationPending(eventStationId); setError('');
    try { applyEventUpdate(await eventApi.updateStation(event.eventId, eventStationId, { version: event.version, ...changes })); setNotice('Station configuration updated.'); void refreshAudit(event.eventId); }
    catch (cause) { setError(getApiMessage(cause, 'The station configuration could not be saved.')); }
    finally { setStationPending(''); }
  };

  const saveStationCapacity = (submitEvent: FormEvent<HTMLFormElement>, eventStationId: string) => {
    submitEvent.preventDefault();
    const input = submitEvent.currentTarget.elements.namedItem('capacity');
    if (!(input instanceof HTMLInputElement)) return;
    const capacity = input.valueAsNumber;
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 1000) { setCapacityErrors((current) => ({ ...current, [eventStationId]: 'Enter a whole number from 1 to 1,000.' })); input.focus(); return; }
    setCapacityErrors((current) => ({ ...current, [eventStationId]: '' })); void updateStation(eventStationId, { capacity });
  };

  const exportEvent = async () => {
    if (!event) return;
    setExportPending(true); setError('');
    try {
      const payload = await eventApi.exportEvent(event.eventId);
      setExportReceipt(payload.exportReceipt);
      const file = new Blob([JSON.stringify(payload.export, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(file);
      const link = document.createElement('a'); link.href = url; link.download = `${event.name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'event'}-export.json`; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 0);
      setNotice('Event export downloaded. Its receipt is available for 15 minutes while this page remains open.');
    } catch (cause) { setError(getApiMessage(cause, 'The event export could not be generated.')); }
    finally { setExportPending(false); }
  };

  const deleteEvent = async () => {
    if (!event || deleteName !== event.name || !exportReceipt || event.status !== 'DRAFT' || event.signupCount !== 0) return;
    setDeletePending(true); setError('');
    try {
      await eventApi.deleteEmptyDraft(event.eventId, { version: event.version, eventName: event.name, exportReceipt });
      deleteDialog.current?.close(); navigate('/events', { replace: true });
    } catch (cause) { setError(getApiMessage(cause, 'The draft could not be deleted. Generate a fresh export and try again.')); }
    finally { setDeletePending(false); }
  };

  if (loading) return <div className="event-workspace"><div className="workspace-loading" aria-live="polite"><p className="visually-hidden">Loading event workspace…</p><span /><span /><span /></div></div>;
  if (!event) return <div className="event-workspace"><div className="workspace-error"><h1>Event unavailable</h1><p>{error}</p><button type="button" onClick={() => void load()}>Try again</button><Link to="/events">Return to events</Link></div></div>;

  const terminal = event.status === 'COMPLETED' || event.status === 'CANCELLED';
  const canManage = event.canManage;
  const canConfigureStations = canManage && !terminal;
  const canEditStaffing = canManage && !terminal;
  const canCancel = canManage && !terminal && (event.status !== 'IN_PROGRESS' || user?.systemRole === 'ADMIN');
  const canReview = event.status === 'IN_PROGRESS' && event.shifts.some((shift) => shift.status === 'ACTIVE' && shift.staffAssignments.some((assignment) => assignment.assignmentRole === 'REVIEWER' && ['ASSIGNED', 'CONFIRMED'].includes(assignment.status) && assignment.user.userId === user?.userId));
  const availableTemplates = stationTemplates.filter((template) => !event.eventStations.some((station) => station.stationTemplateId === template.stationTemplateId));
  const next = nextAction[event.status];
  const totalRequiredStaff = event.shifts.reduce((total, shift) => total + shift.requiredStaff, 0);
  const totalAssignments = event.shifts.reduce((total, shift) => total + shift.staffAssignments.length, 0);
  const coveredPositions = event.shifts.reduce((total, shift) => total + Math.min(shift.requiredStaff, shift.staffAssignments.length), 0);
  const fullyStaffedShifts = event.shifts.filter((shift) => shift.staffAssignments.length >= shift.requiredStaff).length;
  const publishReady = event.eventStations.some((station) => station.isAvailable) && totalAssignments > 0;
  const transitionDisabled = pending || (next?.action === 'publish' && !publishReady);
  const activeStage = lifecycleStages.findIndex((stage) => stage.status === event.status);
  const canDelete = (user?.systemRole === 'ADMIN' || (user?.systemRole === 'EVENT_MANAGER' && event.createdByUserId === user.userId)) && event.status === 'DRAFT' && event.signupCount === 0 && Boolean(exportReceipt);
  const selectTab = (tab: WorkspaceTab) => setSearchParams(tab === 'overview' ? {} : { tab });
  const handleTabKeyDown = (keyboardEvent: ReactKeyboardEvent<HTMLElement>) => {
    const currentIndex = tabs.findIndex((tab) => tab.id === activeTab);
    const targetIndex = keyboardEvent.key === 'Home' ? 0
      : keyboardEvent.key === 'End' ? tabs.length - 1
      : keyboardEvent.key === 'ArrowRight' ? (currentIndex + 1) % tabs.length
      : keyboardEvent.key === 'ArrowLeft' ? (currentIndex - 1 + tabs.length) % tabs.length
      : currentIndex;
    if (targetIndex === currentIndex && !['Home', 'End', 'ArrowRight', 'ArrowLeft'].includes(keyboardEvent.key)) return;
    keyboardEvent.preventDefault();
    const target = tabs[targetIndex].id;
    selectTab(target);
    requestAnimationFrame(() => document.getElementById(`event-tab-${target}`)?.focus());
  };

  return <div className="event-workspace">
    <header className="event-workspace-hero">
      <Link className="workspace-back" to="/events"><ArrowLeftIcon aria-hidden="true" />Events</Link>
      <div className="workspace-identity">
        <img src={getEventArtwork(event.bannerKey, event.artworkDataUrl)} alt="" />
        <div><span className={`workspace-status status-${event.status.toLowerCase()}`}><i aria-hidden="true" />{STATUS_LABEL[event.status]}</span><h1>{event.name}</h1><p>{event.description || 'No event description has been added.'}</p></div>
      </div>
      <div className="workspace-quick-actions" aria-label="Event quick actions">
        {event.status !== 'DRAFT' && <Link to={`/e/${event.eventId}`} target="_blank" rel="noreferrer"><ArrowTopRightOnSquareIcon aria-hidden="true" />Public page</Link>}
        <Link to={`/events/${event.eventId}/queue`}><QueueListIcon aria-hidden="true" />Queue</Link>
        <Link to={`/events/${event.eventId}/stations/visual-acuity`}>Visual acuity</Link>
        {canReview && <Link to={`/events/${event.eventId}/reviews`}><ClipboardDocumentCheckIcon aria-hidden="true" />Review</Link>}
        {canManage && <Link className="workspace-action-primary" to={`/events/${event.eventId}/edit`}><PencilSquareIcon aria-hidden="true" />Edit full plan</Link>}
      </div>
    </header>

    {notice && <div className="workspace-notice" role="status"><CheckIcon aria-hidden="true" />{notice}<button type="button" onClick={() => setNotice('')} aria-label="Dismiss message"><XMarkIcon aria-hidden="true" /></button></div>}
    {error && <div className="workspace-alert" role="alert">{error}</div>}

    <nav className="workspace-tabs" role="tablist" aria-label="Event workspace sections" onKeyDown={handleTabKeyDown}>
      {tabs.map((tab) => <button key={tab.id} id={`event-tab-${tab.id}`} type="button" role="tab" aria-selected={activeTab === tab.id} aria-controls={`event-panel-${tab.id}`} tabIndex={activeTab === tab.id ? 0 : -1} onClick={() => selectTab(tab.id)}>{tab.label}</button>)}
    </nav>

    {activeTab === 'overview' && <section id="event-panel-overview" role="tabpanel" aria-labelledby="event-tab-overview" className="workspace-panel workspace-overview" tabIndex={-1}>
      <div className="workspace-two-column">
        <section className="workspace-section"><h2>When &amp; where</h2><div className="workspace-facts">
          <div><CalendarDaysIcon aria-hidden="true" /><span><small>Event time</small><strong>{formatEventDate(event.startsAt, event.timezone, false)}</strong><em>{formatTime(event.startsAt, event.timezone)}–{formatTime(event.endsAt, event.timezone)} · {eventDuration(event.startsAt, event.endsAt)} · {event.timezone}</em></span></div>
          <div><MapPinIcon aria-hidden="true" /><span><small>Location</small><strong>{event.venue}</strong><em>{event.address || 'Address entered manually'}{event.postalCode ? ` · ${event.postalCode}` : ''}</em></span></div>
          <div><ClockIcon aria-hidden="true" /><span><small>Event days</small><strong>{event.eventDays.length ? event.eventDays.map((day) => formatDay(day.date)).join(' · ') : 'Single-day event'}</strong><em>Operational dates and station availability follow this schedule.</em></span></div>
        </div></section>
        <section className="workspace-section"><h2>Operational metrics</h2>{metrics ? <div className="workspace-metrics">
          <Metric label="Signups" value={metrics.signupCount.toLocaleString()} detail="Registered for this event" />
          <Metric label="Checked in" value={metrics.checkedInCount.toLocaleString()} detail="Arrived at venue" />
          <Metric label="Active" value={metrics.activeCount.toLocaleString()} detail={`of ${event.capacity.toLocaleString()} capacity`} />
          <Metric label="Attendance" value={`${metrics.attendanceRatePercent}%`} detail="Checked in / non-cancelled signups" />
        </div> : <MetricsStatus loading={metricsLoading} error={metricsError} onRetry={() => void loadMetrics(event.eventId)} />}</section>
      </div>

      <div className="workspace-two-column workspace-overview-lower">
        <section className="workspace-section"><div className="workspace-section-heading"><h2>Lifecycle</h2>{canManage && !terminal && next && <button className="workspace-action-primary" type="button" disabled={transitionDisabled} onClick={() => void transition()}>{pending ? 'Saving…' : next.label}</button>}</div>
          <ol className={`workspace-lifecycle ${event.status === 'CANCELLED' ? 'is-cancelled' : ''}`}>{lifecycleStages.map((stage, index) => <li className={index < activeStage ? 'complete' : index === activeStage ? 'current' : ''} aria-current={index === activeStage ? 'step' : undefined} key={stage.status}><i>{index < activeStage ? <CheckIcon aria-hidden="true" /> : null}</i><span>{stage.label}</span></li>)}</ol>
          {event.status === 'DRAFT' && !publishReady && <p className="workspace-publish-requirement" role="status">Add at least one open station and assign at least one person before publishing.</p>}
          {event.status === 'CANCELLED' && <p className="workspace-cancellation"><strong>Cancellation reason:</strong> {event.cancellationReason || 'No reason recorded.'}</p>}
        </section>
        <section className="workspace-section workspace-activity"><div className="workspace-section-heading"><h2>Activity</h2>{canManage && <button type="button" onClick={() => void refreshAudit(event.eventId)}>Refresh</button>}</div>
          {!canManage ? <p>History is available to event managers and administrators.</p> : auditError ? <div className="workspace-inline-error" role="alert"><p>{auditError}</p><button type="button" onClick={() => void refreshAudit(event.eventId)}>Try again</button></div> : auditLoading && audit.length === 0 ? <p>Loading activity…</p> : audit.length ? <ol>{audit.map((item) => <li key={item.eventAuditLogId}><i aria-hidden="true" /><span><strong>{roleLabel(item.action)}</strong><small>{item.actor?.email ?? 'System actor'} · {formatEventDate(item.createdAt, event.timezone)}</small></span></li>)}</ol> : <p>No history is available.</p>}
        </section>
      </div>
      {metrics && <section className="workspace-section workspace-outcome-summary"><div className="workspace-section-heading"><div><h2>Outcome summary</h2><p>Aggregate operational benefit without exposing participant clinical details.</p></div></div><div className="workspace-metrics attendee-metrics"><Metric label="Screening results" value={metrics.screeningResultCount.toLocaleString()} detail="Measurements recorded" /><Metric label="Completed" value={metrics.completedCount.toLocaleString()} detail="Participant workflows finished" /><Metric label="Flagged results" value={metrics.flaggedResultCount.toLocaleString()} detail="Results needing review" /><Metric label="Referrals" value={metrics.referralCount.toLocaleString()} detail="Follow-up pathways created" /></div></section>}
    </section>}

    {activeTab === 'attendees' && <section id="event-panel-attendees" role="tabpanel" aria-labelledby="event-tab-attendees" className="workspace-panel" tabIndex={-1}>
      <div className="workspace-section-heading"><div><h2>Attendees</h2><p>Manager-visible operational rows only.</p></div></div>
      {metrics ? <div className="workspace-metrics attendee-metrics"><Metric label="Signed up" value={metrics.signupCount.toLocaleString()} detail="Excluding cancellations" /><Metric label="Checked in" value={metrics.checkedInCount.toLocaleString()} detail="At venue" /><Metric label="Completed" value={metrics.completedCount.toLocaleString()} detail="Finished workflow" /><Metric label="Referrals" value={metrics.referralCount.toLocaleString()} detail="Follow-up required" /></div> : <MetricsStatus loading={metricsLoading} error={metricsError} onRetry={() => void loadMetrics(event.eventId)} />}
      {!canManage ? <section className="workspace-empty"><h3>Manager access required</h3><p>Attendee records are visible only to event managers and administrators.</p></section> : <>
        <form className="attendee-controls" onSubmit={(submitEvent) => { submitEvent.preventDefault(); setAppliedAttendeeSearch(attendeeSearch.trim()); }}>
          <label><span className="visually-hidden">Search attendees</span><input type="search" value={attendeeSearch} onChange={(change) => setAttendeeSearch(change.target.value)} placeholder="Search name or reference" /></label>
          <label><span className="visually-hidden">Filter attendee status</span><select value={attendeeStatus} onChange={(change) => setAttendeeStatus(change.target.value as EventAttendee['registrationStatus'] | '')}><option value="">All statuses</option><option value="SIGNED_UP">Signed up</option><option value="CHECKED_IN">Checked in</option><option value="COMPLETED">Completed</option><option value="CANCELLED">Cancelled</option></select></label>
          <button type="submit">Search</button>
        </form>
        {attendeeError ? <section className="workspace-empty" role="alert"><h3>Attendees could not be loaded</h3><p>{attendeeError}</p><button type="button" onClick={() => void loadAttendees({ status: attendeeStatus || undefined, search: appliedAttendeeSearch || undefined })}>Try again</button></section>
          : attendeeLoading && attendees.length === 0 ? <section className="workspace-empty" aria-live="polite"><h3>Loading attendees</h3></section>
          : attendees.length ? <>
            <p className="attendee-total">Showing {attendees.length.toLocaleString()} of {attendeeTotal.toLocaleString()} attendee{attendeeTotal === 1 ? '' : 's'}</p>
            <div className="attendee-table-wrap"><table className="attendee-table"><caption className="visually-hidden">Attendees registered for {event.name}</caption><thead><tr><th scope="col">Attendee</th><th scope="col">Status</th><th scope="col">Queue</th><th scope="col">Check-in</th><th scope="col">Registered</th></tr></thead><tbody>{attendees.map((attendee) => <tr key={attendee.registrationId}><td><strong>{attendee.participantDisplayName || 'Participant name unavailable'}</strong><small>{attendee.participantReference}</small></td><td><span className={`attendee-status status-${attendee.registrationStatus.toLowerCase()}`}>{roleLabel(attendee.registrationStatus)}</span></td><td>{attendee.queueNumber ?? '—'}</td><td>{attendee.checkedInAt ? formatEventDate(attendee.checkedInAt, event.timezone) : 'Not checked in'}</td><td>{formatEventDate(attendee.createdAt, event.timezone)}</td></tr>)}</tbody></table></div>
            {attendeeNextCursor && <div className="attendee-pagination"><button type="button" disabled={attendeeLoading} onClick={() => void loadAttendees({ cursor: attendeeNextCursor, status: attendeeStatus || undefined, search: appliedAttendeeSearch || undefined }, true)}>{attendeeLoading ? 'Loading…' : 'Load more attendees'}</button></div>}
          </> : <section className="workspace-empty"><h3>No attendees found</h3><p>Try another search or status filter.</p></section>}
      </>}
    </section>}

    {activeTab === 'operations' && <section id="event-panel-operations" role="tabpanel" aria-labelledby="event-tab-operations" className="workspace-panel workspace-operations" tabIndex={-1}>
      <section className="workspace-section"><div className="workspace-section-heading"><div><h2>Participant route</h2><p>Station order and daily availability.</p></div><div>{canConfigureStations && <button type="button" onClick={() => void openStationTemplates()} aria-expanded={stationPanelOpen} aria-controls="station-template-panel"><PlusIcon aria-hidden="true" />Import station</button>}{canManage && <Link to={`/events/${event.eventId}/edit`}>Edit full plan</Link>}</div></div>
        {stationPanelOpen && <div className="station-template-panel" id="station-template-panel" aria-live="polite"><div><strong>Station templates</strong><span>Importing creates an event-owned copy.</span></div>{stationLoading ? <p>Loading station templates…</p> : stationTemplatesError ? <div className="workspace-inline-error" role="alert"><p>{stationTemplatesError}</p><button type="button" onClick={() => void loadStationTemplates()}>Try again</button></div> : stationTemplatesLoaded && availableTemplates.length === 0 ? <p>All active station templates are already imported.</p> : <ul>{availableTemplates.map((template) => <li key={template.stationTemplateId}><span><strong>{template.name}</strong><small>{template.description || 'No template description.'} · Default capacity {template.defaultCapacity}</small></span><button type="button" disabled={!!stationPending} onClick={() => void importStation(template.stationTemplateId)}>{stationPending === template.stationTemplateId ? 'Importing…' : 'Import'}</button></li>)}</ul>}</div>}
        {event.eventStations.length === 0 ? <p className="workspace-empty-copy">No stations are configured for this event.</p> : <div className="station-list">{event.eventStations.map((station, index) => <article className={`station-record ${station.isAvailable ? '' : 'is-unavailable'}`} key={station.eventStationId}><div className="station-order"><strong>{station.stationOrder}</strong><span>Route</span></div><div className="station-record-copy"><strong>{station.name}</strong><span>{station.description || 'No station instructions.'}</span><small>{station.isAvailable ? 'Open' : 'Closed'} · Base capacity {station.capacity}</small><ul className="station-availability">{station.availabilities.length ? station.availabilities.map((availability) => <li key={availability.eventStationAvailabilityId}><strong>{formatDay(availability.eventDay.date)}</strong><span>{availability.isAvailable ? 'Open' : 'Closed'} · {availability.startsAt && availability.endsAt ? `${formatTime(availability.startsAt, event.timezone)}–${formatTime(availability.endsAt, event.timezone)}` : 'All day'} · Capacity {availability.capacity}</span></li>) : <li><span>No daily availability configured.</span></li>}</ul></div>{canConfigureStations ? <div className="station-controls"><div className="station-reorder" aria-label={`Change ${station.name} route order`}><button type="button" aria-label={`Move ${station.name} earlier`} disabled={index === 0 || !!stationPending} onClick={() => void updateStation(station.eventStationId, { stationOrder: station.stationOrder - 1 })}><ChevronUpIcon /></button><button type="button" aria-label={`Move ${station.name} later`} disabled={index === event.eventStations.length - 1 || !!stationPending} onClick={() => void updateStation(station.eventStationId, { stationOrder: station.stationOrder + 1 })}><ChevronDownIcon /></button></div><form className="station-capacity" noValidate onSubmit={(submitEvent) => saveStationCapacity(submitEvent, station.eventStationId)}><label>Capacity<input key={`${station.eventStationId}-${station.capacity}`} name="capacity" type="number" min="1" max="1000" required defaultValue={station.capacity} aria-label={`${station.name} capacity`} aria-invalid={!!capacityErrors[station.eventStationId]} onInput={() => setCapacityErrors((current) => ({ ...current, [station.eventStationId]: '' }))} /></label>{capacityErrors[station.eventStationId] && <span className="field-error" role="alert">{capacityErrors[station.eventStationId]}</span>}<button type="submit" disabled={!!stationPending}>{stationPending === station.eventStationId ? 'Saving…' : 'Save'}</button></form><button type="button" disabled={!!stationPending} onClick={() => void updateStation(station.eventStationId, { isAvailable: !station.isAvailable })}>{station.isAvailable ? 'Mark closed' : 'Make open'}</button></div> : null}</article>)}</div>}
      </section>

      <section className="workspace-section"><div className="workspace-section-heading"><div><h2>Shifts &amp; coverage</h2><p>{event.shifts.length} scheduled · {totalRequiredStaff} positions required.</p></div>{canManage && <Link to={`/events/${event.eventId}/edit`}>Edit full plan</Link>}</div>
        {event.shifts.length === 0 ? <p className="workspace-empty-copy">No shifts have been added.</p> : <><div className="workspace-metrics attendee-metrics"><Metric label="Positions covered" value={`${coveredPositions}/${totalRequiredStaff}`} detail="Required positions with an assignee" /><Metric label="Open positions" value={Math.max(0, totalRequiredStaff - coveredPositions).toLocaleString()} detail="Still need an assignee" /><Metric label="Fully staffed shifts" value={`${fullyStaffedShifts}/${event.shifts.length}`} detail="Meeting required manpower" /><Metric label="Assignments" value={totalAssignments.toLocaleString()} detail="Active staff placements" /></div><div className="shift-list">{event.shifts.map((shift) => { const draft = assignmentDrafts[shift.shiftId] ?? emptyAssignment; return <article className="shift-record" key={shift.shiftId}><div className="shift-record-summary"><span><strong>{shift.name}</strong><small>{shift.status.toLowerCase()}</small></span><span><small>Schedule</small>{formatTime(shift.startsAt, event.timezone)}–{formatTime(shift.endsAt, event.timezone)}</span><span><small>Coverage</small>{shift.staffAssignments.length} of {shift.requiredStaff} assigned</span>{canEditStaffing && <button type="button" aria-expanded={staffingOpen === shift.shiftId} onClick={() => void openStaffing(shift.shiftId)}><PlusIcon aria-hidden="true" />Assign</button>}</div>{shift.staffAssignments.length ? <ul className="assignment-list">{shift.staffAssignments.map((assignment) => <li key={assignment.staffAssignmentId}><span><strong>{getDisplayName(assignment.user.username)}</strong><small>{roleLabel(assignment.assignmentRole)}{assignment.eventStation ? ` · ${assignment.eventStation.name}` : ''}</small></span>{canEditStaffing && <button type="button" aria-label={`Remove ${getDisplayName(assignment.user.username)} from ${shift.name}`} onClick={() => void removeStaff(shift.shiftId, assignment.staffAssignmentId)} disabled={staffingPending}><TrashIcon aria-hidden="true" /></button>}</li>)}</ul> : <p className="workspace-empty-copy">No staff assigned.</p>}{canEditStaffing && staffingOpen === shift.shiftId && <form className="staffing-editor" onSubmit={(submitEvent) => { submitEvent.preventDefault(); void assignStaff(shift.shiftId); }}>{directoryLoading ? <p>Loading available staff…</p> : directoryError ? <div className="workspace-inline-error" role="alert"><p>{directoryError}</p><button type="button" onClick={() => void loadStaffDirectory()}>Try again</button></div> : directoryLoaded && staffDirectory.length === 0 ? <p>No active staff members are available.</p> : <><label>Staff member<select required value={draft.userId} disabled={staffingPending} onChange={(change) => updateAssignmentDraft(shift.shiftId, { userId: change.target.value })}><option value="">Choose staff</option>{staffDirectory.map((person) => <option value={person.userId} key={person.userId}>{getDisplayName(person.username)} · {roleLabel(person.systemRole === 'STAFF' ? 'SUPPORT' : person.systemRole)}</option>)}</select></label><label>Shift role<select value={draft.assignmentRole} disabled={staffingPending} onChange={(change) => updateAssignmentDraft(shift.shiftId, { assignmentRole: change.target.value as StaffAssignmentRole })}>{assignmentRoles.map((role) => <option value={role} key={role}>{roleLabel(role)}</option>)}</select></label><label>Station {draft.assignmentRole === 'SCREENER' ? '(required)' : '(optional)'}<select required={draft.assignmentRole === 'SCREENER'} value={draft.eventStationId} disabled={staffingPending} onChange={(change) => updateAssignmentDraft(shift.shiftId, { eventStationId: change.target.value })}><option value="">No station</option>{event.eventStations.filter((station) => station.isAvailable).map((station) => <option value={station.eventStationId} key={station.eventStationId}>{station.stationOrder}. {station.name}</option>)}</select></label><button type="submit" disabled={staffingPending || !draft.userId || (draft.assignmentRole === 'SCREENER' && !draft.eventStationId)}>{staffingPending ? 'Saving…' : 'Save assignment'}</button></>}</form>}</article>; })}</div></>}
      </section>
    </section>}

    {activeTab === 'settings' && <section id="event-panel-settings" role="tabpanel" aria-labelledby="event-tab-settings" className="workspace-panel workspace-settings" tabIndex={-1}>
      <section className="workspace-section"><div className="workspace-section-heading"><div><h2>Event artwork</h2><p>{event.artworkDataUrl ? 'Your uploaded artwork' : 'Default event artwork'}</p></div>{canManage && !terminal && <button type="button" onClick={() => { setSelectedBannerKey(event.bannerKey ?? 'COMMUNITY_SCREENING'); setArtworkFile(event.artworkDataUrl ?? ''); setBannerOpen((open) => !open); }}><PhotoIcon aria-hidden="true" />Change banner</button>}</div>
        {bannerOpen && !terminal && <div className="banner-picker" id="banner-picker"><input ref={fileInput} className="visually-hidden" type="file" accept="image/jpeg,image/webp" onChange={chooseArtwork} /><div className="banner-options" role="radiogroup" aria-label="Available event artwork">{EVENT_BANNERS.map((option) => <button className={`banner-option ${!artworkFile && selectedBannerKey === option.key ? 'selected' : ''}`} type="button" role="radio" aria-checked={!artworkFile && selectedBannerKey === option.key} key={option.key} onClick={() => { setSelectedBannerKey(option.key); setArtworkFile(''); }}><img src={option.src} alt="" /><span>{option.label}</span></button>)}<button className={`banner-option ${artworkFile ? 'selected' : ''}`} type="button" role="radio" aria-checked={!!artworkFile} onClick={() => fileInput.current?.click()}><ArrowUpTrayIcon aria-hidden="true" /><span>Upload image</span></button></div><div className="workspace-form-actions"><button type="button" onClick={() => setBannerOpen(false)}>Cancel</button><button className="workspace-action-primary" type="button" disabled={bannerPending} onClick={() => void saveBanner()}>{bannerPending ? 'Saving…' : 'Use selected artwork'}</button></div></div>}
      </section>
      <section className="workspace-section"><div className="workspace-section-heading"><div><h2>Event management</h2><p>Edit event days, slots, and full plan in the event editor.</p></div></div><div className="workspace-management-actions">{canManage && <Link className="workspace-action-primary" to={`/events/${event.eventId}/edit`}><PencilSquareIcon aria-hidden="true" />Edit full plan</Link>}{canManage && <button type="button" disabled={exportPending} onClick={() => void exportEvent()}><ArrowDownTrayIcon aria-hidden="true" />{exportPending ? 'Exporting…' : 'Export event'}</button>}{terminal && canManage && <Link to="/events/new" state={{ duplicateFrom: event }}><DocumentDuplicateIcon aria-hidden="true" />Duplicate event</Link>}{canManage && !terminal && next && <button type="button" disabled={transitionDisabled} onClick={() => void transition()}>{pending ? 'Saving…' : next.label}</button>}{canCancel && <button className="workspace-danger-button" type="button" disabled={pending} onClick={() => { setCancelReason(''); setCancelError(''); cancelDialog.current?.showModal(); }}>Cancel event</button>}</div></section>
      <section className="workspace-section workspace-danger-zone"><div><h2>Delete empty draft</h2><p>Deletion is available only for an unpopulated draft with no signups or consent records after a current export has been generated.</p></div><button type="button" disabled={!canDelete} onClick={() => { setDeleteName(''); setError(''); deleteDialog.current?.showModal(); }}><TrashIcon aria-hidden="true" />Delete draft</button>{!canDelete && <small>{event.status !== 'DRAFT' ? 'Only drafts can be deleted.' : event.signupCount ? 'Draft has signups and cannot be deleted.' : 'Export the event first to enable deletion.'}</small>}</section>
    </section>}

    <dialog className="delete-event-dialog" ref={cancelDialog} aria-labelledby="cancel-event-title"><form method="dialog" onSubmit={(submitEvent) => { submitEvent.preventDefault(); void cancel(); }}><h2 id="cancel-event-title">Cancel {event.name}?</h2><p>The reason is recorded in event history and helps staff respond consistently.</p><label>Cancellation reason<textarea autoFocus required minLength={10} maxLength={1000} rows={5} value={cancelReason} onChange={(change) => { setCancelReason(change.target.value); setCancelError(''); }} aria-invalid={Boolean(cancelError)} aria-describedby="cancel-event-help" /></label><small id="cancel-event-help">{cancelReason.length.toLocaleString()}/1,000 characters · minimum 10</small>{cancelError && <p className="dialog-error" role="alert">{cancelError}</p>}<div><button type="button" onClick={() => cancelDialog.current?.close()}>Keep event</button><button className="workspace-danger-button" type="submit" disabled={pending || cancelReason.trim().length < 10}>{pending ? 'Cancelling…' : 'Cancel event'}</button></div></form></dialog>
    <dialog className="delete-event-dialog" ref={deleteDialog} aria-labelledby="delete-event-title"><form method="dialog" onSubmit={(submitEvent) => { submitEvent.preventDefault(); void deleteEvent(); }}><h2 id="delete-event-title">Delete {event.name}?</h2><p>This permanently removes an empty draft. Type the exact event name to confirm.</p><label>Event name<input value={deleteName} onChange={(change) => setDeleteName(change.target.value)} autoComplete="off" /></label>{error && <p className="dialog-error" role="alert">{error}</p>}<div><button type="button" onClick={() => deleteDialog.current?.close()}>Keep draft</button><button className="workspace-danger-button" type="submit" disabled={deletePending || deleteName !== event.name}>{deletePending ? 'Deleting…' : 'Delete draft'}</button></div></form></dialog>
  </div>;
}
