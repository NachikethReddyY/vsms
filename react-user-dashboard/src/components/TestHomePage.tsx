import { Bell, ChevronRight, MapPin, Search, Ticket, Users } from 'lucide-react';
import { SegmentedControl } from '@astryxdesign/core';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getEventArtwork } from '../features/events/eventBanners';
import { Button } from './ui/button';
import { Dock, DockIcon } from './ui/dock';
import './TestHomePage.css';

type EventItem = {
  date: string;
  day: string;
  month: string;
  title: string;
  time: string;
  venue: string;
  status: 'Live' | 'Ready' | 'Draft' | 'Complete';
  banner: string;
  attendance: string;
  progress?: number;
  stationState: string;
  staff: string[];
  extraStaff?: number;
};

const upcoming: EventItem[] = [
  {
    date: 'Today',
    day: 'Friday',
    month: '31 July',
    title: 'Queenstown Community Vision Day',
    time: '8:00 AM – 2:00 PM GMT+8',
    venue: 'Queenstown Community Centre',
    status: 'Live',
    banner: 'COMMUNITY_SCREENING',
    attendance: '124 / 160',
    progress: 77.5,
    stationState: '4 stations active',
    staff: ['Mei Lin', 'Arun Das', 'Sara Tan'],
    extraStaff: 20,
  },
  {
    date: 'Tomorrow',
    day: 'Saturday',
    month: '1 August',
    title: 'Tampines Family Eye Screening',
    time: '9:30 AM – 4:00 PM GMT+8',
    venue: 'Our Tampines Hub',
    status: 'Ready',
    banner: 'LIBRARY_SCREENING',
    attendance: '186 capacity',
    stationState: 'Screening stations ready',
    staff: ['Kavya Nair', 'Daniel Koh', 'Alicia Lim', 'Haziq Rahman'],
    extraStaff: 1,
  },
  {
    date: '8 Aug',
    day: 'Saturday',
    month: '8 August',
    title: 'Sengkang Health & Vision Fair',
    time: '10:00 AM – 3:00 PM GMT+8',
    venue: 'Sengkang Community Club',
    status: 'Draft',
    banner: 'EVENT_OPERATIONS',
    attendance: '240 capacity',
    stationState: 'Stations pending',
    staff: ['Jia Wei', 'Noor Aziz', 'Lydia Goh'],
  },
];

export default function TestHomePage() {
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [period, setPeriod] = useState<'upcoming' | 'past'>('upcoming');
  const [now, setNow] = useState(() => new Date());
  const navigate = useNavigate();
  useEffect(() => {
    const clock = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(clock);
  }, []);
  useEffect(() => {
    if (!searchOpen && !notificationsOpen) return;
    const closeOverlay = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setSearchOpen(false);
      setNotificationsOpen(false);
      setQuery('');
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
    () => (period === 'upcoming' ? upcoming : []).filter((event) => `${event.title} ${event.venue}`.toLowerCase().includes(query.toLowerCase())),
    [period, query],
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
          <a href="#events-register" aria-current="page"><Ticket aria-hidden="true" />Events</a>
        </nav>

        <div className={`test-header-actions ${searchOpen ? 'searching' : ''}`}>
          <time className="reference-local-time" dateTime={now.toISOString()}>{localTime}</time>
          {searchOpen && (
            <label className="test-header-search">
              <Search aria-hidden="true" />
              <span className="sr-only">Search events</span>
              <input
                autoFocus
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search events"
              />
            </label>
          )}
          <Button className="test-header-icon" variant="ghost" size="icon" aria-label={searchOpen ? 'Close search' : 'Search events'} onClick={() => {
              setSearchOpen((open) => !open);
              if (searchOpen) setQuery('');
            }}>
            <Search aria-hidden="true" />
          </Button>
          <Button
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
          <Button className="test-profile-action" variant="ghost" aria-label="Nadia Rahman profile" onClick={() => navigate('/login')}><span aria-hidden="true">NR</span></Button>
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
          <button className="reference-mobile-profile" type="button" aria-label="Nadia Rahman profile" onClick={() => navigate('/login')}><span aria-hidden="true">NR</span></button>
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
        </Dock>
      </nav>

      <main className="test-events-main">
        <section className="test-register-intro">
          <h1><span>Events</span><span>Your Events</span></h1>
          <SegmentedControl className="test-period-tabs" value={period} onChange={(value) => setPeriod(value === 'past' ? 'past' : 'upcoming')} label="Event period" size="sm" layout="fill">
            <button type="button" role="radio" data-value="upcoming" aria-checked={period === 'upcoming'} tabIndex={period === 'upcoming' ? 0 : -1} onClick={() => setPeriod('upcoming')}>Upcoming</button>
            <button type="button" role="radio" data-value="past" aria-checked={period === 'past'} tabIndex={period === 'past' ? 0 : -1} onClick={() => setPeriod('past')}>Past</button>
          </SegmentedControl>
          <Button className="reference-view-all" variant="ghost" onClick={() => navigate('/login')}>View All<ChevronRight aria-hidden="true" /></Button>
        </section>

        {visibleEvents.length ? (
          <section className="test-event-register" id="events-register" aria-label={`${period === 'upcoming' ? 'Upcoming' : 'Past'} events`}>
            {visibleEvents.map((event) => (
              <article className={`test-register-row ${event.status.toLowerCase()}`} key={event.title} aria-label={`${event.title}, status ${event.status}`}>
                <div className="test-register-row-date">
                  <strong>{event.date}</strong>
                  <span>{event.day}</span>
                  <small>{event.month}</small>
                </div>
                <span className="reference-timeline" aria-hidden="true"><i /></span>
                <div className="reference-event-card">
                  <Link className="test-register-row-link" to="/login" aria-label={`Open ${event.title}`} />
                  <div className="reference-event-media">
                    <img src={getEventArtwork(event.banner)} alt="" loading="lazy" />
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
                    <Button className="test-row-action" onClick={() => navigate('/login')}>Open</Button>
                  </div>
                </div>
              </article>
            ))}
          </section>
        ) : (
          <section className="test-empty-state" aria-live="polite">
            <Search aria-hidden="true" />
            <h2>{query ? 'No events found' : 'No past events'}</h2>
            <p>{query ? 'Try a different event or venue name.' : 'Completed events will appear here.'}</p>
            {query && <Button variant="ghost" onClick={() => setQuery('')}>Clear search</Button>}
          </section>
        )}

      </main>
    </div>
  );
}
