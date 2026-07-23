import {
  ArrowLeftIcon,
  CalendarDaysIcon,
  CheckIcon,
  ClockIcon,
  MapPinIcon,
  PhotoIcon,
  PencilSquareIcon,
  UserGroupIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { getApiMessage, useAuth } from '../../auth/authState';
import { eventApi, formatEventDate, STATUS_LABEL, type AuditRecord, type EventRecord } from './eventApi';
import { EVENT_BANNERS, getEventBanner, type EventBannerKey } from './eventBanners';

const nextAction: Record<string, { action: 'publish' | 'start' | 'complete'; label: string; prompt: string } | undefined> = {
  DRAFT: { action: 'publish', label: 'Publish event', prompt: 'Publish this event? Staff with access will see it as ready for operations.' },
  PUBLISHED: { action: 'start', label: 'Start event', prompt: 'Start operations now? Planned shifts will become active.' },
  IN_PROGRESS: { action: 'complete', label: 'Complete event', prompt: 'Complete this event? This is a terminal action and cannot be undone.' },
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
  const { user } = useAuth();
  const location = useLocation();
  const [event, setEvent] = useState<EventRecord | null>(null);
  const [audit, setAudit] = useState<AuditRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [bannerPending, setBannerPending] = useState(false);
  const [bannerOpen, setBannerOpen] = useState(false);
  const [selectedBanner, setSelectedBanner] = useState<EventBannerKey>('COMMUNITY_SCREENING');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState((location.state as { notice?: string } | null)?.notice ?? '');

  const load = async () => {
    setLoading(true); setError('');
    try {
      const detail = await eventApi.get(eventId); setEvent(detail); setSelectedBanner(getEventBanner(detail.bannerKey).key);
      if (user?.systemRole !== 'STAFF') eventApi.audit(eventId).then((data) => setAudit(data.auditLogs)).catch(() => setAudit([]));
    } catch (cause) { setError(getApiMessage(cause, 'Event details could not be loaded.')); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [eventId]); // eslint-disable-line react-hooks/exhaustive-deps

  const transition = async () => {
    const next = event && nextAction[event.status]; if (!event || !next || !window.confirm(next.prompt)) return;
    setPending(true); setError('');
    try { const updated = await eventApi.transition(event.eventId, next.action, event.version); setEvent(updated); setNotice(`${STATUS_LABEL[updated.status]} status saved.`); const data = await eventApi.audit(event.eventId); setAudit(data.auditLogs); }
    catch (cause) { setError(getApiMessage(cause, 'The status could not be changed. Refresh and try again.')); }
    finally { setPending(false); }
  };

  const cancel = async () => {
    if (!event) return;
    const reason = window.prompt('Give a clear cancellation reason (10-500 characters).');
    if (!reason) return;
    setPending(true); setError('');
    try { const updated = await eventApi.cancel(event.eventId, event.version, reason); setEvent(updated); setNotice('Event cancelled and reason recorded.'); }
    catch (cause) { setError(getApiMessage(cause, 'The event could not be cancelled.')); }
    finally { setPending(false); }
  };

  const saveBanner = async () => {
    if (!event || selectedBanner === event.bannerKey) { setBannerOpen(false); return; }
    setBannerPending(true); setError('');
    try {
      const updated = await eventApi.update(event.eventId, { version: event.version, bannerKey: selectedBanner });
      setEvent(updated); setBannerOpen(false); setNotice('Event banner updated.');
    } catch (cause) { setError(getApiMessage(cause, 'The banner could not be updated. Refresh and try again.')); }
    finally { setBannerPending(false); }
  };

  const dateParts = useMemo(() => event ? getDateParts(event.startsAt, event.timezone) : null, [event]);

  if (loading) return <div className="detail-loading" aria-live="polite" aria-label="Loading event"><span /><span /><span /></div>;
  if (!event || !dateParts) return <div className="center-state error-state"><h1>Event unavailable</h1><p>{error}</p><Link className="secondary" to="/events">Return to events</Link></div>;

  const terminal = event.status === 'COMPLETED' || event.status === 'CANCELLED';
  const canManage = user?.systemRole === 'ADMIN' || user?.systemRole === 'EVENT_MANAGER';
  const canCancel = canManage && !terminal && (event.status !== 'IN_PROGRESS' || user?.systemRole === 'ADMIN');
  const activeStage = lifecycleStages.findIndex((stage) => stage.status === event.status);
  const totalRequiredStaff = event.shifts.reduce((total, shift) => total + shift.requiredStaff, 0);
  const banner = getEventBanner(event.bannerKey);

  return <div className="page-frame detail-page">
    <div className="detail-topline">
      <Link className="back-link" to="/events"><ArrowLeftIcon />Events</Link>
      <span className="event-reference">Event record / {event.eventId.slice(0, 8)}</span>
    </div>

    {notice && <div className="alert success" role="status"><CheckIcon />{notice}<button className="icon-button" onClick={() => setNotice('')} aria-label="Dismiss message"><XMarkIcon /></button></div>}
    {error && <div className="alert error" role="alert">{error}</div>}

    <figure className="event-banner" aria-label={`Banner for ${event.name}`}>
      <div className="event-banner-image"><img src={banner.src} alt="" /></div>
      <figcaption className="event-banner-toolbar">
        <div><span>Event banner</span><strong>{banner.label}</strong></div>
        {canManage && <button className="secondary banner-edit-button" type="button" aria-expanded={bannerOpen} aria-controls="banner-picker" onClick={() => { setSelectedBanner(banner.key); setBannerOpen((open) => !open); }}><PhotoIcon />Change banner</button>}
      </figcaption>
    </figure>

    {bannerOpen && <section className="banner-picker" id="banner-picker" aria-labelledby="banner-picker-title">
      <div className="banner-picker-heading"><div><h2 id="banner-picker-title">Choose event artwork</h2><p>The selected banner appears here and on the events page.</p></div><button className="icon-button" type="button" onClick={() => setBannerOpen(false)} aria-label="Close banner picker"><XMarkIcon /></button></div>
      <div className="banner-options" role="radiogroup" aria-label="Available event banners">
        {EVENT_BANNERS.map((option) => <button className={`banner-option ${selectedBanner === option.key ? 'selected' : ''}`} type="button" role="radio" aria-checked={selectedBanner === option.key} key={option.key} onClick={() => setSelectedBanner(option.key)}>
          <span className="banner-option-image"><img src={option.src} alt="" />{selectedBanner === option.key && <i><CheckIcon /></i>}</span>
          <span><strong>{option.label}</strong><small>{option.description}</small></span>
        </button>)}
      </div>
      <div className="banner-picker-actions"><button className="secondary" type="button" onClick={() => setBannerOpen(false)}>Cancel</button><button className="primary" type="button" disabled={bannerPending || selectedBanner === event.bannerKey} onClick={() => void saveBanner()}>{bannerPending ? 'Saving…' : 'Use this banner'}</button></div>
    </section>}

    <section className="event-overview" aria-labelledby="event-title">
      <div className="event-summary">
        <div className="event-summary-heading">
          <span className="status-line"><i className={`status-dot ${event.status.toLowerCase()}`} />{STATUS_LABEL[event.status]}</span>
          <h1 id="event-title">{event.name}</h1>
          <p>{event.description || 'No event description has been added.'}</p>
        </div>

      </div>

      <aside className="event-facts" aria-label="Event essentials and actions">
        <div className="event-info-list">
          <div className="event-info-row">
            <CalendarDaysIcon />
            <div><small>Date and time</small><strong>{dateParts.weekday}, {dateParts.month} {dateParts.day}, {dateParts.year}</strong><span>{formatTime(event.startsAt, event.timezone)} to {formatTime(event.endsAt, event.timezone)}, {eventDuration(event.startsAt, event.endsAt)}</span></div>
          </div>
          <div className="event-info-row">
            <MapPinIcon />
            <div><small>Venue</small><strong>{event.venue}</strong><span>{event.timezone}</span></div>
          </div>
          <div className="event-info-row split">
            <UserGroupIcon />
            <div><small>Capacity</small><strong>{event.capacity.toLocaleString()} people</strong></div>
            <ClockIcon />
            <div><small>Staffing plan</small><strong>{event.shifts.length} {event.shifts.length === 1 ? 'shift' : 'shifts'}, {totalRequiredStaff} required</strong></div>
          </div>
        </div>

        {canManage && <div className="action-cluster">
          {nextAction[event.status] && <button className="primary" onClick={() => void transition()} disabled={pending}>{pending ? 'Saving…' : nextAction[event.status]!.label}</button>}
          {!terminal && <Link className="secondary" to={`/events/${event.eventId}/edit`}><PencilSquareIcon />Edit details</Link>}
          {canCancel && <button className="danger-button" onClick={() => void cancel()} disabled={pending}>Cancel event</button>}
        </div>}
      </aside>
    </section>

    <section className="lifecycle" aria-labelledby="lifecycle-title">
      <div className="lifecycle-heading"><h2 id="lifecycle-title">Event lifecycle</h2><span>{event.status === 'CANCELLED' ? 'Cancelled before completion' : `${STATUS_LABEL[event.status]} stage`}</span></div>
      <ol className={event.status === 'CANCELLED' ? 'is-cancelled' : ''}>
        {lifecycleStages.map((stage, index) => <li className={index < activeStage ? 'complete' : index === activeStage ? 'current' : ''} key={stage.status}><i>{index < activeStage ? <CheckIcon /> : null}</i><span>{stage.label}</span></li>)}
      </ol>
    </section>

    {event.status === 'CANCELLED' && <section className="cancellation"><strong>Cancellation reason</strong><p>{event.cancellationReason}</p></section>}

    <div className="event-content-grid">
      <section className="shift-section" aria-labelledby="shift-title">
        <div className="section-title"><div><span className="section-kicker">Staffing plan</span><h2 id="shift-title">Shifts</h2></div><span>{event.shifts.length} scheduled</span></div>
        {event.shifts.length === 0 ? <p className="quiet-empty">No shifts have been added. The event can still be saved as a draft.</p> : <div className="shift-table">{event.shifts.map((shift) => <div key={shift.shiftId}><span><strong>{shift.name}</strong><small>{STATUS_LABEL[shift.status as keyof typeof STATUS_LABEL] ?? shift.status.toLowerCase()}</small></span><span><small>Starts</small>{formatEventDate(shift.startsAt, event.timezone)}</span><span><small>Coverage</small>{shift.requiredStaff} staff required</span></div>)}</div>}
      </section>

      <aside className="history" aria-labelledby="activity-title">
        <span className="section-kicker">Immutable record</span>
        <h2 id="activity-title">Activity</h2>
        {user?.systemRole === 'STAFF' ? <p>History is available to event managers and administrators.</p> : audit.length === 0 ? <p>No history is available.</p> : <ol>{audit.map((item) => <li key={item.eventAuditLogId}><i /><div><strong>{item.action.toLowerCase().replace(/_/g, ' ')}</strong><span>{item.actor?.email ?? 'System actor'}</span><time dateTime={item.createdAt}>{formatEventDate(item.createdAt, event.timezone)}</time></div></li>)}</ol>}
      </aside>
    </div>
  </div>;
}
