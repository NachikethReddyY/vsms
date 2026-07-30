import { ArrowTopRightOnSquareIcon, CalendarDaysIcon, DocumentDuplicateIcon, ListBulletIcon, MapPinIcon, PencilSquareIcon, PlayIcon, TableCellsIcon } from '@heroicons/react/24/outline';
import { Badge, type BadgeVariant } from '@astryxdesign/core/Badge';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider';
import { getApiMessage } from '../../auth/authState';
import { AvatarCircles } from '../../components/MagicEffects';
import { getDisplayName, getMonogram } from '../../utils/identity';
import { eventApi, formatEventDate, STATUS_LABEL, type EventRecord, type EventStatus } from './eventApi';
import { getEventArtwork } from './eventBanners';

type ViewMode = 'timeline' | 'table';
type TimeRange = 'upcoming' | 'past';

const filters: Array<{ value: '' | EventStatus; label: string }> = [
  { value: '', label: 'All events' },
  { value: 'DRAFT', label: 'Draft' },
  { value: 'PUBLISHED', label: 'Published' },
  { value: 'IN_PROGRESS', label: 'In progress' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

const statusVariant: Record<EventStatus, BadgeVariant> = {
  DRAFT: 'neutral',
  PUBLISHED: 'info',
  IN_PROGRESS: 'warning',
  COMPLETED: 'success',
  CANCELLED: 'error',
};

function eventTime(event: EventRecord) {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZone: event.timezone }).format(new Date(event.startsAt));
}

function eventDateParts(event: EventRecord) {
  const parts = new Intl.DateTimeFormat('en-SG', { day: '2-digit', month: 'short', weekday: 'long', timeZone: event.timezone })
    .formatToParts(new Date(event.startsAt));
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || '';
  return { day: get('day'), month: get('month'), weekday: get('weekday') };
}

function uniquePeople(event: EventRecord) {
  const assigned = event.shifts.flatMap((shift) => shift.staffAssignments).map((assignment) => assignment.user);
  const people = event.createdBy ? [{ userId: event.createdBy.userId, username: event.createdBy.username }, ...assigned] : assigned;
  return [...new Map(people.map((person) => [person.userId, person])).values()];
}

function dashboardPath(event: EventRecord, userId?: string) {
  const isReviewer = event.shifts.some((shift) => shift.status === 'ACTIVE' && shift.staffAssignments.some((assignment) => (
    assignment.user.userId === userId
    && assignment.assignmentRole === 'REVIEWER'
    && ['ASSIGNED', 'CONFIRMED'].includes(assignment.status)
  )));
  return isReviewer ? `/events/${event.eventId}/reviews` : `/events/${event.eventId}`;
}

export default function EventsPage() {
  const { session } = useAuth();
  const user = session?.user;
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [timeRange, setTimeRange] = useState<TimeRange>('upcoming');
  const [status, setStatus] = useState<'' | EventStatus>('');
  const [view, setView] = useState<ViewMode>(() => localStorage.getItem('vsms-events-view') === 'table' ? 'table' : 'timeline');
  const [query, setQuery] = useState('');
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async (append = false) => {
    setLoading(true); setError('');
    try {
      const data = await eventApi.list({ status: status || undefined, search: query || undefined, cursor: append ? nextCursor ?? undefined : undefined });
      setEvents((current) => append ? [...current, ...data.events] : data.events);
      setNextCursor(data.nextCursor);
    } catch (cause) { setError(getApiMessage(cause, 'Events could not be loaded.')); }
    finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, [query, status]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const updateQuery = (event: Event) => setQuery((event as CustomEvent<string>).detail);
    window.addEventListener('vsms:events-search', updateQuery);
    return () => window.removeEventListener('vsms:events-search', updateQuery);
  }, []);

  useEffect(() => {
    const updateView = (event: Event) => setView((event as CustomEvent<ViewMode>).detail);
    window.addEventListener('vsms:events-view', updateView);
    return () => window.removeEventListener('vsms:events-view', updateView);
  }, []);

  const changeView = (nextView: ViewMode) => {
    setView(nextView);
    localStorage.setItem('vsms-events-view', nextView);
  };

  const changeStatus = (nextStatus: '' | EventStatus) => {
    setStatus(nextStatus);
    if (nextStatus === 'CANCELLED') setTimeRange('past');
  };

  const visibleEvents = useMemo(() => {
    const now = Date.now();
    const filtered = events.filter((event) => !status || event.status === status);
    if (view === 'table') return filtered.sort((a, b) => new Date(b.startsAt).getTime() - new Date(a.startsAt).getTime());
    return filtered
      .filter((event) => timeRange === 'past'
        ? event.status === 'CANCELLED' || (event.status !== 'IN_PROGRESS' && new Date(event.endsAt).getTime() < now)
        : event.status === 'IN_PROGRESS' || (event.status !== 'CANCELLED' && new Date(event.endsAt).getTime() >= now))
      .sort((a, b) => (new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()) * (timeRange === 'past' ? -1 : 1));
  }, [events, status, timeRange, view]);

  return (
    <div className="page-frame events-page">
      <section className="page-heading events-heading">
        <h1>Events</h1>
        <div className="events-heading-controls">
          {view === 'timeline' && <div className="event-range-toggle" role="group" aria-label="Show events by date">
            {(['upcoming', 'past'] as const).map((range) => <button key={range} className={timeRange === range ? 'selected' : ''} aria-pressed={timeRange === range} disabled={status === 'CANCELLED' && range === 'upcoming'} onClick={() => setTimeRange(range)}>{range === 'upcoming' ? 'Upcoming' : 'Past'}</button>)}
          </div>}
          <div className="event-view-toggle" role="group" aria-label="Events view">
            <button className={view === 'timeline' ? 'selected' : ''} aria-pressed={view === 'timeline'} onClick={() => changeView('timeline')}><ListBulletIcon /><span>Timeline</span></button>
            <button className={view === 'table' ? 'selected' : ''} aria-pressed={view === 'table'} onClick={() => changeView('table')}><TableCellsIcon /><span>Table</span></button>
          </div>
        </div>
      </section>
      <section className="events-filter-bar" aria-label="Filter events by status">
        <div className="event-status-filters" role="group" aria-label="Event status">
          {filters.map((filter) => <button key={filter.value || 'all'} className={status === filter.value ? 'selected' : ''} aria-pressed={status === filter.value} onClick={() => changeStatus(filter.value)}>{filter.label}</button>)}
        </div>
      </section>
      {error && <div className="alert error" role="alert"><span>{error}</span><button onClick={() => void load()}>Try again</button></div>}
      {loading && events.length === 0 ? <section className="event-reference-timeline event-reference-loading" aria-label="Loading events" aria-live="polite">{Array.from({ length: 4 }, (_, index) => <div className="event-reference-item" key={index}><span className="event-reference-date skeleton-block" /><span className="event-reference-dot" /><span className="reference-event-card skeleton-block" /></div>)}</section> : visibleEvents.length === 0 ? (
        <section className="empty-state"><CalendarDaysIcon /><h2>{query || status ? 'No matching events' : view === 'table' ? 'No events' : `No ${timeRange} events`}</h2><p>{query || status ? 'Change the search or status filter to broaden this view.' : view === 'table' ? 'Create an event to start the schedule.' : `Events will appear here when they are ${timeRange}.`}</p>{user?.systemRole !== 'STAFF' && (view === 'table' || timeRange === 'upcoming') && <Link className="primary" to="/events/new">Create event</Link>}</section>
      ) : view === 'timeline' ? (
        <section className="event-reference-timeline" aria-label={`${timeRange} events`}>
          {visibleEvents.map((event) => {
            const owner = event.createdBy?.username ? getDisplayName(event.createdBy.username) : event.createdBy?.email || 'VSMS operations';
            const crew = uniquePeople(event);
            const terminal = event.status === 'COMPLETED' || event.status === 'CANCELLED';
            const date = eventDateParts(event);
            return <article className="event-reference-item" key={event.eventId}>
              <time className="event-reference-date" dateTime={event.startsAt}><strong>{date.day} {date.month}</strong><span>{date.weekday}</span></time>
              <span className="event-reference-dot" aria-hidden="true" />
              <div className="reference-event-card">
                <div className="reference-event-copy">
                  <time dateTime={event.startsAt}>{eventTime(event)}</time>
                  <h2><Link className="event-title-link" to={`/events/${event.eventId}`}>{event.name}</Link></h2>
                  <p className="event-owner"><span className="owner-avatar" aria-hidden="true">{getMonogram(owner)}</span><span title={owner}>By <strong>{owner}</strong></span></p>
                  <p className="event-location"><MapPinIcon /><span>{event.venue}</span></p>
                  <footer className="reference-event-footer">
                    <Badge variant={statusVariant[event.status]} label={STATUS_LABEL[event.status]} />
                    {crew.length > 0 && <AvatarCircles people={crew} label={`${crew.length} event staff`} />}
                    <span>{event.signupCount.toLocaleString()} {event.signupCount === 1 ? 'signup' : 'signups'}</span>
                    <span>{event.activeCapacityCount.toLocaleString()} / {event.capacity.toLocaleString()} at venue</span>
                  </footer>
                </div>
                <div className="reference-event-aside">
                  <div className="reference-event-artwork" aria-hidden="true"><img src={getEventArtwork(event.bannerKey, event.artworkDataUrl)} alt="" loading="lazy" /></div>
                  <div className="reference-event-actions">
                    {event.status === 'IN_PROGRESS' && <Link className="event-play-action" to={dashboardPath(event, user?.userId)} target="_blank" rel="noopener noreferrer" aria-label={`Open ${event.name} dashboard in a new tab`} title="Open dashboard in new tab"><PlayIcon /></Link>}
                    {event.canManage && (terminal
                      ? <Link to="/events/new" state={{ duplicateFrom: event }} aria-label={`Duplicate ${event.name}`} title="Duplicate event"><DocumentDuplicateIcon /></Link>
                      : <Link to={`/events/${event.eventId}/edit`} aria-label={`Edit ${event.name}`} title="Edit event"><PencilSquareIcon /></Link>)}
                  </div>
                </div>
              </div>
            </article>;
          })}
          {nextCursor && <div className="reference-load-more"><button className="secondary" onClick={() => void load(true)} disabled={loading}>{loading ? 'Loading…' : 'Load more events'}</button></div>}
        </section>
      ) : (
        <section className="events-table-shell" aria-label="Events table">
          <table className="events-native-table">
            <caption className="sr-only">All events</caption>
            <thead><tr><th scope="col">Event</th><th scope="col">Schedule</th><th scope="col">Venue</th><th scope="col">Status</th><th scope="col">At venue</th><th scope="col">Actions</th></tr></thead>
            <tbody>{visibleEvents.map((event) => {
              const owner = event.createdBy?.username ? getDisplayName(event.createdBy.username) : event.createdBy?.email || 'VSMS operations';
              const terminal = event.status === 'COMPLETED' || event.status === 'CANCELLED';
              return <tr key={event.eventId}>
                <td><div className="event-table-primary"><Link to={`/events/${event.eventId}`}>{event.name}</Link><small>Created by {owner}</small></div></td>
                <td><time dateTime={event.startsAt}>{formatEventDate(event.startsAt, event.timezone, false)} · {eventTime(event)}</time></td>
                <td title={event.venue}>{event.venue}</td>
                <td><Badge variant={statusVariant[event.status]} label={STATUS_LABEL[event.status]} /></td>
                <td className="event-table-capacity">{event.activeCapacityCount.toLocaleString()} / {event.capacity.toLocaleString()}</td>
                <td><div className="event-table-actions">
                  {event.status === 'IN_PROGRESS' && <Link className="event-play-action" to={dashboardPath(event, user?.userId)} target="_blank" rel="noopener noreferrer" aria-label={`Open ${event.name} dashboard in a new tab`} title="Open dashboard in new tab"><PlayIcon /></Link>}
                  {event.canManage && (terminal
                    ? <Link to="/events/new" state={{ duplicateFrom: event }} aria-label={`Duplicate ${event.name}`} title="Duplicate event"><DocumentDuplicateIcon /></Link>
                    : <Link to={`/events/${event.eventId}/edit`} aria-label={`Edit ${event.name}`} title="Edit event"><PencilSquareIcon /></Link>)}
                  <Link to={`/events/${event.eventId}`} aria-label={`Open ${event.name}`} title="Open event"><ArrowTopRightOnSquareIcon /></Link>
                </div></td>
              </tr>;
            })}</tbody>
          </table>
          {nextCursor && <div className="load-more"><button className="secondary" onClick={() => void load(true)} disabled={loading}>{loading ? 'Loading…' : 'Load more events'}</button></div>}
        </section>
      )}
    </div>
  );
}
