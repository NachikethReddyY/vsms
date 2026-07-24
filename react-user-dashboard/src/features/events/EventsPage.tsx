import { CalendarDaysIcon, MapPinIcon } from '@heroicons/react/24/outline';
import { useEffect, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { getApiMessage, useAuth } from '../../auth/authState';
import { eventApi, formatEventDate, STATUS_LABEL, type EventRecord, type EventStatus } from './eventApi';
import { AvatarCircles } from '../../components/MagicEffects';
import { getEventArtwork } from './eventBanners';

const filters: Array<{ value: '' | EventStatus; label: string }> = [
  { value: '', label: 'All events' }, { value: 'DRAFT', label: 'Draft' }, { value: 'PUBLISHED', label: 'Published' },
  { value: 'IN_PROGRESS', label: 'In progress' }, { value: 'COMPLETED', label: 'Completed' }, { value: 'CANCELLED', label: 'Cancelled' },
];

function eventTime(event: EventRecord) {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZone: event.timezone }).format(new Date(event.startsAt));
}

function eventDateMarker(event: EventRecord) {
  const parts = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: event.timezone }).formatToParts(new Date(event.startsAt));
  return Object.fromEntries(parts.map(({ type, value }) => [type, value]));
}

function uniquePeople(event: EventRecord, planning: boolean) {
  const assigned = event.shifts.flatMap((shift) => shift.staffAssignments)
    .filter((assignment) => planning ? assignment.assignmentRole === 'EVENT_MANAGER' : assignment.assignmentRole !== 'EVENT_MANAGER')
    .map((assignment) => assignment.user);
  const people = planning && event.createdBy ? [{ userId: event.createdBy.userId, username: event.createdBy.username }, ...assigned] : assigned;
  return [...new Map(people.map((person) => [person.userId, person])).values()];
}

export default function EventsPage() {
  const { user } = useAuth();
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [status, setStatus] = useState<'' | EventStatus>('');
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

  useEffect(() => { void load(); }, [status, query]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const updateQuery = (event: Event) => setQuery((event as CustomEvent<string>).detail);
    window.addEventListener('vsms:events-search', updateQuery);
    return () => window.removeEventListener('vsms:events-search', updateQuery);
  }, []);

  return (
    <div className="page-frame">
      <section className="page-heading">
        <div><h1>Events</h1><p>See what’s next, where it’s happening, and whether each screening crew is ready.</p></div>
      </section>
      <section className="toolbar" aria-label="Event filters">
        <div className="filter-tabs" role="group" aria-label="Filter by status">{filters.map((filter) => <button key={filter.value || 'all'} className={status === filter.value ? 'selected' : ''} aria-pressed={status === filter.value} onClick={() => setStatus(filter.value)}>{filter.label}</button>)}</div>
      </section>
      {error && <div className="alert error" role="alert"><span>{error}</span><button onClick={() => void load()}>Try again</button></div>}
      {loading && events.length === 0 ? <section className="event-card-grid event-card-loading" aria-label="Loading events" aria-live="polite">{Array.from({ length: 4 }, (_, index) => <div className="event-card skeleton-card" key={index}><span /><span /><span /><span /></div>)}</section> : events.length === 0 ? (
        <section className="empty-state">
          <CalendarDaysIcon />
          <h2>{query || status ? 'No matching events' : user?.systemRole === 'STAFF' ? 'No assigned events yet' : 'Create the first event'}</h2>
          <p>
            {query || status
              ? 'Clear or change the filters to broaden this view.'
              : user?.systemRole === 'STAFF'
                ? 'Ask an event manager to assign you to a shift. Staff cannot create events.'
                : 'Start with the date, venue, and expected capacity. You can publish when details are ready.'}
          </p>
          {(user?.systemRole === 'ADMIN' || user?.systemRole === 'EVENT_MANAGER') && (
            <Link className="primary" to="/events/new">Create event</Link>
          )}
        </section>
      ) : (
        <section className="event-card-grid event-timeline" aria-label="Events timeline">
          {events.map((event, index) => {
            const owner = event.createdBy?.username || event.createdBy?.email || 'VSMS operations';
            const date = eventDateMarker(event);
            const planners = uniquePeople(event, true);
            const operations = uniquePeople(event, false);
            return <div className="event-timeline-item" key={event.eventId}>
              <div className="event-timeline-date" aria-hidden="true"><strong>{date.day}</strong><span>{date.month}</span><small>{date.year}</small></div>
              <Link to={`/events/${event.eventId}`} className="event-card" style={{ '--card-index': Math.min(index, 8) } as CSSProperties}>
              <div className="event-card-copy">
                <time dateTime={event.startsAt}>{eventTime(event)} · {formatEventDate(event.startsAt, event.timezone, false)}</time>
                <h2>{event.name}</h2>
                <p className="event-owner">By <strong>{owner}</strong></p>
                <p className="event-location"><MapPinIcon /><span>{event.venue}</span></p>
              </div>
              <div className="event-card-media">
                <img src={getEventArtwork(event.bannerKey, event.artworkDataUrl)} alt="" loading="lazy" />
                <span className={`event-status ${event.status.toLowerCase()}`}><i />{STATUS_LABEL[event.status]}</span>
              </div>
              <footer className="event-card-footer">
                {planners.length > 0 && <div className="event-people-group"><span>Planning</span><AvatarCircles people={planners} label={`${planners.length} planning staff`} /></div>}
                {operations.length > 0 && <div className="event-people-group"><span>Operations</span><AvatarCircles people={operations} label={`${operations.length} operations staff`} /></div>}
                <span className="event-registrations"><strong>{event.activeCapacityCount.toLocaleString()} / {event.capacity.toLocaleString()}</strong> at venue<small>{event.signupCount.toLocaleString()} {event.signupCount === 1 ? 'signup' : 'signups'} collected</small></span>
              </footer>
              </Link>
            </div>;
          })}
          {nextCursor && <div className="load-more"><button className="secondary" onClick={() => void load(true)} disabled={loading}>{loading ? 'Loading…' : 'Load more events'}</button></div>}
        </section>
      )}
    </div>
  );
}
