import { MagnifyingGlassIcon, MapPinIcon, PlusIcon, UsersIcon } from '@heroicons/react/24/outline';
import { SegmentedControl } from '@astryxdesign/core';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getEventArtwork } from '../features/events/eventBanners';
import { eventApi, type EventRecord, type EventStatus } from '../features/events/eventApi';
import { getEventDisplayStatus, getEventScheduleDays, groupEventItemsByDate, sortEventItems } from '../features/events/eventDisplayStatus';
import { useAuth } from '../auth/AuthProvider';
import { getApiError as getApiMessage } from '../utils/apiClient';
import { Button } from './ui/button';
import './EventsPage.css';

type EventItem = {
  eventId: string;
  groupKey: string;
  sortKey: string;
  date: string;
  day: string;
  month: string;
  title: string;
  time: string;
  venue: string;
  status: 'To plan' | 'Assigned' | 'Ongoing' | 'Completed' | 'Cancelled';
  statusKey: EventStatus;
  artwork: string;
  canManage: boolean;
  attendance: string;
  staff: string[];
  extraStaff?: number;
};

const STATUS_LABEL: Record<EventStatus, EventItem['status']> = {
  DRAFT: 'To plan',
  PUBLISHED: 'Assigned',
  IN_PROGRESS: 'Ongoing',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

const dateKey = (value: Date, timeZone: string) => new Intl.DateTimeFormat('en-CA', {
  year: 'numeric', month: '2-digit', day: '2-digit', timeZone,
}).format(value);

function toEventItem(event: EventRecord, scheduleDay: { startsAt: string; endsAt: string }, now: Date): EventItem {
  const startsAt = new Date(scheduleDay.startsAt);
  const endsAt = new Date(scheduleDay.endsAt);
  const tomorrow = new Date(now.getTime() + 86400000);
  const displayStatus = getEventDisplayStatus(event.status, scheduleDay.endsAt, now);
  const statusKey = displayStatus === 'ENDED' ? 'COMPLETED' : displayStatus;
  const eventDate = dateKey(startsAt, event.timezone);
  const shortDate = new Intl.DateTimeFormat('en-SG', { day: 'numeric', month: 'short', timeZone: event.timezone }).format(startsAt);
  const names = [...new Set(event.eventTeam?.length ? event.eventTeam : event.shifts.flatMap((shift) => shift.staffAssignments.map((assignment) => assignment.user.username)))];
  const timeFormatter = new Intl.DateTimeFormat('en-SG', { hour: 'numeric', minute: '2-digit', timeZone: event.timezone });
  const time = `${timeFormatter.format(startsAt)} – ${timeFormatter.format(endsAt)}`.toUpperCase();

  return {
    eventId: event.eventId,
    groupKey: eventDate,
    sortKey: scheduleDay.endsAt,
    date: eventDate === dateKey(now, event.timezone) ? 'Today' : eventDate === dateKey(tomorrow, event.timezone) ? 'Tomorrow' : shortDate,
    day: new Intl.DateTimeFormat('en-SG', { weekday: 'long', timeZone: event.timezone }).format(startsAt),
    month: new Intl.DateTimeFormat('en-SG', { day: 'numeric', month: 'long', timeZone: event.timezone }).format(startsAt),
    title: event.name,
    time,
    venue: event.venue,
    status: STATUS_LABEL[statusKey],
    statusKey,
    artwork: getEventArtwork(event.bannerKey, event.artworkDataUrl),
    canManage: event.canManage,
    attendance: `${event.activeCapacityCount.toLocaleString()} checked in / ${event.capacity.toLocaleString()} capacity`,
    staff: names.slice(0, 4),
    extraStaff: names.length > 4 ? names.length - 4 : undefined,
  };
}

export default function EventsPage() {
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [period, setPeriod] = useState<'upcoming' | 'past'>('upcoming');
  const [now, setNow] = useState(() => new Date());
  const { session } = useAuth();
  const user = session?.user;
  const navigate = useNavigate();
  const canCreate = user?.roles.includes('ADMINISTRATOR') ?? false;
  const loadEvents = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await eventApi.list();
      setEvents(data.events);
    } catch (cause) {
      setError(getApiMessage(cause, 'Events could not be loaded.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadEvents(); }, [loadEvents]);
  useEffect(() => {
    const clock = window.setInterval(() => setNow(new Date()), 60000);
    return () => window.clearInterval(clock);
  }, []);
  const visibleEvents = useMemo(
    () => sortEventItems(events.flatMap((event) => getEventScheduleDays(event.eventDays, event.startsAt, event.endsAt).map((day) => toEventItem(event, day, now)))
      .filter((event) => period === 'past' ? ['COMPLETED', 'CANCELLED'].includes(event.statusKey) : !['COMPLETED', 'CANCELLED'].includes(event.statusKey))
      .filter((event) => `${event.title} ${event.venue}`.toLowerCase().includes(query.toLowerCase())), period === 'past'),
    [events, now, period, query],
  );
  const groupedEvents = useMemo(() => {
    return groupEventItemsByDate(visibleEvents).map((events) => ({ ...events[0], events }));
  }, [visibleEvents]);

  return (
    <div className="events-page vsms-landing-system">
      <main className="events-main">
        <section className="events-register-intro">
          <h1><span>Events</span><span>Your Events</span></h1>
          <SegmentedControl className="events-period-tabs" value={period} onChange={(value) => setPeriod(value === 'past' ? 'past' : 'upcoming')} label="Event period" size="sm" layout="fill">
            <button type="button" role="radio" data-value="upcoming" aria-checked={period === 'upcoming'} tabIndex={period === 'upcoming' ? 0 : -1} onClick={() => setPeriod('upcoming')}>Upcoming</button>
            <button type="button" role="radio" data-value="past" aria-checked={period === 'past'} tabIndex={period === 'past' ? 0 : -1} onClick={() => setPeriod('past')}>Past</button>
          </SegmentedControl>
        </section>

        <label className="events-list-search">
          <MagnifyingGlassIcon aria-hidden="true" />
          <span className="sr-only">Search events</span>
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search events or venues" />
        </label>

        {error ? (
          <section className="events-empty-state" role="alert">
            <h2>Events could not be loaded</h2>
            <p>{error}</p>
            <Button variant="ghost" onClick={() => void loadEvents()}>Try again</Button>
          </section>
        ) : loading ? (
          <section className="events-empty-state" aria-live="polite">
            <span className="spinner" />
            <h2>Loading events</h2>
          </section>
        ) : visibleEvents.length ? (
          <section className="events-register" id="events-register" aria-label={`${period === 'upcoming' ? 'Upcoming' : 'Past'} events`}>
            {groupedEvents.map((group) => (
              <section className={`events-register-row ${group.date === 'Today' ? 'today' : ''}`} key={group.groupKey} aria-label={`${group.month} events`}>
                <div className="events-register-row-date">
                  <strong>{group.date}</strong>
                  <span>{group.day}</span>
                  <small>{group.month}</small>
                </div>
                <span className="events-timeline" aria-hidden="true"><i /></span>
                <div className="events-date-cards">
                {group.events.map((event) => <article className="events-event-card" key={event.eventId} aria-label={`${event.title}, status ${event.status}`}>
                  <div className="events-event-media">
                    <img src={event.artwork} alt="" loading="lazy" />
                  </div>
                  <div className="events-register-event">
                    <div className="events-event-time">
                      <span className={`events-status-tag status-${event.statusKey.toLowerCase()}`}><i aria-hidden="true" />{event.status}</span>
                      <time className="events-time-desktop">{event.time}</time>
                      <time className="events-time-mobile">{event.date === 'Today' ? event.time : `${event.date}, ${event.time}`}</time>
                    </div>
                    <h2>{event.title}</h2>
                    <p><MapPinIcon aria-hidden="true" />{event.venue}</p>
                    {event.canManage && <><p className="events-attendance-desktop"><UsersIcon aria-hidden="true" />{event.attendance}</p>
                    <p className="events-attendance-mobile"><UsersIcon aria-hidden="true" />{event.attendance}</p></>}
                    <div className={`events-team ${event.staff.length ? '' : 'empty'}`} aria-label={event.staff.length ? `Assigned staff: ${event.staff.join(', ')}${event.extraStaff ? `, plus ${event.extraStaff} more` : ''}` : 'No staff assigned'}>
                      {event.staff.map((name, index) => <span className={`events-team-avatar team-${index + 1}`} key={name} title={name} aria-label={name}>{name.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase()}</span>)}
                      {event.extraStaff ? <small className="events-team-more">+{event.extraStaff}</small> : null}
                      {!event.staff.length && <><span className="events-team-empty-icon" aria-hidden="true"><UsersIcon /></span><em>No staff assigned</em></>}
                    </div>
                  </div>
                  <div className="events-register-state">
                    <Link className="events-row-action" to={`/events/${event.eventId}`} aria-label={`Open ${event.title}`}>Open</Link>
                  </div>
                </article>)}
                </div>
              </section>
            ))}
          </section>
        ) : (
          <section className="events-empty-state" aria-live="polite">
            <MagnifyingGlassIcon aria-hidden="true" />
            <h2>{query ? 'No events found' : canCreate ? period === 'upcoming' ? 'No upcoming events' : 'No past events' : 'No events assigned'}</h2>
            <p>{query ? 'Try a different event or venue name.' : canCreate ? period === 'upcoming' ? 'Assigned and newly created events will appear here.' : 'Completed and cancelled events will appear here.' : 'An administrator or event manager needs to assign you to an event.'}</p>
            {query && <Button variant="ghost" onClick={() => setQuery('')}>Clear search</Button>}
            {!query && period === 'upcoming' && canCreate && <Button onClick={() => navigate('/events/new')}><PlusIcon aria-hidden="true" />Create event</Button>}
          </section>
        )}

      </main>
    </div>
  );
}
