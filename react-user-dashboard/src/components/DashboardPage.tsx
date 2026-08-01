import { ArrowRightIcon, CalendarDaysIcon, MapPinIcon, PlusIcon } from '@heroicons/react/24/outline';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { getApiMessage, useAuth } from '../auth/authState';
import { eventApi, formatEventDate, STATUS_LABEL, type EventRecord } from '../features/events/eventApi';

export default function DashboardPage() {
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const { user } = useAuth();
  const canCreate = user?.systemRole === 'ADMIN' || user?.systemRole === 'EVENT_MANAGER';

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setEvents((await eventApi.list()).events); }
    catch (cause) { setError(getApiMessage(cause, 'Your event work could not be loaded.')); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const counts = useMemo(() => ({
    live: events.filter((event) => event.status === 'IN_PROGRESS').length,
    ready: events.filter((event) => event.status === 'PUBLISHED').length,
    draft: events.filter((event) => event.status === 'DRAFT').length,
    complete: events.filter((event) => event.status === 'COMPLETED').length,
  }), [events]);
  const nextEvent = events.find((event) => event.status === 'IN_PROGRESS')
    ?? events.find((event) => event.status === 'PUBLISHED')
    ?? events.find((event) => event.status === 'DRAFT');

  return <div className="page-frame dashboard-page">
    <header className="page-heading dashboard-heading">
      <div><h1>Your event work</h1><p>A focused view of the events currently visible to your account.</p></div>
      <div className="dashboard-actions"><Link className="secondary" to="/events">View all events</Link>{canCreate && <Link className="primary" to="/events/new"><PlusIcon />New event</Link>}</div>
    </header>

    {error && <div className="alert error" role="alert"><span>{error}</span><button onClick={() => void load()}>Try again</button></div>}
    {loading ? <section className="dashboard-loading" aria-label="Loading dashboard" aria-live="polite"><span /><span /><span /></section> : events.length === 0 ? <section className="empty-state"><CalendarDaysIcon /><h2>No assigned events</h2><p>Events you create or join will appear here. You can still open the event register.</p><Link className="secondary" to="/events">Open events</Link></section> : <>
      <section className="dashboard-summary" aria-label="Visible event summary">
        <div><strong>{counts.live}</strong><span>In progress</span></div>
        <div><strong>{counts.ready}</strong><span>Ready</span></div>
        <div><strong>{counts.draft}</strong><span>Draft</span></div>
        <div><strong>{counts.complete}</strong><span>Complete</span></div>
      </section>

      {nextEvent && <section className="dashboard-next" aria-labelledby="next-event-title">
        <div className="dashboard-section-heading"><div><h2 id="next-event-title">Next operational event</h2><p>Open the record to review its current setup and staffing.</p></div><span className={`status-line ${nextEvent.status.toLowerCase()}`}><i className={`status-dot ${nextEvent.status.toLowerCase()}`} />{STATUS_LABEL[nextEvent.status]}</span></div>
        <Link className="dashboard-event-row" to={`/events/${nextEvent.eventId}`}>
          <div><strong>{nextEvent.name}</strong><span><MapPinIcon />{nextEvent.venue}</span></div>
          <time dateTime={nextEvent.startsAt}>{formatEventDate(nextEvent.startsAt, nextEvent.timezone)}</time>
          <span className="dashboard-open">Open event <ArrowRightIcon /></span>
        </Link>
      </section>}

      <section className="dashboard-recent" aria-labelledby="visible-events-title">
        <div className="dashboard-section-heading"><div><h2 id="visible-events-title">Visible events</h2><p>This summary uses the first scoped page of your event register.</p></div></div>
        <div className="dashboard-event-list">{events.slice(0, 5).map((event) => <Link key={event.eventId} to={`/events/${event.eventId}`}><span><i className={`status-dot ${event.status.toLowerCase()}`} />{event.name}</span><time dateTime={event.startsAt}>{formatEventDate(event.startsAt, event.timezone, false)}</time><ArrowRightIcon /></Link>)}</div>
      </section>
    </>}
  </div>;
}
