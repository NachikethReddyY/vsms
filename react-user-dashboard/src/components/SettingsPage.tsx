import { ShieldCheckIcon } from '@heroicons/react/24/outline';
import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { ThemeToggle } from './MagicEffects';

const sectionClass = 'grid grid-cols-[minmax(13.75rem,.85fr)_minmax(18.75rem,1.15fr)] gap-[clamp(2.25rem,7vw,6rem)] border-b border-[var(--hairline)] py-8.5 max-[700px]:grid-cols-1 max-[700px]:gap-5.5 max-[700px]:py-7';
const sectionCopyClass = '[&_h2]:mb-1.25 [&_h2]:text-lg [&_h2]:font-bold [&_h2]:tracking-[-.02em] [&_p]:m-0 [&_p]:text-[0.8125rem] [&_p]:leading-[1.1875rem] [&_p]:text-[var(--ink-2)]';

export default function SettingsPage() {
  const { session } = useAuth();
  const user = session?.user;
  useEffect(() => {
    const previousTitle = document.title;
    document.title = 'Settings · VSMS';
    return () => { document.title = previousTitle; };
  }, []);
  return (
    <section className="page-frame narrow min-h-full bg-[var(--canvas)] text-[var(--ink)] motion-reduce:[&_*]:transition-none motion-reduce:[&_*]:animate-none">
      <header className="page-heading items-end border-b border-[var(--hairline)] pb-11 max-[700px]:pb-8">
        <div><h1 className="mb-2 text-[2.125rem] leading-none font-bold tracking-[-.035em]">Settings</h1><p className="m-0 text-sm leading-[1.3125rem] text-[var(--ink-2)]">Account details and workspace appearance.</p></div>
      </header>
      <div>
        <section className={sectionClass}>
          <div className={sectionCopyClass}><h2>Account</h2><p>Your access is managed by the VSMS administrator.</p></div>
          <dl className="m-0 [&>div]:grid [&>div]:min-h-12 [&>div]:grid-cols-[6.5rem_minmax(0,1fr)] [&>div]:items-center [&>div]:gap-4.5 [&>div]:border-b [&>div]:border-[var(--hairline)] [&>div:last-child]:border-0 [&_dt]:text-xs [&_dt]:font-semibold [&_dt]:text-[var(--ink-2)] [&_dd]:m-0 [&_dd]:wrap-anywhere [&_dd]:text-sm [&_dd]:font-semibold">
            <div><dt>Username</dt><dd>{user?.username}</dd></div>
            <div><dt>Email</dt><dd>{user?.email}</dd></div>
            <div><dt>Role</dt><dd className="capitalize">{(user?.systemRole ?? 'STAFF').replace('_', ' ').toLowerCase()}</dd></div>
          </dl>
        </section>
        <section className={sectionClass}>
          <div className={sectionCopyClass}><h2>Appearance</h2><p>Switch the authenticated workspace theme.</p></div>
          <div className="flex min-h-12 items-center gap-3 text-sm font-semibold"><ThemeToggle className="size-12 rounded-lg border border-[var(--hairline)] bg-transparent text-[var(--ink)] hover:bg-[color-mix(in_srgb,var(--ink)_8%,transparent)]" /><span>Theme</span></div>
        </section>
        <section className={sectionClass}>
          <div className={sectionCopyClass}><h2>Security</h2><p>Manage your password through the connected staff identity provider.</p></div>
          <Link className="group flex min-h-12 w-fit items-center gap-3" to="/account/security"><ShieldCheckIcon className="size-5.5" aria-hidden="true" /><span className="grid gap-0.5"><strong className="text-sm group-hover:underline group-hover:underline-offset-3">Account security</strong><small className="text-xs text-[var(--ink-2)]">Change your managed password</small></span></Link>
        </section>
      </div>
    </section>
  );
}
