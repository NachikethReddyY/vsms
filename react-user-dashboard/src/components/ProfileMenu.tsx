import { ArrowRightStartOnRectangleIcon, ClipboardDocumentListIcon, Cog6ToothIcon } from '@heroicons/react/24/outline';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { logoutAndReturnHome } from '../utils/logout';

export default function ProfileMenu({ triggerClassName = '', compact = false }: { triggerClassName?: string; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const { session, clearSession } = useAuth();
  const user = session?.user;
  const canReadAudit = user?.roles.includes('ADMINISTRATOR') ?? false;
  const label = user?.username || user?.email || 'Signed-in user';
  const initials = label.split(/[@._ -]+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase();

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  async function logout() {
    await logoutAndReturnHome(clearSession);
  }

  return (
    <div className={`profile-menu ${open ? 'open' : ''}`} ref={menuRef}>
      <button ref={triggerRef} type="button" className={triggerClassName} aria-label={`Open account menu for ${label}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <span className={compact ? '' : 'avatar'} aria-hidden="true">{initials}</span>
        {!compact && <span><strong>{user?.username || user?.email.split('@')[0]}</strong><small>{(user?.systemRole ?? 'STAFF').replace('_', ' ').toLowerCase()}</small></span>}
      </button>
      {open && <div className="profile-menu-panel" role="menu">
        <div className="profile-menu-identity"><strong>{user?.username || 'Account'}</strong><span>{user?.email}</span></div>
        <Link to="/account/security" role="menuitem" onClick={() => setOpen(false)}><Cog6ToothIcon aria-hidden="true" />Account security</Link>
        {canReadAudit && <Link to="/admin/audit-logs" role="menuitem" onClick={() => setOpen(false)}><ClipboardDocumentListIcon aria-hidden="true" />Audit history</Link>}
        <button type="button" role="menuitem" onClick={() => { setOpen(false); void logout(); }}><ArrowRightStartOnRectangleIcon aria-hidden="true" />Sign out</button>
      </div>}
    </div>
  );
}
