import {
  ArrowRightIcon,
  CheckCircleIcon,
  CloudArrowUpIcon,
  ExclamationTriangleIcon,
  QrCodeIcon,
} from '@heroicons/react/24/outline';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/authState';
import { ThemeToggle } from './MagicEffects';

const workflow = ['Registration', 'Visual acuity', 'Refraction', 'Colour vision', 'Eye health', 'Clinical review'];

const fieldFacts = [
  ['Offline-capable', 'Core screening work continues when the network does not.'],
  ['Role-based access', 'Each staff member sees the tools needed for their station.'],
  ['No participant accounts', 'Participants move through the event without creating a login.'],
  ['WCAG 2.2 AA', 'Keyboard, contrast, and readable interaction states are built in.'],
];

const roles = [
  ['Event manager', 'Plans the event, staffing, venue, and operating window.'],
  ['Registration staff', 'Checks participants in and starts the screening journey.'],
  ['Screener', 'Records station outcomes with clear next-step guidance.'],
  ['Reviewer', 'Reviews flagged outcomes and records referral decisions.'],
  ['Support staff', 'Keeps queues and devices moving throughout the day.'],
];

const syncStates = ['Saved offline', 'Pending sync', 'Syncing', 'Synced', 'Sync failed', 'Review required'];

const queueRows = [
  ['Evelyn Ng', 'Visual acuity', 'In progress'],
  ['Marcus Tan', 'Refraction', 'Waiting'],
  ['Priya Nair', 'Clinical review', 'Review required'],
];

export default function LandingPage() {
  const { user } = useAuth();
  const workspaceHref = user ? '/events' : '/login';

  return (
    <div className="landing-page">
      <header className="landing-nav">
        <Link className="landing-brand" to="/" aria-label="VSMS home">
          <span aria-hidden="true">V</span><strong>VSMS</strong>
        </Link>
        <nav aria-label="Landing page navigation">
          <a href="#problem">Why VSMS</a>
          <a href="#flow">Event flow</a>
          <a href="#field">Field use</a>
          <a href="#roles">Roles</a>
        </nav>
        <div className="landing-nav-actions">
          <ThemeToggle />
          <Link className="landing-nav-cta" to={workspaceHref}>Open workspace</Link>
        </div>
      </header>

      <main>
        <section className="landing-hero" aria-labelledby="landing-title">
          <h1 id="landing-title">Run community vision screening without paper, queues, or guesswork.</h1>
          <p>Plan field teams, guide every screening station, and keep a reliable record even when connectivity drops.</p>
          <div className="landing-hero-actions">
            <Link className="primary interactive-cta" to={workspaceHref}>
              <span>Open workspace</span>
              <ArrowRightIcon />
            </Link>
            <a className="landing-text-link" href="#flow">See the event flow</a>
          </div>
        </section>

        <section className="landing-facts" aria-label="Platform commitments">
          {fieldFacts.map(([title, detail]) => (
            <div key={title}>
              <strong>{title}</strong>
              <span>{detail}</span>
            </div>
          ))}
        </section>

        <section className="landing-section landing-problem" id="problem">
          <header className="landing-section-heading">
            <span>Why VSMS</span>
            <h2>A screening day should not depend on clipboards and memory.</h2>
          </header>
          <div className="problem-statements">
            <article>
              <strong>Paper fragments the record.</strong>
              <p>Registration, station outcomes, and referrals stay connected in one event history.</p>
            </article>
            <article>
              <strong>Queues hide the next action.</strong>
              <p>Staff can see where each participant is and which station should receive them next.</p>
            </article>
            <article>
              <strong>Reporting starts too late.</strong>
              <p>Operational data is captured as work happens, ready for review after the final station.</p>
            </article>
          </div>
        </section>

        <section className="landing-section landing-flow" id="flow">
          <header className="landing-section-heading">
            <span>Event flow</span>
            <h2>One journey from registration to clinical review.</h2>
            <p>Every station has a clear place, a clear handoff, and a record the next staff member can trust.</p>
          </header>
          <ol className="landing-flow-track" aria-label="Participant screening journey">
            {workflow.map((stage, index) => (
              <li className={`flow-stage flow-stage-${index + 1}`} key={stage}>
                <i>{index + 1}</i>
                <span>{stage}</span>
              </li>
            ))}
          </ol>
        </section>

        <section className="landing-section landing-field" id="field">
          <div className="field-intro">
            <span>Built for the field</span>
            <h2>Keep working through an unreliable connection.</h2>
            <p>VSMS makes device state visible. Staff always know whether work is saved locally, syncing, or needs review.</p>
          </div>
          <div className="sync-panel" aria-label="Sync states">
            <div className="sync-panel-heading">
              <CloudArrowUpIcon />
              <div>
                <strong>Sync state is never hidden</strong>
                <span>Short labels use plain language at the point of work.</span>
              </div>
            </div>
            <ul>
              {syncStates.map((state, index) => (
                <li key={state}>
                  <i className={`sync-state-${index + 1}`} />
                  <span>{state}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="qr-rule">
            <QrCodeIcon />
            <div>
              <strong>QR codes identify records, not people.</strong>
              <p>No diagnosis or personal detail is exposed in the code itself.</p>
            </div>
          </div>
        </section>

        <section className="landing-section landing-roles" id="roles">
          <header className="landing-section-heading">
            <span>Roles</span>
            <h2>Clear responsibility at every point in the day.</h2>
          </header>
          <div className="role-list">
            {roles.map(([role, detail]) => (
              <div key={role}>
                <strong>{role}</strong>
                <span>{detail}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="landing-section landing-preview" aria-labelledby="preview-title">
          <div className="preview-copy">
            <span>Product preview</span>
            <h2 id="preview-title">A live queue that reads like an operating list.</h2>
            <p>Names, stations, and exceptions are easy to scan. Clinical review is a workflow state, never an automated diagnosis.</p>
            <Link className="landing-text-link" to={workspaceHref}>
              Open the staff workspace <ArrowRightIcon />
            </Link>
          </div>
          <div className="queue-preview" aria-label="Illustrative live queue preview">
            <header>
              <div>
                <strong>West End Community Check</strong>
                <span>Live queue</span>
              </div>
              <span className="queue-connected">
                <i />Synced
              </span>
            </header>
            <div className="queue-columns">
              <span>Participant</span>
              <span>Current station</span>
              <span>Status</span>
            </div>
            {queueRows.map(([name, station, status]) => (
              <div className="queue-row" key={name}>
                <strong>{name}</strong>
                <span>{station}</span>
                <span className={status === 'Review required' ? 'needs-review' : ''}>
                  {status === 'Review required' && <ExclamationTriangleIcon />}
                  {status}
                </span>
              </div>
            ))}
            <footer>
              <CheckCircleIcon />
              <span>3 of 18 participants shown</span>
            </footer>
          </div>
        </section>

        <section className="landing-callout">
          <div>
            <span>Ready for the next event</span>
            <h2>Give the team one dependable operating record.</h2>
          </div>
          <Link className="landing-callout-cta interactive-cta" to={workspaceHref}>
            <span>Open workspace</span>
            <ArrowRightIcon />
          </Link>
        </section>
      </main>

      <footer className="landing-footer">
        <span><strong>VSMS</strong> / Vision Screening Management System</span>
        <span>Community screening operations, kept clear.</span>
      </footer>
    </div>
  );
}