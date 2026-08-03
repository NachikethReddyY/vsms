import { ShieldCheckIcon } from '@heroicons/react/24/outline';
import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { ThemeToggle } from './MagicEffects';
import './SettingsPage.css';

export default function SettingsPage() {
  const { session } = useAuth();
  const user = session?.user;
  useEffect(() => {
    const previousTitle = document.title;
    document.title = 'Settings · VSMS';
    return () => { document.title = previousTitle; };
  }, []);
  return (
    <section className="page-frame narrow settings-page midnight-settings">
      <header className="page-heading settings-heading">
        <div><h1>Settings</h1><p>Account details and workspace appearance.</p></div>
      </header>
      <div className="settings-list">
        <section>
          <div className="settings-section-copy"><h2>Account</h2><p>Your access is managed by the VSMS administrator.</p></div>
          <dl>
            <div><dt>Username</dt><dd>{user?.username}</dd></div>
            <div><dt>Email</dt><dd>{user?.email}</dd></div>
            <div><dt>Role</dt><dd>{(user?.systemRole ?? 'STAFF').replace('_', ' ').toLowerCase()}</dd></div>
          </dl>
        </section>
        <section>
          <div className="settings-section-copy"><h2>Appearance</h2><p>Switch the authenticated workspace theme.</p></div>
          <div className="settings-theme-control"><ThemeToggle className="settings-theme-toggle" /><span>Theme</span></div>
        </section>
        <section>
          <div className="settings-section-copy"><h2>Security</h2><p>Manage your password through the connected staff identity provider.</p></div>
          <Link className="settings-security-link" to="/account/security"><ShieldCheckIcon aria-hidden="true" /><span><strong>Account security</strong><small>Change your managed password</small></span></Link>
        </section>
      </div>
    </section>
  );
}
