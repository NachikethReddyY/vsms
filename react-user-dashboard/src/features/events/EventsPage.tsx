import { CalendarDaysIcon, MapPinIcon, MagnifyingGlassIcon, PlusIcon } from '@heroicons/react/24/outline';
import { useEffect, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { getApiMessage, useAuth } from '../../auth/authState';
import { eventApi, formatEventDate, STATUS_LABEL, type EventRecord, type EventStatus } from './eventApi';
import { AnimatedCircularProgress, AvatarCircles } from '../../components/MagicEffects';
import { getEventBanner } from './eventBanners';

const filters: Array<{ value: '' | EventStatus; label: string }> = [
  { value: '', label: 'All events' }, { value: 'DRAFT', label: 'Draft' }, { value: 'PUBLISHED', label: 'Published' },
  { value: 'IN_PROGRESS', label: 'In progress' }, { value: 'COMPLETED', label: 'Completed' }, { value: 'CANCELLED', label: 'Cancelled' },
];

const lifecycleProgress: Record<EventStatus, number> = { DRAFT: 25, PUBLISHED: 50, IN_PROGRESS: 75, COMPLETED: 100, CANCELLED: 0 };

function eventTime(event: EventRecord) {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZone: event.timezone }).format(new Date(event.startsAt));
}

export default function EventsPage() {
  const { user } = useAuth();
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [status, setStatus] = useState<'' | EventStatus>('');
  const [search, setSearch] = useState('');
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

  return (
    <div className="page-frame">
      <section className="page-heading">
        <div><h1>Events</h1><p>See what’s next, where it’s happening, and whether each screening crew is ready.</p></div>
        {user?.systemRole !== 'STAFF' && <Link className="primary interactive-cta" to="/events/new"><span>Create event</span><PlusIcon /></Link>}
      </section>
      <section className="toolbar" aria-label="Event filters">
        <form className="list-search" onSubmit={(e) => { e.preventDefault(); setQuery(search.trim()); }}><MagnifyingGlassIcon /><label className="sr-only" htmlFor="event-search">Search events</label><input id="event-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by event or venue"/><button className="secondary" type="submit">Search</button></form>
        <div className="filter-tabs" role="group" aria-label="Filter by status">{filters.map((filter) => <button key={filter.value || 'all'} className={status === filter.value ? 'selected' : ''} aria-pressed={status === filter.value} onClick={() => setStatus(filter.value)}>{filter.label}</button>)}</div>
      </section>
      {error && <div className="alert error" role="alert"><span>{error}</span><button onClick={() => void load()}>Try again</button></div>}
      {loading && events.length === 0 ? <section className="event-card-grid event-card-loading" aria-label="Loading events" aria-live="polite">{Array.from({ length: 4 }, (_, index) => <div className="event-card skeleton-card" key={index}><span /><span /><span /><span /></div>)}</section> : events.length === 0 ? (
        <section className="empty-state"><CalendarDaysIcon /><h2>{query || status ? 'No matching events' : 'Create the first event'}</h2><p>{query || status ? 'Clear or change the filters to broaden this view.' : 'Start with the date, venue, and expected capacity. You can publish when details are ready.'}</p>{user?.systemRole !== 'STAFF' && <Link className="primary" to="/events/new">Create event</Link>}</section>
      ) : (
        <section className="event-card-grid" aria-label="Events">
          {events.map((event, index) => {
            const crewCount = event.shifts.reduce((total, shift) => total + shift.requiredStaff, 0);
            const owner = event.createdBy?.username || event.createdBy?.email || 'VSMS operations';
            return <Link to={`/events/${event.eventId}`} className="event-card" key={event.eventId} style={{ '--card-index': Math.min(index, 8) } as CSSProperties}>
              <div className="event-card-copy">
                <time dateTime={event.startsAt}>{eventTime(event)} · {formatEventDate(event.startsAt, event.timezone, false)}</time>
                <h2>{event.name}</h2>
                <p className="event-owner">By <strong>{owner}</strong></p>
                <p className="event-location"><MapPinIcon /><span>{event.venue}</span></p>
              </div>
              <div className="event-card-media">
                <img src={getEventBanner(event.bannerKey).src} alt="" loading="lazy" />
                <span className={`event-status ${event.status.toLowerCase()}`}><i />{STATUS_LABEL[event.status]}</span>
              </div>
              <footer className="event-card-footer">
                <div className="event-crew"><AvatarCircles count={crewCount} /><span>{crewCount ? `${crewCount} staff planned` : 'Crew not planned'}</span></div>
                <span className="event-capacity">{event.capacity.toLocaleString()} capacity</span>
                {event.status !== 'CANCELLED' && <AnimatedCircularProgress value={lifecycleProgress[event.status]} label="Lifecycle progress" />}
              </footer>
            </Link>;
          })}
          {nextCursor && <div className="load-more"><button className="secondary" onClick={() => void load(true)} disabled={loading}>{loading ? 'Loading…' : 'Load more events'}</button></div>}
        </section>
      )}
    </div>
  );
}
