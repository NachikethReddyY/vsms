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
import { RouteOverrideDialog } from '../../components/queue/RouteOverrideDialog';
import { getApiError as getApiMessage } from '../../utils/apiClient';
import { eventApi, formatEventDate, STATUS_LABEL, type AuditRecord, type EventAttendee, type EventMembership, type EventMetrics, type EventRecord, type EventStatus, type StaffAssignmentRole, type StationTemplate } from './eventApi';
import { getEventScheduleDays } from './eventDisplayStatus';
import { EVENT_BANNERS, getEventArtwork, type EventBannerKey } from './eventBanners';
import { managementPercent } from './eventReport';
import { findShiftConflicts } from './shiftAvailability';
import { customStationPath } from '../screening/stationConfig';

type AssignmentDraft = { userId: string; assignmentRole: StaffAssignmentRole; eventStationId: string };
type ShiftDraft = { name: string; startsAt: string; endsAt: string };
type NewShiftDraft = ShiftDraft & { date: string; requiredStaff: number };
const emptyAssignment: AssignmentDraft = { userId: '', assignmentRole: 'REGISTRATION', eventStationId: '' };
const assignmentRoles: StaffAssignmentRole[] = ['EVENT_MANAGER', 'REGISTRATION', 'SCREENER', 'REVIEWER', 'SUPPORT'];
const roleLabel = (role: string) => role.toLowerCase().replace(/_/g, ' ').replace(/^\w/, (letter: string) => letter.toUpperCase());
const toInstant = (date: string, time: string) => new Date(`${date}T${time}:00+08:00`).toISOString();
const scheduleOffset = (milliseconds: number) => {
  const minutes = Math.round(milliseconds / 60000);
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return [hours && `${hours}h`, remainder && `${remainder}m`].filter(Boolean).join(' ');
};

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

function dateKey(value: string, timezone: string) {
  const parts = new Intl.DateTimeFormat('en', {
    year: 'numeric', month: '2-digit', day: '2-digit', timeZone: timezone,
  }).formatToParts(new Date(value));
  const part = (type: string) => parts.find((item) => item.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
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
  const [attendeeRouteRegistrationId, setAttendeeRouteRegistrationId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [bannerPending, setBannerPending] = useState(false);
  const [bannerOpen, setBannerOpen] = useState(false);
  const [artworkFile, setArtworkFile] = useState('');
  const [selectedBannerKey, setSelectedBannerKey] = useState<EventBannerKey>('COMMUNITY_SCREENING');
  const [eventMembers, setEventMembers] = useState<EventMembership[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersLoaded, setMembersLoaded] = useState(false);
  const [membersError, setMembersError] = useState('');
  const [staffingOpen, setStaffingOpen] = useState<string | null>(null);
  const [staffingPending, setStaffingPending] = useState(false);
  const [assignmentDrafts, setAssignmentDrafts] = useState<Record<string, AssignmentDraft>>({});
  const [selectedStaffIds, setSelectedStaffIds] = useState<Record<string, string[]>>({});
  const [stationTemplates, setStationTemplates] = useState<StationTemplate[]>([]);
  const [stationPanelOpen, setStationPanelOpen] = useState(false);
  const [stationLoading, setStationLoading] = useState(false);
  const [stationTemplatesLoaded, setStationTemplatesLoaded] = useState(false);
  const [stationTemplatesError, setStationTemplatesError] = useState('');
  const [stationPending, setStationPending] = useState('');
  const [stationEditing, setStationEditing] = useState<string | null>(null);
  const [shiftPending, setShiftPending] = useState('');
  const [shiftCreateOpen, setShiftCreateOpen] = useState(false);
  const [shiftEditing, setShiftEditing] = useState<string | null>(null);
  const [shiftCreateDraft, setShiftCreateDraft] = useState<NewShiftDraft>({ date: '', name: '', startsAt: '09:00', endsAt: '17:00', requiredStaff: 1 });
  const [shiftDrafts, setShiftDrafts] = useState<Record<string, ShiftDraft>>({});
  const [newShiftDay, setNewShiftDay] = useState('');
  const [newShiftDrafts, setNewShiftDrafts] = useState<Record<string, ShiftDraft>>({});
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
      if (detail.canManage && detail.scope !== 'DEVICE_LOCAL') { void refreshAudit(detail.eventId); void loadMetrics(detail.eventId); }
    } catch (cause) { setError(getApiMessage(cause, 'Event details could not be loaded.')); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [eventId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (event?.canManage && location.pathname.endsWith('/attendees')) {
      if (event.scope === 'DEVICE_LOCAL') setAttendeeError('The full attendee roster is online-only. Queue and station participants remain available in their event-day workspaces.');
      else void loadAttendees();
    }
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

  const loadEventMembers = async () => {
    setMembersLoading(true); setMembersError('');
    try {
      const memberships = await eventApi.memberships(eventId);
      setEventMembers(memberships.filter((membership) => membership.status === 'ACTIVE'));
      setMembersLoaded(true);
    } catch (cause) { setMembersError(getApiMessage(cause, 'Event staff could not be loaded.')); setMembersLoaded(false); }
    finally { setMembersLoading(false); }
  };

  const assignStationScreener = async (shiftId: string, eventStationId: string, userId: string) => {
    if (!event || !userId) return;
    setStaffingPending(true); setError('');
    try {
      setEvent(await eventApi.assignStaff(event.eventId, shiftId, { version: event.version, userId, assignmentRole: 'SCREENER', eventStationId }));
      setNotice('Screener assigned to this station.');
      void refreshAudit(event.eventId);
    } catch (cause) { setError(getApiMessage(cause, 'The screener could not be assigned.')); }
    finally { setStaffingPending(false); }
  };

  const openStaffing = async (shiftId: string) => {
    const opening = staffingOpen !== shiftId;
    setStaffingOpen(opening ? shiftId : null);
    setAssignmentDrafts((current) => current[shiftId] ? current : { ...current, [shiftId]: emptyAssignment });
    if (opening && !membersLoaded && !membersLoading) await loadEventMembers();
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
      setStaffingOpen(null);
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
      const selectedStation = event.eventStations.find((station) => station.eventStationId === eventStationId);
      const capacity = selectedStation?.availabilities.find((availability) => availability.eventDay.date === day.date)?.capacity
        ?? selectedStation?.capacity
        ?? 1;
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

  const openShiftComposer = (key: string, startsAt: string, endsAt: string) => {
    setNewShiftDrafts((current) => ({ ...current, [key]: current[key] ?? {
      name: '',
      startsAt: formatTimeInput(startsAt, event?.timezone || 'Asia/Singapore'),
      endsAt: formatTimeInput(endsAt, event?.timezone || 'Asia/Singapore'),
    } }));
    setNewShiftDay(key);
  };

  const addDayShift = async (key: string, date: string) => {
    if (!event) return;
    const draft = newShiftDrafts[key];
    if (!draft?.name.trim() || draft.endsAt <= draft.startsAt) return;
    setShiftPending(date); setError('');
    try {
      const shifts = [...event.shifts.map((shift) => ({
        shiftId: shift.shiftId,
        name: shift.name,
        startsAt: shift.startsAt,
        endsAt: shift.endsAt,
        requiredStaff: shift.requiredStaff,
      })), { name: draft.name.trim(), startsAt: toInstant(date, draft.startsAt), endsAt: toInstant(date, draft.endsAt), requiredStaff: 1 }];
      setEvent(await eventApi.update(event.eventId, { version: event.version, shifts }));
      setNewShiftDay('');
      setNewShiftDrafts((current) => { const next = { ...current }; delete next[key]; return next; });
      setNotice('Shift added. You can now assign screeners.');
      void refreshAudit(event.eventId);
    } catch (cause) { setError(getApiMessage(cause, 'The shift could not be added.')); }
    finally { setShiftPending(''); }
  };

  const saveShift = async (shiftId: string) => {
    if (!event) return;
    const current = event.shifts.find((shift) => shift.shiftId === shiftId);
    if (!current) return;
    const draft = shiftDrafts[shiftId] ?? { name: current.name, startsAt: formatTimeInput(current.startsAt, event.timezone), endsAt: formatTimeInput(current.endsAt, event.timezone) };
    const date = dateKey(current.startsAt, event.timezone);
    setShiftPending(shiftId); setError('');
    try {
      const shifts = event.shifts.map((shift) => shift.shiftId === shiftId ? {
        shiftId,
        name: draft.name.trim(),
        startsAt: toInstant(date, draft.startsAt),
        endsAt: toInstant(date, draft.endsAt),
        requiredStaff: shift.requiredStaff,
      } : { shiftId: shift.shiftId, name: shift.name, startsAt: shift.startsAt, endsAt: shift.endsAt, requiredStaff: shift.requiredStaff });
      setEvent(await eventApi.update(event.eventId, { version: event.version, shifts }));
      setShiftDrafts((currentDrafts) => { const next = { ...currentDrafts }; delete next[shiftId]; return next; });
      setShiftEditing(null);
      setNotice('Shift updated.');
      void refreshAudit(event.eventId);
    } catch (cause) { setError(getApiMessage(cause, 'The shift could not be updated.')); }
    finally { setShiftPending(''); }
  };

  const deleteShift = async (shiftId: string, name: string) => {
    if (!event || !window.confirm(`Delete ${name}? Its staff assignments will also be removed.`)) return;
    setShiftPending(shiftId); setError('');
    try {
      const shifts = event.shifts.filter((shift) => shift.shiftId !== shiftId).map((shift) => ({
        shiftId: shift.shiftId,
        name: shift.name,
        startsAt: shift.startsAt,
        endsAt: shift.endsAt,
        requiredStaff: shift.requiredStaff,
      }));
      setEvent(await eventApi.update(event.eventId, { version: event.version, shifts }));
      setNotice('Shift deleted.');
      void refreshAudit(event.eventId);
    } catch (cause) { setError(getApiMessage(cause, 'The shift could not be deleted.')); }
    finally { setShiftPending(''); }
  };

  const openShiftCreator = () => {
    if (!event) return;
    const day = scheduleDays[0];
    setShiftCreateDraft({
      date: dateKey(day?.startsAt ?? event.startsAt, event.timezone),
      name: '',
      startsAt: formatTimeInput(day?.startsAt ?? event.startsAt, event.timezone),
      endsAt: formatTimeInput(day?.endsAt ?? event.endsAt, event.timezone),
      requiredStaff: 1,
    });
    setShiftCreateOpen(true);
  };

  const createShift = async () => {
    if (!event || !shiftCreateDraft.name.trim() || shiftCreateDraft.endsAt <= shiftCreateDraft.startsAt) return;
    setShiftPending('new'); setError('');
    try {
      setEvent(await eventApi.addShift(event.eventId, {
        version: event.version,
        name: shiftCreateDraft.name.trim(),
        startsAt: toInstant(shiftCreateDraft.date, shiftCreateDraft.startsAt),
        endsAt: toInstant(shiftCreateDraft.date, shiftCreateDraft.endsAt),
        requiredStaff: shiftCreateDraft.requiredStaff,
      }));
      setShiftCreateOpen(false);
      setNotice('Shift added. You can assign its team now.');
      void refreshAudit(event.eventId);
    } catch (cause) { setError(getApiMessage(cause, 'The shift could not be added.')); }
    finally { setShiftPending(''); }
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
  const scheduleDays = useMemo(() => event ? getEventScheduleDays(event.eventDays, event.startsAt, event.endsAt) : [], [event]);

  if (loading) return <div className="detail-loading" aria-live="polite" aria-label="Loading event"><span /><span /><span /></div>;
  if (!event || !dateParts) return <div className="center-state error-state"><h1>Event unavailable</h1><p>{error}</p><div className="error-state-actions"><button className="primary" type="button" onClick={() => void load()}>Try again</button><Link className="secondary" to="/events">Return to events</Link></div></div>;

  const terminal = event.status === 'COMPLETED' || event.status === 'CANCELLED';
  const deviceLocal = event.scope === 'DEVICE_LOCAL';
  const canManage = event.canManage;
  const canCreateEvent = user?.roles.includes('ADMINISTRATOR') ?? false;
  const canConfigureStations = canManage && !deviceLocal && ['DRAFT', 'PUBLISHED', 'IN_PROGRESS'].includes(event.status);
  const canEditStaffing = canManage && !deviceLocal && ['DRAFT', 'PUBLISHED', 'IN_PROGRESS'].includes(event.status);
  const availableTemplates = stationTemplates.filter((template) => {
    if (template.stationType === 'CUSTOM') {
      return !event.eventStations.some((station) => station.stationTemplateId === template.stationTemplateId);
    }
    return !event.eventStations.some((station) => station.stationType === template.stationType);
  });
  const canCancel = canManage && !deviceLocal && !terminal && (event.status !== 'IN_PROGRESS' || user?.systemRole === 'ADMIN');
  const isAdministrator = user?.roles.includes('ADMINISTRATOR') ?? false;
  const canRegisterParticipants = !isAdministrator && event.status === 'IN_PROGRESS' && event.shifts.some((shift) => (
    shift.status === 'ACTIVE' && shift.staffAssignments.some((assignment) => (
      assignment.assignmentRole === 'REGISTRATION'
      && ['ASSIGNED', 'CONFIRMED'].includes(assignment.status)
      && assignment.user.userId === user?.userId
    ))
  ));
  const canPermanentlyDelete = !deviceLocal && ['DRAFT', 'COMPLETED', 'CANCELLED'].includes(event.status) && user?.systemRole === 'ADMIN' && isAdministrator;
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
  const requestedView = routeSection && ['stations', 'shifts', 'staff', 'analytics', 'reports', 'attendees', 'activity'].includes(routeSection) ? routeSection : 'overview';
  const view = canManage ? requestedView : 'overview';
  const eventPath = `/events/${event.eventId}`;
  const staffingShift = event.shifts.find((shift) => shift.shiftId === staffingOpen);
  const staffingDraft = staffingShift ? assignmentDrafts[staffingShift.shiftId] ?? emptyAssignment : emptyAssignment;
  const staffingSelectedIds = staffingShift ? selectedStaffIds[staffingShift.shiftId] ?? [] : [];
  const eligibleStaff = eventMembers.filter((membership) => membership.roles.some(({ role }) => role === staffingDraft.assignmentRole));
  const conflictingShiftByUser = staffingShift ? findShiftConflicts(event.shifts, staffingShift, staffingDraft.eventStationId) : new Map();
  const availableStaff = eligibleStaff.filter(({ userId }) => !conflictingShiftByUser.has(userId));
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
            {canManage && !deviceLocal ? <details className="event-status-control">
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
          {assignedStationTypes.has('EYE_HEALTH') && <Link className="primary" to={`${eventPath}/stations/eye-health`}>Open Eye Health station</Link>}
          {assignedStations.filter((station) => station.stationType === 'CUSTOM').map((station) => <Link className="primary" key={station.eventStationId} to={customStationPath(event.eventId, station.eventStationId)}>Open {station.name}</Link>)}
          {assignedStationTypes.size > 0 && <Link className="secondary" to={`${eventPath}/qr-scanner`}>Scan QR → station</Link>}
          {canReview && <Link className="secondary" to={`${eventPath}/reviews`}><ClipboardDocumentCheckIcon />Open clinical review</Link>}
        </div>
      </div>
    </section>

    <nav className="event-detail-tabs" aria-label="Event sections">
      <Link className={view === 'overview' ? 'active' : undefined} to={eventPath}>Overview</Link>
      <Link className={view === 'staff' ? 'active' : undefined} to={`${eventPath}/staff`}>Staff</Link>
      {canManage && <>
      <Link className={view === 'stations' ? 'active' : undefined} to={`${eventPath}/stations`}>Stations</Link>
      <Link className={view === 'shifts' ? 'active' : undefined} to={`${eventPath}/shifts`}>Shifts</Link>
      <Link className={view === 'analytics' ? 'active' : undefined} to={`${eventPath}/analytics`}>Analytics</Link>
      <Link className={view === 'reports' ? 'active' : undefined} to={`${eventPath}/reports`}>Reports</Link>
      <Link className={view === 'attendees' ? 'active' : undefined} to={`${eventPath}/attendees`}>Attendees</Link>
      <Link className={view === 'activity' ? 'active' : undefined} to={`${eventPath}/activity`}>Activity</Link>
      {canPermanentlyDelete && <Link className="danger-link" to={`${eventPath}/delete`}>Delete event</Link>}
      </>}
    </nav>

    <AppToast message={notice} onDismiss={() => setNotice('')} />
    {deviceLocal && <div className="alert" role="status">This is the encrypted snapshot on this device. Global totals and management changes require a connection.</div>}
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
        <div className="event-info-row event-schedule-summary"><CalendarDaysIcon /><div><small>{scheduleDays.length === 1 ? 'Date and time' : `${scheduleDays.length} event days`}</small>{scheduleDays.map((day) => <span className="event-schedule-day" key={day.startsAt}><strong>{formatEventDate(day.startsAt, event.timezone, false)}</strong><span>{formatTime(day.startsAt, event.timezone)} to {formatTime(day.endsAt, event.timezone)} · {eventDuration(day.startsAt, day.endsAt)}</span></span>)}</div></div>
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
              {canConfigureStations && stationEditing === station.eventStationId ? <div className="station-stacked-controls">
                <form className="station-capacity" noValidate onSubmit={(submitEvent) => saveStationCapacity(submitEvent, station.eventStationId)}>
                  <div><strong>Default capacity</strong><small>Apply one participant limit to every available day.</small></div>
                  <label><span>People per day</span><input key={`${station.eventStationId}-${station.capacity}`} name="capacity" type="number" min="1" max="1000" step="1" required defaultValue={station.capacity} aria-label={`${station.name} capacity for every day`} aria-invalid={!!capacityErrors[station.eventStationId]} aria-describedby={capacityErrors[station.eventStationId] ? `capacity-error-${station.eventStationId}` : undefined} onInput={() => setCapacityErrors((current) => ({ ...current, [station.eventStationId]: '' }))} />{capacityErrors[station.eventStationId] && <span className="field-error" id={`capacity-error-${station.eventStationId}`} role="alert">{capacityErrors[station.eventStationId]}</span>}</label>
                  <button className="secondary compact" type="submit" disabled={!!stationPending}>{stationPending === station.eventStationId ? 'Applying…' : 'Apply'}</button>
                </form>
                <form className="station-schedule" onSubmit={(submitEvent) => saveStationSchedule(submitEvent, station.eventStationId)}>
                  {availabilities.map((availability, index) => {
                    const scheduledDay = event.eventDays.find((day) => day.date === availability.eventDay.date);
                    const startsLateBy = availability.startsAt && scheduledDay ? new Date(availability.startsAt).getTime() - new Date(scheduledDay.startsAt).getTime() : 0;
                    const endsEarlyBy = availability.endsAt && scheduledDay ? new Date(scheduledDay.endsAt).getTime() - new Date(availability.endsAt).getTime() : 0;
                    const dayShifts = event.shifts.filter((shift) => dateKey(shift.startsAt, event.timezone) === dateKey(availability.eventDay.date, event.timezone));
                    const shiftComposerKey = `${station.eventStationId}:${availability.eventDay.date}`;
                    return <fieldset key={`${availability.eventStationAvailabilityId}-${availability.capacity}-${availability.startsAt}-${availability.endsAt}`}>
                    <legend>{formatEventDate(availability.eventDay.date, event.timezone, false)}</legend>
                    <div className="station-day-availability"><span>Station hours</span><label className="station-available"><input name={`available-${index}`} type="checkbox" defaultChecked={availability.isAvailable} />Open this day</label></div>
                    <div className="station-day-hours"><label><span>Opens</span><input name={`starts-${index}`} type="time" defaultValue={availability.startsAt ? formatTimeInput(availability.startsAt, event.timezone) : ''} /></label><span aria-hidden="true">–</span><label><span>Closes</span><input name={`ends-${index}`} type="time" defaultValue={availability.endsAt ? formatTimeInput(availability.endsAt, event.timezone) : ''} /></label></div>
                    {availability.isAvailable && (startsLateBy > 0 || endsEarlyBy > 0) && <div className="station-hours-warning" role="status"><ClockIcon />{startsLateBy > 0 && <span>Starts {scheduleOffset(startsLateBy)} after the event opens.</span>}{endsEarlyBy > 0 && <span>Closes {scheduleOffset(endsEarlyBy)} before the event ends.</span>}</div>}
                    {availability.isAvailable && <div className="station-day-screeners">
                      <div className="station-day-screeners-heading"><span><UserGroupIcon />Shifts &amp; screeners <small>{dayShifts.length ? `${dayShifts.length} ${dayShifts.length === 1 ? 'shift' : 'shifts'}` : 'No shift yet'}</small></span><span className="station-staffing-actions"><button className="secondary compact" type="button" onClick={() => openShiftComposer(shiftComposerKey, availability.startsAt || toInstant(availability.eventDay.date, formatTimeInput(event.startsAt, event.timezone)), availability.endsAt || toInstant(availability.eventDay.date, formatTimeInput(event.endsAt, event.timezone)))}><PlusIcon />Add shift</button>{dayShifts.length > 0 && !membersLoaded && !membersLoading && <button className="secondary compact" type="button" onClick={() => void loadEventMembers()}><UserPlusIcon />Assign screener</button>}</span></div>
                      {newShiftDay === shiftComposerKey && (() => { const draft = newShiftDrafts[shiftComposerKey]; return draft && <div className="station-new-shift"><div><strong>New staffing shift</strong><small>Name the block and set its working hours before assigning screeners.</small></div><label><span>Shift name</span><input autoFocus value={draft.name} maxLength={100} placeholder="Morning screening" onChange={(change) => setNewShiftDrafts((current) => ({ ...current, [shiftComposerKey]: { ...draft, name: change.target.value } }))} /></label><label><span>Starts</span><input type="time" value={draft.startsAt} onChange={(change) => setNewShiftDrafts((current) => ({ ...current, [shiftComposerKey]: { ...draft, startsAt: change.target.value } }))} /></label><label><span>Ends</span><input type="time" value={draft.endsAt} onChange={(change) => setNewShiftDrafts((current) => ({ ...current, [shiftComposerKey]: { ...draft, endsAt: change.target.value } }))} /></label><span><button className="secondary compact" type="button" onClick={() => setNewShiftDay('')}>Cancel</button><button className="primary compact" type="button" disabled={shiftPending === availability.eventDay.date || !draft.name.trim() || draft.endsAt <= draft.startsAt} onClick={() => void addDayShift(shiftComposerKey, availability.eventDay.date)}>{shiftPending === availability.eventDay.date ? 'Adding…' : 'Create shift'}</button></span></div>; })()}
                      {membersLoading ? <small>Loading event screeners…</small> : membersError ? <div className="station-screeners-error" role="alert"><small>{membersError}</small><button className="secondary compact" type="button" onClick={() => void loadEventMembers()}>Retry</button></div> : dayShifts.length === 0 ? <div className="station-shift-empty"><span><strong>No staffing shifts yet</strong><small>Station hours show availability. Add one or more shifts to schedule people within that window.</small></span></div> : dayShifts.map((shift) => {
                        const assigned = shift.staffAssignments.filter((assignment) => assignment.assignmentRole === 'SCREENER' && assignment.eventStation?.eventStationId === station.eventStationId);
                        const assignedIds = new Set(assigned.map((assignment) => assignment.user.userId));
                        const candidates = eventMembers.filter((membership) => membership.roles.some(({ role }) => role === 'SCREENER') && !assignedIds.has(membership.userId));
                        const draft = shiftDrafts[shift.shiftId] ?? { name: shift.name, startsAt: formatTimeInput(shift.startsAt, event.timezone), endsAt: formatTimeInput(shift.endsAt, event.timezone) };
                        const updateDraft = (patch: Partial<ShiftDraft>) => setShiftDrafts((current) => ({ ...current, [shift.shiftId]: { ...draft, ...patch } }));
                        return <div className="station-shift-screeners" key={shift.shiftId}>
                          <div className="station-shift-editor"><label><span>Shift name</span><input value={draft.name} maxLength={100} onChange={(change) => updateDraft({ name: change.target.value })} /></label><div><label><span>Starts</span><input type="time" value={draft.startsAt} onChange={(change) => updateDraft({ startsAt: change.target.value })} /></label><label><span>Ends</span><input type="time" value={draft.endsAt} onChange={(change) => updateDraft({ endsAt: change.target.value })} /></label></div><span className="station-shift-actions"><button className="icon-button danger" type="button" disabled={shiftPending === shift.shiftId} aria-label={`Delete ${shift.name}`} title={`Delete ${shift.name}`} onClick={() => void deleteShift(shift.shiftId, shift.name)}><TrashIcon /></button><button className="secondary compact" type="button" disabled={shiftPending === shift.shiftId || !draft.name.trim() || draft.endsAt <= draft.startsAt} onClick={() => void saveShift(shift.shiftId)}>{shiftPending === shift.shiftId ? 'Saving…' : 'Save shift'}</button></span></div>
                          <div className="station-person-tags">{assigned.map((assignment) => <span className="station-person-tag" key={assignment.staffAssignmentId}>{assignment.user.fullName}<button type="button" aria-label={`Remove ${assignment.user.fullName} from ${station.name} on ${formatEventDate(availability.eventDay.date, event.timezone, false)}`} disabled={staffingPending} onClick={() => void removeStaff(shift.shiftId, assignment.staffAssignmentId)}><XMarkIcon /></button></span>)}{assigned.length === 0 && <small>No screener assigned.</small>}</div>
                          {membersLoaded && <label className="station-add-person"><UserPlusIcon /><span className="visually-hidden">Add screener to {station.name} for {shift.name}</span><select value="" disabled={staffingPending || candidates.length === 0} onChange={(change) => { const userId = change.target.value; change.currentTarget.value = ''; if (userId) void assignStationScreener(shift.shiftId, station.eventStationId, userId); }}><option value="">{candidates.length ? 'Add person…' : 'No screeners available'}</option>{candidates.map((membership) => <option value={membership.userId} key={membership.membershipId}>{membership.user.fullName}</option>)}</select></label>}
                        </div>;
                      })}
                    </div>}
                  </fieldset>})}
                  <div className="station-actions"><button className="secondary compact station-remove" type="button" disabled={!!stationPending} onClick={() => void removeStation(station.eventStationId, station.name)}><TrashIcon />Remove station</button><span><button className="secondary compact" type="button" disabled={!!stationPending} onClick={() => setStationEditing(null)}>Cancel</button><button className="primary compact" type="submit" disabled={!!stationPending}>{stationPending === station.eventStationId ? 'Saving…' : 'Save availability'}</button></span></div>
                </form>
              </div> : <div className="station-record-actions"><div className="station-day-list">{availabilities.map((availability) => <span className={availability.isAvailable ? 'is-available' : 'is-unavailable'} key={availability.eventStationAvailabilityId}>{formatEventDate(availability.eventDay.date, event.timezone, false)} · {availability.isAvailable ? `${availability.startsAt ? `${formatTime(availability.startsAt, event.timezone)}–${formatTime(availability.endsAt || availability.startsAt, event.timezone)} · ` : ''}${availability.capacity} places` : 'Unavailable'}</span>)}</div>{canConfigureStations && <button className="secondary compact" type="button" onClick={() => setStationEditing(station.eventStationId)}>Configure</button>}</div>}
            </article>;
          })}</div>}
    </section>}

    {view === 'shifts' && <section className="event-view shift-section" aria-labelledby="shift-title">
        <div className="section-title shift-section-title"><div><h2 id="shift-title">Shifts</h2><p>Schedule working periods, then assign registration and station duties.</p></div><div className="shift-heading-actions"><span className="shift-count">{event.shifts.length} scheduled</span>{canEditStaffing && <button className="primary compact" type="button" onClick={openShiftCreator}><PlusIcon />Add shift</button>}</div></div>
        {event.shifts.length === 0 ? <div className="shift-empty-state"><ClockIcon /><h3>No shifts scheduled</h3><p>Add the first working period, then assign registration officers and station teams.</p>{canEditStaffing && <button className="primary compact" type="button" onClick={openShiftCreator}><PlusIcon />Add first shift</button>}</div> : <div className="shift-table">{event.shifts.map((shift) => {
          const draft = shiftDrafts[shift.shiftId] ?? { name: shift.name, startsAt: formatTimeInput(shift.startsAt, event.timezone), endsAt: formatTimeInput(shift.endsAt, event.timezone) };
          const updateDraft = (patch: Partial<ShiftDraft>) => setShiftDrafts((current) => ({ ...current, [shift.shiftId]: { ...draft, ...patch } }));
          return <article className="shift-record" key={shift.shiftId}>
            <div className="shift-record-summary"><span><strong>{shift.name}</strong><small>{formatEventDate(shift.startsAt, event.timezone, false)} · {STATUS_LABEL[shift.status as keyof typeof STATUS_LABEL] ?? shift.status.toLowerCase()}</small></span><span><small>Working hours</small>{formatTime(shift.startsAt, event.timezone)}–{formatTime(shift.endsAt, event.timezone)}</span><span><small>Coverage</small>{shift.staffAssignments.length} of {shift.requiredStaff} assigned</span>{canEditStaffing && <span className="shift-record-actions"><button className="secondary compact" type="button" aria-expanded={shiftEditing === shift.shiftId} onClick={() => setShiftEditing((current) => current === shift.shiftId ? null : shift.shiftId)}><PencilSquareIcon />Edit shift</button><button className="secondary compact" type="button" aria-expanded={staffingOpen === shift.shiftId} onClick={() => void openStaffing(shift.shiftId)}><PlusIcon />Assign staff</button></span>}</div>
            {shiftEditing === shift.shiftId && <div className="station-shift-editor"><label><span>Shift name</span><input value={draft.name} maxLength={100} onChange={(change) => updateDraft({ name: change.target.value })} /></label><div><label><span>Starts</span><input type="time" value={draft.startsAt} onChange={(change) => updateDraft({ startsAt: change.target.value })} /></label><label><span>Ends</span><input type="time" value={draft.endsAt} onChange={(change) => updateDraft({ endsAt: change.target.value })} /></label></div><span className="station-shift-actions"><button className="secondary compact" type="button" disabled={shiftPending === shift.shiftId} onClick={() => setShiftEditing(null)}>Cancel</button><button className="secondary compact" type="button" disabled={shiftPending === shift.shiftId || !draft.name.trim() || draft.endsAt <= draft.startsAt} onClick={() => void saveShift(shift.shiftId)}>{shiftPending === shift.shiftId ? 'Saving…' : 'Save shift'}</button></span></div>}
            {shift.staffAssignments.length > 0 ? <ul className="assignment-list">{shift.staffAssignments.map((assignment) => <li key={assignment.staffAssignmentId}><span><strong>{assignment.user.fullName}</strong><small>{roleLabel(assignment.assignmentRole)}{assignment.eventStation ? ` · ${assignment.eventStation.name}` : ''}</small></span>{canEditStaffing && <button className="assignment-remove" type="button" aria-label={`Remove ${assignment.user.fullName} from ${shift.name}`} title={`Remove ${assignment.user.fullName}`} onClick={() => void removeStaff(shift.shiftId, assignment.staffAssignmentId)} disabled={staffingPending}><TrashIcon /></button>}</li>)}</ul> : <p className="shift-empty">No staff assigned to this shift.</p>}
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
      {attendeeError && <div className="inline-retry" role="alert"><p>{attendeeError}</p>{!deviceLocal && <button className="secondary compact" type="button" onClick={() => void loadAttendees()}>Retry</button>}</div>}
      {!attendeeError && !attendeeLoading && attendees.length === 0 ? <p className="quiet-empty">No attendees match these filters.</p> : <div className="station-table">{attendees.map((attendee) => <article className="station-record" key={attendee.registrationId}><div className="station-record-copy"><strong>{attendee.participantDisplayName || attendee.participantReference}</strong><span>{attendee.participantReference} · {attendee.registrationStatus.toLowerCase().replace('_', ' ')}</span><small>{attendee.checkedInAt ? `Checked in ${formatEventDate(attendee.checkedInAt, event.timezone)}` : `Registered ${formatEventDate(attendee.createdAt, event.timezone)}`}</small>{attendee.routeSteps.length > 0 && <small>Route: {attendee.routeSteps.map((step) => `${step.stationName} (${step.state.toLowerCase()})`).join(' → ')}</small>}</div><span className="station-record-actions"><strong className="station-capacity-readonly">{attendee.queueNumber ? `#${attendee.queueNumber}` : '—'}</strong>{attendee.routeSteps.some((step) => ['CURRENT', 'BLOCKED', 'UPCOMING'].includes(step.state)) && <button className="secondary compact" type="button" onClick={() => setAttendeeRouteRegistrationId(attendee.registrationId)}>Change route</button>}</span></article>)}</div>}
      {attendeeNextCursor && <button className="secondary compact" type="button" disabled={attendeeLoading} onClick={() => void loadAttendees(attendeeNextCursor, true)}>{attendeeLoading ? 'Loading…' : 'Load more'}</button>}
    </section>}
    <RouteOverrideDialog
      open={attendeeRouteRegistrationId !== null}
      eventId={event.eventId}
      registrationId={attendeeRouteRegistrationId}
      fullAccess
      onOpenChange={(open) => { if (!open) setAttendeeRouteRegistrationId(null); }}
      onCommitted={async () => { await loadAttendees(); }}
    />

    {view === 'activity' && <section className="event-view history event-activity" aria-labelledby="activity-title">
      <h2 id="activity-title">Activity</h2>
      <p>Consequential event actions retain the authenticated actor and timestamp.</p>
      {deviceLocal ? <p>Activity history requires a connection and is not stored in this device snapshot.</p> : !canManage ? <p>History is available to the event’s managers and administrators.</p> : <>
        {auditError && <div className="inline-retry" role="alert"><p>{auditError}</p><button className="secondary compact" type="button" onClick={() => void refreshAudit(event.eventId)}>Retry</button></div>}
        {auditLoading && audit.length === 0 ? <p>Loading activity…</p> : !auditError && audit.length === 0 ? <p>No history is available.</p> : audit.length > 0 ? <ol>{audit.map((item) => <li key={item.eventAuditLogId}><i /><div><strong>{item.action.toLowerCase().replace(/_/g, ' ')}</strong><span>{item.actor?.email ?? 'System actor'}</span><time dateTime={item.createdAt}>{formatEventDate(item.createdAt, event.timezone)}</time></div></li>)}</ol> : null}
      </>}
    </section>}
    <AppDialog
      open={shiftCreateOpen}
      onOpenChange={(open) => { if (!shiftPending) setShiftCreateOpen(open); }}
      title="Add shift"
      description="Create a working period within one of this event’s scheduled days."
      dismissible={!shiftPending}
    >
      <form className={`${appDialog.form} shift-dialog-form`} onSubmit={(submitEvent) => { submitEvent.preventDefault(); void createShift(); }}>
        <label className={`${appDialog.field} wide`}><span>Shift name</span><input data-dialog-autofocus required maxLength={100} placeholder="Morning registration" value={shiftCreateDraft.name} onChange={(change) => setShiftCreateDraft((current) => ({ ...current, name: change.target.value }))} /></label>
        <label className={appDialog.field}><span>Event day</span><select required value={shiftCreateDraft.date} onChange={(change) => setShiftCreateDraft((current) => ({ ...current, date: change.target.value }))}>{scheduleDays.map((day) => <option value={dateKey(day.startsAt, event.timezone)} key={day.startsAt}>{formatEventDate(day.startsAt, event.timezone, false)}</option>)}</select></label>
        <label className={appDialog.field}><span>Required staff</span><input type="number" min="1" max="1000" required value={shiftCreateDraft.requiredStaff} onChange={(change) => setShiftCreateDraft((current) => ({ ...current, requiredStaff: change.target.valueAsNumber }))} /></label>
        <label className={appDialog.field}><span>Starts</span><input type="time" required value={shiftCreateDraft.startsAt} onChange={(change) => setShiftCreateDraft((current) => ({ ...current, startsAt: change.target.value }))} /></label>
        <label className={appDialog.field}><span>Ends</span><input type="time" required value={shiftCreateDraft.endsAt} onChange={(change) => setShiftCreateDraft((current) => ({ ...current, endsAt: change.target.value }))} /></label>
        <div className={`${appDialog.actions} wide`}><button className="secondary" type="button" disabled={!!shiftPending} onClick={() => setShiftCreateOpen(false)}>Cancel</button><button className="primary" type="submit" disabled={!!shiftPending || !shiftCreateDraft.name.trim() || shiftCreateDraft.endsAt <= shiftCreateDraft.startsAt}>{shiftPending ? 'Adding…' : 'Add shift'}</button></div>
      </form>
    </AppDialog>
    <AppDialog
      open={!!staffingShift}
      onOpenChange={(open) => { if (!open && !staffingPending) setStaffingOpen(null); }}
      title={staffingShift ? `Assign staff · ${staffingShift.name}` : 'Assign staff'}
      description={staffingShift ? `${formatEventDate(staffingShift.startsAt, event.timezone, false)} · ${formatTime(staffingShift.startsAt, event.timezone)}–${formatTime(staffingShift.endsAt, event.timezone)}` : undefined}
      dismissible={!staffingPending}
    >
      {staffingShift && <form className={`${appDialog.form} shift-assignment-dialog`} onSubmit={(submitEvent) => { submitEvent.preventDefault(); void assignStaff(staffingShift.shiftId); }}>
        {membersLoading ? <p>Loading available staff…</p> : membersError ? <div className="inline-retry" role="alert"><p>{membersError}</p><button className="secondary compact" type="button" onClick={() => void loadEventMembers()}>Retry</button></div> : membersLoaded && eventMembers.length === 0 ? <p>No staff members belong to this event.</p> : <>
          <div className="shift-assignment-fields"><label className={appDialog.field}><span>Duty</span><select value={staffingDraft.assignmentRole} disabled={staffingPending} onChange={(change) => { updateAssignmentDraft(staffingShift.shiftId, { assignmentRole: change.target.value as StaffAssignmentRole, eventStationId: '' }); setSelectedStaffIds((current) => ({ ...current, [staffingShift.shiftId]: [] })); }}>{assignmentRoles.map((role) => <option value={role} key={role}>{roleLabel(role)}</option>)}</select></label><label className={appDialog.field}><span>Station {staffingDraft.assignmentRole === 'SCREENER' ? '(required)' : '(optional)'}</span><select required={staffingDraft.assignmentRole === 'SCREENER'} value={staffingDraft.eventStationId} disabled={staffingPending} onChange={(change) => updateAssignmentDraft(staffingShift.shiftId, { eventStationId: change.target.value })}><option value="">No station</option>{event.eventStations.filter((station) => station.isAvailable).map((station) => <option value={station.eventStationId} key={station.eventStationId}>{station.stationOrder}. {station.name}</option>)}</select></label></div>
          <fieldset className="staff-picker shift-staff-picker"><legend>Staff members</legend><label className="staff-select-all"><input type="checkbox" checked={availableStaff.length > 0 && staffingSelectedIds.length === availableStaff.length} onChange={(change) => setSelectedStaffIds((current) => ({ ...current, [staffingShift.shiftId]: change.target.checked ? availableStaff.map(({ userId }) => userId) : [] }))} /> Select all {availableStaff.length}</label>{eligibleStaff.map((membership) => { const conflict = conflictingShiftByUser.get(membership.userId); return <label key={membership.userId}><input type="checkbox" disabled={!!conflict} checked={staffingSelectedIds.includes(membership.userId)} onChange={(change) => setSelectedStaffIds((current) => ({ ...current, [staffingShift.shiftId]: change.target.checked ? [...staffingSelectedIds, membership.userId] : staffingSelectedIds.filter((id) => id !== membership.userId) }))} /><span>{membership.user.fullName}{conflict && <small>Unavailable · {conflict.name} {formatTime(conflict.startsAt, event.timezone)}–{formatTime(conflict.endsAt, event.timezone)}</small>}</span></label>; })}</fieldset>
          {eligibleStaff.length === 0 && <p className={appDialog.help}>No event staff have the selected role. Add the role under Event staff first.</p>}
          <div className={appDialog.actions}><button className="secondary" type="button" disabled={staffingPending} onClick={() => setStaffingOpen(null)}>Cancel</button><button className="primary" type="submit" disabled={staffingPending || staffingSelectedIds.length === 0 || (staffingDraft.assignmentRole === 'SCREENER' && !staffingDraft.eventStationId)}>{staffingPending ? 'Assigning…' : `Assign ${staffingSelectedIds.length || ''} staff`}</button></div>
        </>}
      </form>}
    </AppDialog>
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
