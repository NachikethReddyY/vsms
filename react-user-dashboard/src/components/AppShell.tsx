import { ArrowLeftIcon, ArrowRightStartOnRectangleIcon, Bars3BottomLeftIcon, CalendarDaysIcon, HomeIcon, ListBulletIcon, MagnifyingGlassIcon, PlusIcon, QueueListIcon, ShieldCheckIcon, SignalIcon, TableCellsIcon, UserGroupIcon } from '@heroicons/react/24/outline';
import { CommandPalette, CommandPaletteInput } from '@astryxdesign/core/CommandPalette';
import { Kbd } from '@astryxdesign/core/Kbd';
import { createStaticSource, type SearchableItem } from '@astryxdesign/core/Typeahead';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import apiClient from '../utils/apiClient';
import { getMonogram } from '../utils/identity';
import { SuccessConfetti, ThemeToggle } from './MagicEffects';

type CommandMetadata = {
  group: string;
  description: string;
  aliases: string[];
  shortcut?: string;
  icon: ReactNode;
  action: () => void;
};

type CommandItem = Omit<SearchableItem<CommandMetadata>, 'auxiliaryData'> & {
  auxiliaryData: CommandMetadata;
};

export default function AppShell({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [eventSearch, setEventSearch] = useState('');

  const { session, clearSession } = useAuth();
  const user = session?.user;
  const navigate = useNavigate();
  const location = useLocation();
  const workspaceRef = useRef<HTMLElement>(null);

  const identityName = user?.fullName || user?.email || 'Account';
  const role = user?.roles?.join(', ').replace(/_/g, ' ').toLowerCase() || 'staff';
  const canCreateEvent = Boolean(user?.roles?.some((item) => item === 'ADMINISTRATOR' || item === 'EVENT_MANAGER'));

  const logout = useCallback(async () => {
    try {
      await apiClient.post('/auth/logout');
    } finally {
      clearSession();
      navigate('/login');
    }
  }, [clearSession, navigate]);

  const mobileTitle = location.pathname === '/dashboard'
    ? 'Dashboard'
    : location.pathname.startsWith('/participants') || location.pathname.includes('/register')
      ? 'Registration'
      : location.pathname === '/events/new'
    ? 'Create event'
    : location.pathname.includes('/queue')
    ? 'Queue dashboard'
    : location.pathname.includes('/audit')
    ? 'Audit dashboard'
    : /^\/events\/[^/]+$/.test(location.pathname)
      ? 'Event details'
      : 'Events';

  const isEventsPage = location.pathname === '/events';
  const toggleSidebar = useCallback(() => setCollapsed((value) => !value), []);

  const setEventsView = useCallback((view: 'timeline' | 'table') => {
    localStorage.setItem('vsms-events-view', view);
    window.dispatchEvent(new CustomEvent('vsms:events-view', { detail: view }));
    if (!isEventsPage) navigate('/events');
  }, [isEventsPage, navigate]);

  const commands = useMemo<CommandItem[]>(() => [
    {
      id: 'navigation-events', label: 'Go to events', auxiliaryData: {
        group: 'Navigation', description: 'Open the event operations dashboard', aliases: ['home', 'dashboard'], icon: <CalendarDaysIcon />, action: () => navigate('/events'),
      },
    },
    ...(canCreateEvent ? [{
      id: 'event-create', label: 'Create event', auxiliaryData: {
        group: 'Events', description: 'Open a new draft event', aliases: ['new', 'add'], icon: <PlusIcon />, action: () => navigate('/events/new'),
      },
    }] : []),
    {
      id: 'view-timeline', label: 'Switch to timeline view', auxiliaryData: {
        group: 'View', description: 'Show events in chronological order', aliases: ['schedule', 'list', 'chronological'], icon: <ListBulletIcon />, action: () => setEventsView('timeline'),
      },
    },
    {
      id: 'view-table', label: 'Switch to table view', auxiliaryData: {
        group: 'View', description: 'Show the compact CMS event table', aliases: ['business', 'cms'], icon: <TableCellsIcon />, action: () => setEventsView('table'),
      },
    },
    {
      id: 'sidebar-toggle', label: collapsed ? 'Show sidebar' : 'Hide sidebar', auxiliaryData: {
        group: 'View', description: 'Toggle the primary navigation', aliases: ['collapse', 'expand', 'navigation'], shortcut: 'mod+b', icon: <Bars3BottomLeftIcon />, action: toggleSidebar,
      },
    },
  ], [canCreateEvent, collapsed, navigate, setEventsView, toggleSidebar]);

  const commandSource = useMemo(() => createStaticSource(commands, {
    keywords: (item) => [item.auxiliaryData.description, ...item.auxiliaryData.aliases],
  }), [commands]);

  const submitEventSearch = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    window.dispatchEvent(new CustomEvent('vsms:events-search', { detail: eventSearch.trim() }));
  };

  useEffect(() => {
    workspaceRef.current?.scrollTo({ top: 0 });
  }, [location.pathname]);

  useEffect(() => {
    if (!isEventsPage) return;
    const timeout = window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent('vsms:events-search', { detail: eventSearch.trim() }));
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [eventSearch, isEventsPage]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      const modifier = event.metaKey || event.ctrlKey;
      if (modifier && event.shiftKey && event.key.toLowerCase() === 'p') {
        event.preventDefault();
        setCommandOpen((open) => !open);
        return;
      }
      const target = event.target as HTMLElement | null;
      const isEditing = target?.matches('input, textarea, select, [contenteditable="true"]');
      if (modifier && !event.shiftKey && event.key.toLowerCase() === 'b' && !isEditing) {
        event.preventDefault();
        toggleSidebar();
      }
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, [toggleSidebar]);

  return (
    <div className={`app-shell ${collapsed ? 'rail' : ''}`} data-astryx-theme="neutral">
      <SuccessConfetti />
      <CommandPalette
        isOpen={commandOpen}
        onOpenChange={setCommandOpen}
        searchSource={commandSource}
        onValueChange={(commandId) => commands.find((command) => command.id === commandId)?.auxiliaryData.action()}
        input={<CommandPaletteInput placeholder="Type a command or search actions…" endContent={<Kbd keys="mod+shift+p" />} />}
        renderItem={(command) => (
          <>
            <span className="command-item-icon">{command.auxiliaryData.icon}</span>
            <span className="command-item-copy">
              <strong>{command.label}</strong>
              <small>{command.auxiliaryData.description}</small>
            </span>
            {command.auxiliaryData.shortcut && <Kbd keys={command.auxiliaryData.shortcut} />}
          </>
        )}
        emptySearchText="No matching commands"
      />
      <aside className="sidebar" aria-label="Primary navigation">
        <div className="brand" title="VSMS"><span aria-hidden="true">V</span><strong>VSMS</strong></div>
        <nav className="nav-list">
          <NavLink to="/dashboard" title="Dashboard" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <HomeIcon /><span>Dashboard</span>
          </NavLink>
          <NavLink to="/events" title="Events" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <CalendarDaysIcon /><span>Events</span>
          </NavLink>
          <NavLink to="/participants/search" title="Participants" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <QueueListIcon /><span>Participants</span>
          </NavLink>
          <NavLink to="/participants-v2" title="Participants V2" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <QueueListIcon /><span>Participants V2</span>
          </NavLink>
          <NavLink to="/events/active-event-id/queue" title="Queue Dashboard" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <UserGroupIcon /><span>Queue Dashboard</span>
          </NavLink>
          
          {/* Extended Navigation Tab for Audit Dashboard */}
          <NavLink to="/admin/system-audit-dashboard" title="System Audit Dashboard" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <ShieldCheckIcon /><span>Audit Dashboard</span>
          </NavLink>
        </nav>

        <div className="sidebar-foot">
          <div className="connection" title="Connected: All changes synced"><SignalIcon /><span>Connected<br/><small>All changes synced</small></span></div>
          <div className="profile">
            <span className="avatar" aria-hidden="true" title={identityName}>{getMonogram(identityName)}</span>
            <span className="profile-copy" title={user?.email}>
              <strong>{identityName}</strong>
              <small>{role}</small>
              <small>{user?.email}</small>
            </span>
            <button className="profile-action" onClick={() => void logout()} aria-label={`Sign out ${identityName}`} title="Sign out">
              <ArrowRightStartOnRectangleIcon />
            </button>
          </div>
        </div>
      </aside>

      <div className="app-main">
        <header className="command-bar">
          <div className="command-navigation">
            <button className="icon-button sidebar-toggle" onClick={toggleSidebar} aria-label={collapsed ? 'Show sidebar' : 'Hide sidebar'} title={`${collapsed ? 'Show' : 'Hide'} sidebar (Ctrl/⌘ B)`}><Bars3BottomLeftIcon /></button>
            {!isEventsPage && <button className="icon-button back-button" onClick={() => navigate(location.pathname.endsWith('/edit') ? location.pathname.replace(/\/edit$/, '') : '/events')} aria-label="Go back" title="Back"><ArrowLeftIcon /></button>}
          </div>
          <span className="mobile-brand" aria-hidden="true">V</span>
          <div className="workspace-name"><strong><span className="desktop-title">Event operations</span><span className="mobile-title">{mobileTitle}</span></strong><span><i /> Secure workspace</span></div>
          {isEventsPage && <form className="global-search" onSubmit={submitEventSearch}><MagnifyingGlassIcon /><label className="sr-only" htmlFor="workspace-event-search">Search events</label><input id="workspace-event-search" value={eventSearch} onChange={(event) => setEventSearch(event.target.value)} placeholder="Search events or venues" /></form>}
          <ThemeToggle />
          {canCreateEvent && location.pathname !== '/events/new' && <button className="primary compact" onClick={() => navigate('/events/new')} aria-label="Create event"><PlusIcon /><span>New event</span></button>}
        </header>
        <main className="workspace" id="main-content" ref={workspaceRef}>{children}</main>
      </div>
    </div>
  );
}
