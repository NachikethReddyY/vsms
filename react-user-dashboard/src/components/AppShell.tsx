import { ArrowLeftIcon, CalendarDaysIcon, PlusIcon, QueueListIcon } from '@heroicons/react/24/outline';
import { useEffect, useRef, type ReactNode } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { SuccessConfetti, ThemeToggle } from './MagicEffects';
import ProfileMenu from './ProfileMenu';
import './EventsPage.css';

const eventManagerRoles = new Set(['ADMINISTRATOR', 'EVENT_MANAGER']);
const registrationRoles = new Set(['ADMINISTRATOR', 'REGISTRATION_OFFICER']);

export default function AppShell({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const workspaceRef = useRef<HTMLElement>(null);
  const roles = session?.user.roles ?? [];
  const canCreateEvent = roles.some((role) => eventManagerRoles.has(role));
  const canRegister = roles.some((role) => registrationRoles.has(role));
  const eventId = location.pathname.match(/^\/events\/([^/]+)/)?.[1];
  const backTarget = location.pathname.endsWith('/edit') && eventId ? `/events/${eventId}` : '/events';

  useEffect(() => {
    workspaceRef.current?.scrollTo({ top: 0 });
  }, [location.pathname]);

  return (
    <div className="events-workspace">
      <SuccessConfetti />
      <header className="workspace-site-nav">
        <Link className="workspace-brand" to="/events" aria-label="VSMS events">
          <svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
            <path d="M9 7H6v6M23 7h3v6M9 25H6v-6M23 25h3v-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            <path d="M9 21c3.6 0 3.8-10 7.3-10 2.4 0 2.8 5.3 6.7 5.3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <circle cx="9" cy="21" r="2" fill="currentColor" />
            <circle cx="16.3" cy="11" r="2" fill="currentColor" />
            <circle cx="23" cy="16.3" r="2" fill="currentColor" />
          </svg>
        </Link>

        <nav className="workspace-primary-nav" aria-label="Primary navigation">
          <NavLink to="/events" className={({ isActive }) => isActive ? 'active' : undefined}><CalendarDaysIcon aria-hidden="true" />Events</NavLink>
          {canRegister && <NavLink to="/participants/search" className={({ isActive }) => isActive ? 'active' : undefined}><QueueListIcon aria-hidden="true" />Participants</NavLink>}
        </nav>

        <div className="workspace-nav-actions">
          {location.pathname !== '/events' && <button className="workspace-icon-action" type="button" onClick={() => navigate(backTarget)} aria-label="Go back"><ArrowLeftIcon /></button>}
          <ThemeToggle className="workspace-icon-action" />
          {canCreateEvent && location.pathname !== '/events/new' && <Link className="workspace-create-action" to="/events/new"><PlusIcon aria-hidden="true" />New event</Link>}
          <ProfileMenu triggerClassName="workspace-profile-action" compact />
        </div>
      </header>

      <main className="workspace-main" id="main-content" ref={workspaceRef}>{children}</main>
    </div>
  );
}
