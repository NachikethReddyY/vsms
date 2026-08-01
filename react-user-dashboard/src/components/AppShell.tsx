import { CalendarDaysIcon, ChevronLeftIcon, MagnifyingGlassIcon, PlusIcon, QrCodeIcon, SignalIcon } from '@heroicons/react/24/outline';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/authState';
import { SuccessConfetti, ThemeToggle } from './MagicEffects';
import ProfileMenu from './ProfileMenu';

export default function AppShell({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [eventSearch, setEventSearch] = useState('');
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const workspaceRef = useRef<HTMLElement>(null);
  const canCreate = user?.systemRole === 'ADMIN' || user?.systemRole === 'EVENT_MANAGER';
  const mobileTitle = location.pathname === '/events/new'
    ? 'Create event'
    : location.pathname === '/qr-generator'
      ? 'QR passes'
      : location.pathname === '/settings'
        ? 'Settings'
        : /\/events\/[^/]+\/edit$/.test(location.pathname)
        ? 'Edit event'
    : /^\/events\/[^/]+$/.test(location.pathname)
      ? 'Event details'
      : 'Events';
  const isEventsPage = location.pathname === '/events';
  const isCreateEventPage = location.pathname === '/events/new';

  const submitEventSearch = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    window.dispatchEvent(new CustomEvent('vsms:events-search', { detail: eventSearch.trim() }));
  };

  useEffect(() => {
    workspaceRef.current?.scrollTo({ top: 0 });
  }, [location.pathname]);

  return (
    <div className={`app-shell ${collapsed ? 'rail' : ''} ${isCreateEventPage ? 'focused-workspace' : ''}`}>
      <SuccessConfetti />
      {!isCreateEventPage && <aside className="sidebar" aria-label="Primary navigation">
        <div className="brand"><span aria-hidden="true">V</span><strong>VSMS</strong></div>
        <nav className="nav-list">
          <NavLink to="/events" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <CalendarDaysIcon /><span>Events</span>
          </NavLink>
          <NavLink to="/qr-generator" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <QrCodeIcon /><span>QR passes</span>
          </NavLink>
        </nav>
        <div className="sidebar-foot">
          <div className="connection"><SignalIcon /><span>Connected<br/><small>All changes synced</small></span></div>
          <ProfileMenu triggerClassName="profile" />
        </div>
      </aside>}
      <div className="app-main">
        {isCreateEventPage ? <header className="command-bar focused-command-bar">
          <button className="icon-button" onClick={() => navigate('/events')} aria-label="Back to events"><ChevronLeftIcon /></button>
          <div className="workspace-name"><strong>Create event</strong><span>Draft event setup</span></div>
          <ThemeToggle />
        </header> : <header className="command-bar">
          <button className="icon-button" onClick={() => setCollapsed((v) => !v)} aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}><ChevronLeftIcon /></button>
          <span className="mobile-brand" aria-hidden="true">V</span>
          <div className="workspace-name"><strong><span className="desktop-title">Event operations</span><span className="mobile-title">{mobileTitle}</span></strong><span><i /> Secure workspace</span></div>
          {isEventsPage && <form className="global-search" onSubmit={submitEventSearch}><MagnifyingGlassIcon /><label className="sr-only" htmlFor="workspace-event-search">Search events</label><input id="workspace-event-search" value={eventSearch} onChange={(event) => setEventSearch(event.target.value)} placeholder="Search events or venues" /></form>}
          <ThemeToggle />
          {canCreate && <button className="primary compact" onClick={() => navigate('/events/new')} aria-label="Create event"><PlusIcon /><span>New event</span></button>}
        </header>}
        <main className="workspace" id="main-content" ref={workspaceRef}>{children}</main>
      </div>
      {!isCreateEventPage && <nav className="app-mobile-nav" aria-label="Mobile navigation">
        <NavLink to="/events" className={({ isActive }) => isActive ? 'active' : ''}>
          <CalendarDaysIcon /><span>Events</span>
        </NavLink>
        <NavLink to="/qr-generator" className={({ isActive }) => isActive ? 'active' : ''}>
          <QrCodeIcon /><span>QR passes</span>
        </NavLink>
      </nav>}
    </div>
  );
}
