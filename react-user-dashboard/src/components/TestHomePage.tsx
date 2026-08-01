import { Bell, LayoutDashboard, MapPin, Plus, QrCode, Search, Ticket, Users } from 'lucide-react';
import { SegmentedControl } from '@astryxdesign/core';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getEventArtwork } from '../features/events/eventBanners';
import { eventApi, type EventRecord, type EventStatus } from '../features/events/eventApi';
import { getApiMessage, useAuth } from '../auth/authState';
import { Button } from './ui/button';
import { Dock, DockIcon } from './ui/dock';
import './TestHomePage.css';

type EventItem = {
  eventId: string;
  date: string;
  day: string;
  month: string;
  title: string;
  time: string;
  venue: string;
  status: 'Live' | 'Ready' | 'Draft' | 'Complete' | 'Cancelled';
  artwork: string;
  attendance: string;
  staff: string[];
  extraStaff?: number;
};

const STATUS_LABEL: Record<EventStatus, EventItem['status']> = {
  DRAFT: 'Draft',
  PUBLISHED: 'Ready',
  IN_PROGRESS: 'Live',
  COMPLETED: 'Complete',
  CANCELLED: 'Cancelled',
};

const dateKey = (value: Date, timeZone: string) => new Intl.DateTimeFormat('en-CA', {
  year: 'numeric', month: '2-digit', day: '2-digit', timeZone,
}).format(value);

function toEventItem(event: EventRecord): EventItem {
  const startsAt = new Date(event.startsAt);
  const endsAt = new Date(event.endsAt);
  const today = new Date();
  const tomorrow = new Date(Date.now() + 86400000);
  const eventDate = dateKey(startsAt, event.timezone);
  const shortDate = new Intl.DateTimeFormat('en-SG', { day: 'numeric', month: 'short', timeZone: event.timezone }).format(startsAt);
  const names = [...new Set(event.shifts.flatMap((shift) => shift.staffAssignments.map((assignment) => assignment.user.username)))];
  const timeFormatter = new Intl.DateTimeFormat('en-SG', { hour: 'numeric', minute: '2-digit', timeZone: event.timezone });
  const zone = new Intl.DateTimeFormat('en-SG', { timeZone: event.timezone, timeZoneName: 'short' })
    .formatToParts(startsAt).find((part) => part.type === 'timeZoneName')?.value ?? event.timezone;
  const time = `${timeFormatter.format(startsAt)} – ${timeFormatter.format(endsAt)} ${zone}`.toUpperCase().replace('SGT', 'GMT+8');

  return {
    eventId: event.eventId,
    date: eventDate === dateKey(today, event.timezone) ? 'Today' : eventDate === dateKey(tomorrow, event.timezone) ? 'Tomorrow' : shortDate,
    day: new Intl.DateTimeFormat('en-SG', { weekday: 'long', timeZone: event.timezone }).format(startsAt),
    month: new Intl.DateTimeFormat('en-SG', { day: 'numeric', month: 'long', timeZone: event.timezone }).format(startsAt),
    title: event.name,
    time,
    venue: event.venue,
    status: STATUS_LABEL[event.status],
    artwork: getEventArtwork(event.bannerKey, event.artworkDataUrl),
    attendance: `${event.activeCapacityCount.toLocaleString()} / ${event.capacity.toLocaleString()}`,
    staff: names.slice(0, 4),
    extraStaff: names.length > 4 ? names.length - 4 : undefined,
  };
}

export default function TestHomePage() {
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [period, setPeriod] = useState<'upcoming' | 'past'>('upcoming');
  const [now, setNow] = useState(() => new Date());
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const canCreate = user?.systemRole !== 'STAFF';
  const profileLabel = user?.username || user?.email || 'Signed-in user';
  const profileInitials = profileLabel.split(/[@._ -]+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase();

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
    if (!searchOpen && !notificationsOpen) return;
    const closeOverlay = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const returnToSearch = searchOpen;
      setSearchOpen(false);
      setNotificationsOpen(false);
      setQuery('');
      requestAnimationFrame(() => document.getElementById(returnToSearch ? 'event-search-button' : 'event-notification-button')?.focus());
    };
    window.addEventListener('keydown', closeOverlay);
    return () => window.removeEventListener('keydown', closeOverlay);
  }, [searchOpen, notificationsOpen]);
  const localTime = new Intl.DateTimeFormat('en-SG', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Singapore',
    timeZoneName: 'short',
  }).format(now).toUpperCase().replace('SGT', 'GMT+8');
  const visibleEvents = useMemo(
    () => events.map(toEventItem)
      .filter((event) => period === 'past' ? ['Complete', 'Cancelled'].includes(event.status) : !['Complete', 'Cancelled'].includes(event.status))
      .filter((event) => `${event.title} ${event.venue}`.toLowerCase().includes(query.toLowerCase())),
    [events, period, query],
  );

  return (
    <div className="test-events-page reference-events vsms-landing-system" data-theme="dark">
      <header className="test-site-nav">
        <Link className="test-site-brand" to="/" aria-label="VSMS landing page">
          <span className="test-brand-mark" aria-hidden="true">
            <svg viewBox="0 0 32 32" fill="none">
              <path d="M9 7H6v6M23 7h3v6M9 25H6v-6M23 25h3v-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              <path d="M9 21c3.6 0 3.8-10 7.3-10 2.4 0 2.8 5.3 6.7 5.3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <circle cx="9" cy="21" r="2" fill="currentColor" />
              <circle cx="16.3" cy="11" r="2" fill="currentColor" />
              <circle cx="23" cy="16.3" r="2" fill="currentColor" />
            </svg>
          </span>
        </Link>

        <nav className="reference-header-nav" aria-label="Primary navigation">
          <Link to="/dashboard"><LayoutDashboard aria-hidden="true" />Dashboard</Link>
          <a href="#events-register" aria-current="page"><Ticket aria-hidden="true" />Events</a>
          <Link to="/qr-generator"><QrCode aria-hidden="true" />QR passes</Link>
        </nav>

        <div className={`test-header-actions ${searchOpen ? 'searching' : ''}`}>
          <time className="reference-local-time" dateTime={now.toISOString()}>{localTime}</time>
          {searchOpen && (
            <label className="test-header-search">
              <Search aria-hidden="true" />
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
          <Button id="event-search-button" className="test-header-icon" variant="ghost" size="icon" aria-label={searchOpen ? 'Close search' : 'Search events'} aria-expanded={searchOpen} aria-controls="desktop-event-search" onClick={() => {
              setSearchOpen((open) => !open);
              if (searchOpen) setQuery('');
            }}>
            <Search aria-hidden="true" />
          </Button>
          <Button
            id="event-notification-button"
            className="test-header-icon"
            variant="ghost"
            size="icon"
            aria-label="Notifications"
            aria-expanded={notificationsOpen}
            aria-controls="desktop-notifications"
            onClick={() => setNotificationsOpen((open) => !open)}
          >
            <Bell aria-hidden="true" />
          </Button>
          {notificationsOpen && <div id="desktop-notifications" className="test-notification-popover" role="status"><strong>You’re all caught up</strong><span>No new event alerts.</span></div>}
          <Button className="test-profile-action" variant="ghost" aria-label={`Sign out ${profileLabel}`} onClick={() => void logout()}><span aria-hidden="true">{profileInitials}</span></Button>
        </div>
      </header>

      <div className="reference-mobile-header">
        <Link className="reference-mobile-brand" to="/" aria-label="VSMS home">
          <svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
            <path d="M9 7H6v6M23 7h3v6M9 25H6v-6M23 25h3v-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            <path d="M9 21c3.6 0 3.8-10 7.3-10 2.4 0 2.8 5.3 6.7 5.3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <circle cx="9" cy="21" r="2" fill="currentColor" />
            <circle cx="16.3" cy="11" r="2" fill="currentColor" />
            <circle cx="23" cy="16.3" r="2" fill="currentColor" />
          </svg>
        </Link>
        <div className="reference-mobile-actions">
          <button className="reference-mobile-notifications" type="button" aria-label="Notifications" aria-expanded={notificationsOpen} aria-controls="mobile-notifications" onClick={() => {
            setNotificationsOpen((open) => !open);
            setSearchOpen(false);
            setQuery('');
          }}><Bell aria-hidden="true" /></button>
          <button className="reference-mobile-profile" type="button" aria-label={`Sign out ${profileLabel}`} onClick={() => void logout()}><span aria-hidden="true">{profileInitials}</span></button>
        </div>
      </div>

      {searchOpen && (
        <label className="reference-mobile-search">
          <Search aria-hidden="true" />
          <span className="sr-only">Search events</span>
          <input autoFocus type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search events" />
        </label>
      )}
      {notificationsOpen && <div id="mobile-notifications" className="reference-mobile-notification" role="status"><strong>You’re all caught up</strong><span>No new event alerts.</span></div>}

      <nav className="reference-mobile-dock" aria-label="Mobile navigation">
        <Dock iconSize={44} iconMagnification={52} iconDistance={100} disableMagnification direction="middle">
          <DockIcon><Link className="reference-dock-action" to="/dashboard" aria-label="Dashboard"><LayoutDashboard aria-hidden="true" /></Link></DockIcon>
          <DockIcon>
            <a className="reference-dock-action active" href="#events-register" aria-label="Events" aria-current="page"><Ticket aria-hidden="true" /></a>
          </DockIcon>
          <DockIcon>
            <button className={`reference-dock-action ${searchOpen ? 'active' : ''}`} type="button" aria-label={searchOpen ? 'Close search' : 'Search events'} aria-expanded={searchOpen} onClick={() => {
              setSearchOpen((open) => !open);
              setNotificationsOpen(false);
              if (searchOpen) setQuery('');
            }}><Search aria-hidden="true" /></button>
          </DockIcon>
          <DockIcon><Link className="reference-dock-action" to="/qr-generator" aria-label="QR passes"><QrCode aria-hidden="true" /></Link></DockIcon>
          {canCreate && <DockIcon><Link className="reference-dock-action" to="/events/new" aria-label="Create event"><Plus aria-hidden="true" /></Link></DockIcon>}
        </Dock>
      </nav>

      <main className="test-events-main">
        <section className="test-register-intro">
          <h1><span>Events</span><span>Your Events</span></h1>
          <SegmentedControl className="test-period-tabs" value={period} onChange={(value) => setPeriod(value === 'past' ? 'past' : 'upcoming')} label="Event period" size="sm" layout="fill">
            <button type="button" role="radio" data-value="upcoming" aria-checked={period === 'upcoming'} tabIndex={period === 'upcoming' ? 0 : -1} onClick={() => setPeriod('upcoming')}>Upcoming</button>
            <button type="button" role="radio" data-value="past" aria-checked={period === 'past'} tabIndex={period === 'past' ? 0 : -1} onClick={() => setPeriod('past')}>Past</button>
          </SegmentedControl>
          {canCreate && <Button className="reference-new-event" onClick={() => navigate('/events/new')}><Plus aria-hidden="true" />New event</Button>}
        </section>

        {error ? (
          <section className="test-empty-state" role="alert">
            <h2>Events could not be loaded</h2>
            <p>{error}</p>
            <Button variant="ghost" onClick={() => void loadEvents()}>Try again</Button>
          </section>
        ) : loading ? (
          <section className="test-empty-state" aria-live="polite">
            <span className="spinner" />
            <h2>Loading events</h2>
          </section>
        ) : visibleEvents.length ? (
          <section className="test-event-register" id="events-register" aria-label={`${period === 'upcoming' ? 'Upcoming' : 'Past'} events`}>
            {visibleEvents.map((event) => (
              <article className={`test-register-row ${event.status.toLowerCase()}`} key={event.eventId} aria-label={`${event.title}, status ${event.status}`}>
                <div className="test-register-row-date">
                  <strong>{event.date}</strong>
                  <span>{event.day}</span>
                  <small>{event.month}</small>
                </div>
                <span className="reference-timeline" aria-hidden="true"><i /></span>
                <div className="reference-event-card">
                  <Link className="test-register-row-link" to={`/events/${event.eventId}`} aria-label={`Open ${event.title}`} />
                  <div className="reference-event-media">
                    <img src={event.artwork} alt="" loading="lazy" />
                  </div>
                  <div className="test-register-event">
                    <div className="reference-event-time">
                      {event.status === 'Live' && <span><i aria-hidden="true" />Live</span>}
                      <time className="reference-time-desktop">{event.time}</time>
                      <time className="reference-time-mobile">{event.date === 'Today' ? event.time : `${event.date}, ${event.time}`}</time>
                    </div>
                    <h2>{event.title}</h2>
                    <p><MapPin aria-hidden="true" />{event.venue}</p>
                    <p className="reference-attendance-desktop"><Users aria-hidden="true" />{event.attendance}</p>
                    <p className="reference-attendance-mobile"><Users aria-hidden="true" />{event.attendance}</p>
                    <div className="reference-team" aria-label={`Assigned staff: ${event.staff.join(', ')}${event.extraStaff ? `, plus ${event.extraStaff} more` : ''}`}>
                      {event.staff.map((name, index) => <span className={`team-${index + 1}`} key={name} title={name} aria-label={name}>{name.split(' ').map((part) => part[0]).join('')}</span>)}
                      {event.extraStaff ? <small>+{event.extraStaff}</small> : null}
                    </div>
                  </div>
                  <div className="test-register-state">
                    <span className="test-row-action" aria-hidden="true">Open</span>
                  </div>
                </div>
              </article>
            ))}
          </section>
        ) : (
          <section className="test-empty-state" aria-live="polite">
            <Search aria-hidden="true" />
            <h2>{query ? 'No events found' : period === 'upcoming' ? 'No upcoming events' : 'No past events'}</h2>
            <p>{query ? 'Try a different event or venue name.' : period === 'upcoming' ? 'Assigned and newly created events will appear here.' : 'Completed and cancelled events will appear here.'}</p>
            {query && <Button variant="ghost" onClick={() => setQuery('')}>Clear search</Button>}
            {!query && period === 'upcoming' && canCreate && <Button onClick={() => navigate('/events/new')}><Plus aria-hidden="true" />Create event</Button>}
          </section>
        )}

      </main>
    </div>
  );
}
