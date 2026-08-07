import { ChartBarSquareIcon, MagnifyingGlassIcon, MapPinIcon, PlusIcon, TicketIcon, UserGroupIcon, UsersIcon } from '@heroicons/react/24/outline';
import { SegmentedControl } from '@astryxdesign/core';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getEventArtwork } from '../features/events/eventBanners';
import { eventApi, type EventRecord, type EventStatus } from '../features/events/eventApi';
import { useAuth } from '../auth/AuthProvider';
import { getApiError as getApiMessage } from '../utils/apiClient';
import { Button } from './ui/button';
import { Dock, DockIcon } from './ui/dock';
import { ThemeToggle } from './MagicEffects';
import './EventsPage.css';
import ProfileMenu from './ProfileMenu';

type EventItem = {
  eventId: string;
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

function toEventItem(event: EventRecord, now: Date): EventItem {
  const startsAt = new Date(event.startsAt);
  const endsAt = new Date(event.endsAt);
  const tomorrow = new Date(now.getTime() + 86400000);
  const statusKey = event.status === 'IN_PROGRESS' && endsAt <= now ? 'COMPLETED' : event.status;
  const eventDate = dateKey(startsAt, event.timezone);
  const shortDate = new Intl.DateTimeFormat('en-SG', { day: 'numeric', month: 'short', timeZone: event.timezone }).format(startsAt);
  const names = event.canManage
    ? [...new Set(event.shifts.flatMap((shift) => shift.staffAssignments.map((assignment) => assignment.user.username)))]
    : [];
  const timeFormatter = new Intl.DateTimeFormat('en-SG', { hour: 'numeric', minute: '2-digit', timeZone: event.timezone });
  const time = `${timeFormatter.format(startsAt)} – ${timeFormatter.format(endsAt)}`.toUpperCase();

  return {
    eventId: event.eventId,
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
  const [searchOpen, setSearchOpen] = useState(false);
  const [period, setPeriod] = useState<'upcoming' | 'past'>('upcoming');
  const [now, setNow] = useState(() => new Date());
  const { session } = useAuth();
  const user = session?.user;
  const navigate = useNavigate();
  const canViewReports = user?.roles.some((role) => ['ADMINISTRATOR', 'EVENT_MANAGER'].includes(role)) ?? false;
  const canCreate = user?.roles.includes('ADMINISTRATOR') ?? false;
  const canManageStaff = canCreate;
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
  useEffect(() => {
    if (!searchOpen) return;
    const closeOverlay = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setSearchOpen(false);
      setQuery('');
      requestAnimationFrame(() => document.getElementById('event-search-button')?.focus());
    };
    window.addEventListener('keydown', closeOverlay);
    return () => window.removeEventListener('keydown', closeOverlay);
  }, [searchOpen]);
  const localTime = new Intl.DateTimeFormat('en-SG', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Singapore',
  }).format(now).toUpperCase();
  const visibleEvents = useMemo(
    () => events.map((event) => toEventItem(event, now))
      .filter((event) => period === 'past' ? ['COMPLETED', 'CANCELLED'].includes(event.statusKey) : !['COMPLETED', 'CANCELLED'].includes(event.statusKey))
      .filter((event) => `${event.title} ${event.venue}`.toLowerCase().includes(query.toLowerCase())),
    [events, now, period, query],
  );

  return (
    <div className="events-page vsms-landing-system">
      <header className="events-site-nav">
        <Link className="events-site-brand" to="/" aria-label="VSMS landing page">
          <span className="events-brand-mark" aria-hidden="true">
            <svg viewBox="0 0 32 32" fill="none">
              <path d="M9 7H6v6M23 7h3v6M9 25H6v-6M23 25h3v-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              <path d="M9 21c3.6 0 3.8-10 7.3-10 2.4 0 2.8 5.3 6.7 5.3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <circle cx="9" cy="21" r="2" fill="currentColor" />
              <circle cx="16.3" cy="11" r="2" fill="currentColor" />
              <circle cx="23" cy="16.3" r="2" fill="currentColor" />
            </svg>
          </span>
        </Link>

        <nav className="events-header-nav" aria-label="Primary navigation">
          <a href="#events-register" aria-current="page"><TicketIcon aria-hidden="true" />Events</a>
          {canViewReports && <Link to="/reports"><ChartBarSquareIcon aria-hidden="true" />Reports</Link>}
          {canManageStaff && <Link to="/staff"><UserGroupIcon aria-hidden="true" />Staff</Link>}
        </nav>

        <div className={`events-header-actions ${searchOpen ? 'searching' : ''}`}>
          {canCreate && <Button className="events-header-create" onClick={() => navigate('/events/new')}><PlusIcon aria-hidden="true" />New event</Button>}
          <time className="events-local-time" dateTime={now.toISOString()}>{localTime}</time>
          {searchOpen && (
            <label className="events-header-search">
              <MagnifyingGlassIcon aria-hidden="true" />
              <span className="sr-only">Search events</span>
              <input id="desktop-event-search"
                autoFocus
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search events"
              />
            </label>
          )}
          <Button id="event-search-button" className="events-header-icon" variant="ghost" size="icon" aria-label={searchOpen ? 'Close search' : 'Search events'} aria-expanded={searchOpen} aria-controls="desktop-event-search" onClick={() => {
              setSearchOpen((open) => !open);
              if (searchOpen) setQuery('');
            }}>
            <MagnifyingGlassIcon aria-hidden="true" />
          </Button>
          <ThemeToggle className="events-header-icon events-theme-toggle" />
          <ProfileMenu triggerClassName="events-profile-action" compact />
        </div>
      </header>

      <div className="events-mobile-header">
        <Link className="events-mobile-brand" to="/" aria-label="VSMS home">
          <svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
            <path d="M9 7H6v6M23 7h3v6M9 25H6v-6M23 25h3v-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            <path d="M9 21c3.6 0 3.8-10 7.3-10 2.4 0 2.8 5.3 6.7 5.3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <circle cx="9" cy="21" r="2" fill="currentColor" />
            <circle cx="16.3" cy="11" r="2" fill="currentColor" />
            <circle cx="23" cy="16.3" r="2" fill="currentColor" />
          </svg>
        </Link>
        <div className="events-mobile-actions">
          <ProfileMenu triggerClassName="events-mobile-profile" compact />
        </div>
      </div>

      {searchOpen && (
        <label className="events-mobile-search">
          <MagnifyingGlassIcon aria-hidden="true" />
          <span className="sr-only">Search events</span>
          <input autoFocus type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search events" />
        </label>
      )}
      <nav className="events-mobile-dock" aria-label="Mobile navigation">
        <Dock iconSize={44} iconMagnification={52} iconDistance={100} disableMagnification direction="middle">
          <DockIcon>
            <a className="events-dock-action active" href="#events-register" aria-label="Events" aria-current="page"><TicketIcon aria-hidden="true" /></a>
          </DockIcon>
          {canViewReports && <DockIcon><Link className="events-dock-action" to="/reports" aria-label="Operational reports"><ChartBarSquareIcon aria-hidden="true" /></Link></DockIcon>}
          {canManageStaff && <DockIcon><Link className="events-dock-action" to="/staff" aria-label="Staff accounts"><UserGroupIcon aria-hidden="true" /></Link></DockIcon>}
          <DockIcon>
            <button className={`events-dock-action ${searchOpen ? 'active' : ''}`} type="button" aria-label={searchOpen ? 'Close search' : 'Search events'} aria-expanded={searchOpen} onClick={() => {
              setSearchOpen((open) => !open);
              if (searchOpen) setQuery('');
            }}><MagnifyingGlassIcon aria-hidden="true" /></button>
          </DockIcon>
          <DockIcon><ThemeToggle className="events-dock-action events-mobile-theme" /></DockIcon>
          {canCreate && <DockIcon><Link className="events-dock-action" to="/events/new" aria-label="Create event"><PlusIcon aria-hidden="true" /></Link></DockIcon>}
        </Dock>
      </nav>

      <main className="events-main">
        <section className="events-register-intro">
          <h1><span>Events</span><span>Your Events</span></h1>
          <SegmentedControl className="events-period-tabs" value={period} onChange={(value) => setPeriod(value === 'past' ? 'past' : 'upcoming')} label="Event period" size="sm" layout="fill">
            <button type="button" role="radio" data-value="upcoming" aria-checked={period === 'upcoming'} tabIndex={period === 'upcoming' ? 0 : -1} onClick={() => setPeriod('upcoming')}>Upcoming</button>
            <button type="button" role="radio" data-value="past" aria-checked={period === 'past'} tabIndex={period === 'past' ? 0 : -1} onClick={() => setPeriod('past')}>Past</button>
          </SegmentedControl>
        </section>

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
            {visibleEvents.map((event) => (
              <article className={`events-register-row status-${event.statusKey.toLowerCase()} ${event.date === 'Today' ? 'today' : ''}`} key={event.eventId} aria-label={`${event.title}, status ${event.status}`}>
                <div className="events-register-row-date">
                  <strong>{event.date}</strong>
                  <span>{event.day}</span>
                  <small>{event.month}</small>
                </div>
                <span className="events-timeline" aria-hidden="true"><i /></span>
                <div className="events-event-card">
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
                    <p className="events-attendance-mobile"><UsersIcon aria-hidden="true" />{event.attendance}</p>
                    <div className={`events-team ${event.staff.length ? '' : 'empty'}`} aria-label={event.staff.length ? `Assigned staff: ${event.staff.join(', ')}${event.extraStaff ? `, plus ${event.extraStaff} more` : ''}` : 'No staff assigned'}>
                      {event.staff.map((name, index) => <span className={`events-team-avatar team-${index + 1}`} key={name} title={name} aria-label={name}>{name.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase()}</span>)}
                      {event.extraStaff ? <small className="events-team-more">+{event.extraStaff}</small> : null}
                      {!event.staff.length && <><span className="events-team-empty-icon" aria-hidden="true"><UsersIcon /></span><em>No staff assigned</em></>}
                    </div></>}
                  </div>
                  <div className="events-register-state">
                    <Link className="events-row-action" to={`/events/${event.eventId}`} aria-label={`Open ${event.title}`}>Open</Link>
                  </div>
                </div>
              </article>
            ))}
          </section>
        ) : (
          <section className="events-empty-state" aria-live="polite">
            <MagnifyingGlassIcon aria-hidden="true" />
            <h2>{query ? 'No events found' : period === 'upcoming' ? 'No upcoming events' : 'No past events'}</h2>
            <p>{query ? 'Try a different event or venue name.' : period === 'upcoming' ? 'Assigned and newly created events will appear here.' : 'Completed and cancelled events will appear here.'}</p>
            {query && <Button variant="ghost" onClick={() => setQuery('')}>Clear search</Button>}
            {!query && period === 'upcoming' && canCreate && <Button onClick={() => navigate('/events/new')}><PlusIcon aria-hidden="true" />Create event</Button>}
          </section>
        )}

      </main>
    </div>
  );
}
