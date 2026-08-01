import { useAuth } from '../auth/authState';
import { ThemeToggle } from './MagicEffects';

export default function SettingsPage() {
  const { user } = useAuth();
  return (
    <section className="page-frame narrow settings-page">
      <header className="page-heading">
        <div><h1>Settings</h1><p>Review your account and workspace appearance.</p></div>
      </header>
      <div className="settings-list">
        <section>
          <div><h2>Account</h2><p>Your access is managed by the VSMS administrator.</p></div>
          <dl>
            <div><dt>Username</dt><dd>{user?.username}</dd></div>
            <div><dt>Email</dt><dd>{user?.email}</dd></div>
            <div><dt>Role</dt><dd>{user?.systemRole.replace('_', ' ').toLowerCase()}</dd></div>
          </dl>
        </section>
        <section>
          <div><h2>Appearance</h2><p>Switch the authenticated workspace theme.</p></div>
          <ThemeToggle className="settings-theme-toggle" />
        </section>
      </div>
    </section>
  );
}
