import { ArrowLeftIcon, BellIcon, CalendarDaysIcon, Cog6ToothIcon, MagnifyingGlassIcon, PlusIcon, TicketIcon, UserGroupIcon } from '@heroicons/react/24/outline';
import { CommandPalette, CommandPaletteInput } from '@astryxdesign/core/CommandPalette';
import { Kbd } from '@astryxdesign/core/Kbd';
import { createStaticSource, type SearchableItem } from '@astryxdesign/core/Typeahead';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { ThemeToggle } from './MagicEffects';
import ProfileMenu from './ProfileMenu';
import './AppShell.css';

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
  const [commandOpen, setCommandOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const { session } = useAuth();
  const user = session?.user;
  const navigate = useNavigate();
  const location = useLocation();
  const workspaceRef = useRef<HTMLElement>(null);

  const canCreateEvent = Boolean(user?.roles?.some((item) => item === 'ADMINISTRATOR' || item === 'EVENT_MANAGER'));
  const canAccessParticipants = Boolean(user?.roles?.some((item) => item === 'ADMINISTRATOR' || item === 'REGISTRATION_OFFICER'));

  const mobileTitle = location.pathname.startsWith('/participants') || location.pathname.includes('/register')
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
  ], [canCreateEvent, navigate]);

  const commandSource = useMemo(() => createStaticSource(commands, {
    keywords: (item) => [item.auxiliaryData.description, ...item.auxiliaryData.aliases],
  }), [commands]);

  useEffect(() => {
    workspaceRef.current?.scrollTo({ top: 0 });
  }, [location.pathname]);

  useEffect(() => {
    const clock = window.setInterval(() => setNow(new Date()), 60000);
    return () => window.clearInterval(clock);
  }, []);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      const modifier = event.metaKey || event.ctrlKey;
      if (modifier && event.shiftKey && event.key.toLowerCase() === 'p') {
        event.preventDefault();
        setCommandOpen((open) => !open);
      }
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, []);

  return (
    <div className="app-shell events-shell" data-astryx-theme="neutral">
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
      <div className="app-main">
        <header className="events-shell-header">
          <div className="command-navigation">
            <NavLink className="shell-brand" to="/events" aria-label="VSMS events">
              <svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
                <path d="M9 7H6v6M23 7h3v6M9 25H6v-6M23 25h3v-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                <path d="M9 21c3.6 0 3.8-10 7.3-10 2.4 0 2.8 5.3 6.7 5.3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                <circle cx="9" cy="21" r="2" fill="currentColor" /><circle cx="16.3" cy="11" r="2" fill="currentColor" /><circle cx="23" cy="16.3" r="2" fill="currentColor" />
              </svg>
            </NavLink>
            <button className="icon-button back-button" onClick={() => navigate(location.pathname.endsWith('/edit') ? location.pathname.replace(/\/edit$/, '') : '/events')} aria-label="Go back" title="Back"><ArrowLeftIcon /></button>
          </div>
          <nav className="shell-nav" aria-label="Workspace navigation">
            <NavLink to="/events"><TicketIcon aria-hidden="true" />Events</NavLink>
            {canAccessParticipants && <NavLink to="/participants/search"><UserGroupIcon aria-hidden="true" />Participants</NavLink>}
            <NavLink to="/settings"><Cog6ToothIcon aria-hidden="true" />Settings</NavLink>
          </nav>
          <div className="shell-actions">
            {canCreateEvent && location.pathname !== '/events/new' && <button className="primary compact shell-create" onClick={() => navigate('/events/new')} aria-label="Create event"><PlusIcon /><span>New event</span></button>}
            <time className="shell-local-time" dateTime={now.toISOString()}>{new Intl.DateTimeFormat('en-SG', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Singapore' }).format(now).toUpperCase()}</time>
            <button className="icon-button shell-search" type="button" onClick={() => setCommandOpen(true)} aria-label="Search commands"><MagnifyingGlassIcon /></button>
            <ThemeToggle className="shell-theme-toggle" />
            <button className="icon-button shell-notifications" type="button" aria-label="Notifications" aria-expanded={notificationsOpen} onClick={() => setNotificationsOpen((open) => !open)}><BellIcon /></button>
            {notificationsOpen && <div className="shell-notification-popover" role="status"><strong>You’re all caught up</strong><span>No new event alerts.</span></div>}
            <ProfileMenu triggerClassName="shell-profile-action" compact />
          </div>
        </header>
        <header className="events-shell-mobile-header">
          <NavLink className="shell-brand" to="/events" aria-label="VSMS events"><svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M9 7H6v6M23 7h3v6M9 25H6v-6M23 25h3v-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /><path d="M9 21c3.6 0 3.8-10 7.3-10 2.4 0 2.8 5.3 6.7 5.3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /><circle cx="9" cy="21" r="2" fill="currentColor" /><circle cx="16.3" cy="11" r="2" fill="currentColor" /><circle cx="23" cy="16.3" r="2" fill="currentColor" /></svg></NavLink>
          <strong>{mobileTitle}</strong>
          <ProfileMenu triggerClassName="shell-profile-action" compact />
        </header>
        <nav className="events-shell-mobile-dock" aria-label="Mobile navigation">
          <NavLink to="/events" aria-label="Events"><TicketIcon /></NavLink>
          {canAccessParticipants && <NavLink to="/participants/search" aria-label="Participants"><UserGroupIcon /></NavLink>}
          <button type="button" onClick={() => setCommandOpen(true)} aria-label="Search commands"><MagnifyingGlassIcon /></button>
          <ThemeToggle />
          <NavLink to="/settings" aria-label="Settings"><Cog6ToothIcon /></NavLink>
        </nav>
        <main className="workspace" id="main-content" ref={workspaceRef}>{children}</main>
      </div>
    </div>
  );
}
