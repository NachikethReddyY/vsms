import { CalendarDaysIcon, ChartBarSquareIcon, ClipboardDocumentListIcon, PencilSquareIcon, PlusIcon, SignalIcon, Squares2X2Icon, UserGroupIcon } from '@heroicons/react/24/outline';
import { useEffect, useRef, type ReactNode } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { ThemeToggle } from './MagicEffects';
import ProfileMenu from './ProfileMenu';
import { OfflineSyncControl } from '../features/screening/OfflineSyncControl';
import { setupIdleTimer } from '../utils/idleTimer';
import { logoutAndReturnHome } from '../utils/logout';
import './EventsPage.css';

const eventManagerRoles = new Set(['ADMINISTRATOR', 'EVENT_MANAGER']);
const adminRoles = new Set(['ADMINISTRATOR']);

export default function AppShell({ children }: { children: ReactNode }) {
  const { session, clearSession } = useAuth();
  const location = useLocation();
  const workspaceRef = useRef<HTMLElement>(null);
  const roles = session?.user.roles ?? [];
  const canManageEvents = roles.some((role) => eventManagerRoles.has(role));
  const canCreateEvent = roles.some((role) => adminRoles.has(role));
  const canManageStaff = canCreateEvent;
  const canUseOfflineScreening = !roles.includes('ADMINISTRATOR');
  const eventManagementMatch = location.pathname.match(/^\/events\/([^/]+)(?:\/(overview|stations|shifts|staff|analytics|reports|attendees|activity))?$/);
  const stationWorkflowMatch = location.pathname.match(/^\/events\/([^/]+)\/stations\/(visual-acuity|refraction|colour-vision|eye-health|custom\/[^/]+)$/);
  const registrationWorkflowMatch = location.pathname.match(/^\/events\/([^/]+)\/register$/);
  const queueWorkflowMatch = location.pathname.match(/^\/events\/([^/]+)\/queue$/);
  const reviewWorkflowMatch = location.pathname.match(/^\/events\/([^/]+)\/reviews(?:\/[^/]+)?$/);
  const eventDetailMatch = location.pathname.match(/^\/events\/([^/]+)$/);
  const offlineEventId = registrationWorkflowMatch?.[1]
    ?? queueWorkflowMatch?.[1]
    ?? reviewWorkflowMatch?.[1]
    ?? stationWorkflowMatch?.[1]
    ?? (eventDetailMatch && eventDetailMatch[1] !== 'new' ? eventDetailMatch[1] : null);
  const eventEditPath = eventManagementMatch && eventManagementMatch[1] !== 'new'
    ? `/events/${eventManagementMatch[1]}/edit`
    : null;
  useEffect(() => {
    workspaceRef.current?.scrollTo({ top: 0 });
  }, [location.pathname]);

  useEffect(() => setupIdleTimer(() => {
    void logoutAndReturnHome(clearSession);
  }, 30), [clearSession]);

  return (
    <div className="events-workspace">
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
          {canManageEvents && <NavLink to="/operations" className={({ isActive }) => isActive ? 'active' : undefined}><SignalIcon aria-hidden="true" />Operations</NavLink>}
          {canManageEvents && <NavLink to="/reports" className={({ isActive }) => isActive ? 'active' : undefined}><ChartBarSquareIcon aria-hidden="true" />Reports</NavLink>}
          {canManageStaff && <NavLink to="/staff" className={({ isActive }) => isActive ? 'active' : undefined}><UserGroupIcon aria-hidden="true" />Staff</NavLink>}
          {canManageStaff && <NavLink to="/admin/station-templates" className={({ isActive }) => isActive ? 'active' : undefined}><Squares2X2Icon aria-hidden="true" />Stations</NavLink>}
          {canCreateEvent && <NavLink to="/admin/audit-logs" className={({ isActive }) => isActive ? 'active' : undefined}><ClipboardDocumentListIcon aria-hidden="true" />Audit</NavLink>}
        </nav>

        <div className="workspace-nav-actions">
          {canUseOfflineScreening && offlineEventId && <OfflineSyncControl eventId={offlineEventId} />}
          {canCreateEvent && eventEditPath && <Link className="workspace-edit-action" to={eventEditPath}><PencilSquareIcon aria-hidden="true" /><span>Edit event</span></Link>}
          <ThemeToggle className="workspace-icon-action" />
          {canCreateEvent && location.pathname !== '/events/new' && <Link className="workspace-create-action" to="/events/new"><PlusIcon aria-hidden="true" />New event</Link>}
          <ProfileMenu triggerClassName="workspace-profile-action" compact />
        </div>
      </header>

      <header className="workspace-mobile-header">
        <Link className="workspace-mobile-brand" to="/events" aria-label="VSMS events">
          <svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
            <path d="M9 7H6v6M23 7h3v6M9 25H6v-6M23 25h3v-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            <path d="M9 21c3.6 0 3.8-10 7.3-10 2.4 0 2.8 5.3 6.7 5.3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <circle cx="9" cy="21" r="2" fill="currentColor" />
            <circle cx="16.3" cy="11" r="2" fill="currentColor" />
            <circle cx="23" cy="16.3" r="2" fill="currentColor" />
          </svg>
        </Link>
        <div className="workspace-mobile-status">
          {canUseOfflineScreening && offlineEventId && <OfflineSyncControl eventId={offlineEventId} />}
        </div>
        <ProfileMenu triggerClassName="workspace-mobile-profile" compact />
      </header>

      <nav className="workspace-mobile-dock" aria-label="Mobile navigation">
        <NavLink to="/events" aria-label="Events"><CalendarDaysIcon aria-hidden="true" /></NavLink>
        {canManageEvents && <NavLink to="/operations" aria-label="Operations"><SignalIcon aria-hidden="true" /></NavLink>}
        {canManageEvents && <NavLink to="/reports" aria-label="Reports"><ChartBarSquareIcon aria-hidden="true" /></NavLink>}
        {canManageStaff && <NavLink to="/staff" aria-label="Staff"><UserGroupIcon aria-hidden="true" /></NavLink>}
        {canManageStaff && <NavLink to="/admin/station-templates" aria-label="Stations"><Squares2X2Icon aria-hidden="true" /></NavLink>}
        <ThemeToggle className="workspace-mobile-action" />
        {canCreateEvent && eventEditPath
          ? <Link to={eventEditPath} aria-label="Edit event"><PencilSquareIcon aria-hidden="true" /></Link>
          : canCreateEvent && location.pathname !== '/events/new'
            ? <Link to="/events/new" aria-label="Create event"><PlusIcon aria-hidden="true" /></Link>
            : null}
      </nav>

      <main className="workspace-main" id="main-content" ref={workspaceRef}>{children}</main>
    </div>
  );
}
