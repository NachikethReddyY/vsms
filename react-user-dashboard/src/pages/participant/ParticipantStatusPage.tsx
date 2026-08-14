import { CheckBadgeIcon, ClockIcon, ExclamationTriangleIcon, XCircleIcon } from '@heroicons/react/24/outline';
import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { components } from '../../generated/api';
import apiClient, { getApiError as getApiMessage } from '../../utils/apiClient';
import './ParticipantStatusPage.css';

type PublicPassStatus = components['schemas']['QrPublicStatusResponse']['data'];

const POLL_MS = 5000;

const QUEUE_STATE_LABEL: Record<string, string> = {
  WAITING: 'You are in the queue',
  CALLED: 'Your number is called',
  IN_PROGRESS: 'Being screened now',
};

const ROUTE_STATE_LABEL: Record<string, string> = {
  COMPLETED: 'Completed',
  CURRENT: 'Current',
  UPCOMING: 'Upcoming',
  BLOCKED: 'Waiting for staff action',
};

const formatExpiry = (value: string) =>
  new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));

export default function ParticipantStatusPage() {
  const { token = '' } = useParams();
  const qrDialogRef = useRef<HTMLDialogElement>(null);
  const [status, setStatus] = useState<PublicPassStatus | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const hasStatusRef = useRef(false);

  useEffect(() => {
    hasStatusRef.current = false;
    setStatus(null);
    setError('');
    setLastUpdatedAt(null);
  }, [token]);

  useEffect(() => {
    const controller = new AbortController();
    let inFlight = false;
    const fetchStatus = () => {
      if (inFlight) return Promise.resolve();
      inFlight = true;
      if (!hasStatusRef.current) setLoading(true);
      return apiClient.get<{ success: boolean; data: PublicPassStatus }>(
        `/qr/public-status/${encodeURIComponent(token)}`,
        { signal: controller.signal },
      )
        .then(({ data }) => {
          if (!controller.signal.aborted) {
            setStatus(data.data);
            setLastUpdatedAt(new Date());
            setError('');
          }
        })
        .catch((cause) => {
          if (!controller.signal.aborted) setError(getApiMessage(cause, 'This pass could not be verified.'));
        })
        .finally(() => {
          inFlight = false;
          if (!controller.signal.aborted) {
            setLoading(false);
            hasStatusRef.current = true;
          }
        });
    };

    void fetchStatus();
    const interval = window.setInterval(() => void fetchStatus(), POLL_MS);
    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, [retryKey, token]);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = 'Pass status · VSMS';
    return () => { document.title = previousTitle; };
  }, []);

  let content;
  if (error && !status) {
    content = <section className="ps-state ps-state-error" role="alert">
      <ExclamationTriangleIcon aria-hidden="true" />
      <h1>Pass could not be verified</h1>
      <p>{error}</p>
      <button type="button" className="ps-retry" onClick={() => setRetryKey((value) => value + 1)}>Retry</button>
      <Link to="/">Return to VSMS</Link>
    </section>;
  } else if (loading || !status) {
    content = <section className="ps-state" aria-live="polite">
      <ClockIcon aria-hidden="true" />
      <h1>Checking pass</h1>
      <p>Verifying this pass with the event system…</p>
    </section>;
  } else if (!status.valid) {
    content = <section className="ps-state ps-state-invalid" role="alert">
      <XCircleIcon aria-hidden="true" />
      <h1>Pass is no longer valid</h1>
      <p>This pass is expired, revoked, or has been replaced by the event team.</p>
      <Link to="/">Return to VSMS</Link>
    </section>;
  } else {
    const queueState = status.queueState;
    content = <section className="ps-state ps-state-valid" aria-live="polite">
      <CheckBadgeIcon aria-hidden="true" />
      <span className="ps-badge">Valid pass</span>
      <h1>{status.eventName ?? 'Event pass'}</h1>

      <div className="ps-pass-code">
        <button type="button" className="ps-pass-expand" onClick={() => qrDialogRef.current?.showModal()} aria-label="Expand participant pass QR code">
          <img src={`/api/v1/qr/public-pass/${encodeURIComponent(token)}`} alt="Participant pass QR code for station staff to scan" />
        </button>
        <div><strong>Scan at each station</strong><span>Tap the code to enlarge it for authorised staff.</span></div>
      </div>

      {error && (
        <div className="ps-delayed" role="status">
          <strong>Update delayed</strong>
          <span>{lastUpdatedAt ? `Last updated ${lastUpdatedAt.toLocaleTimeString()}.` : error}</span>
          <button type="button" onClick={() => setRetryKey((value) => value + 1)}>Retry</button>
        </div>
      )}

      {queueState ? (
        <div className={`ps-state-card ps-state-tone-${queueState.status.toLowerCase().replace('_', '')}`}>
          <strong>{QUEUE_STATE_LABEL[queueState.status] ?? 'Screening in progress'}</strong>
          <p className="ps-state-card-sub">
            Go to <b>{queueState.station.name}</b>
          </p>
          <div className="ps-queue-grid">
            <div className="ps-queue-cell ps-queue-yours"><span className="ps-queue-label">Your number</span><strong className="ps-queue-value">{queueState.queueNumber}</strong></div>
            <div className="ps-queue-cell ps-queue-now"><span className="ps-queue-label">Now calling</span>{queueState.nowCalling == null ? <strong className="ps-queue-pending">Waiting to be called</strong> : <strong className="ps-queue-value">{queueState.nowCalling}</strong>}</div>
          </div>
        </div>
      ) : (
        <p className="ps-route-guidance">Follow the route below. Staff will help if a step is blocked.</p>
      )}

      {status.route.length > 0 && (
        <div className="ps-route">
          <h2>Your event route</h2>
          <ol>
            {status.route.map((step, index) => (
              <li key={`${step.stationType}-${index}`} data-state={step.state.toLowerCase()}>
                <span aria-hidden="true">{index + 1}</span>
                <div><strong>{step.stationName}</strong><small>{ROUTE_STATE_LABEL[step.state]}</small></div>
              </li>
            ))}
          </ol>
        </div>
      )}

      <p className="ps-live-note"><ClockIcon aria-hidden="true" />Updates automatically every 5 seconds.</p>
      <dl className="ps-facts">
        {status.expiresAt ? <div><dt>Pass valid until</dt><dd>{formatExpiry(status.expiresAt)}</dd></div> : null}
        <div><dt>Status</dt><dd>{String(status.registrationStatus).replace(/_/g, ' ').toLowerCase()}</dd></div>
      </dl>
      <Link to="/">Return to VSMS</Link>
    </section>;
  }

  return <main className="participant-status-page">
    <div className="participant-status-shell">
      <Link className="participant-status-brand" to="/"><img src="/favicon.svg" alt="" />VSMS</Link>
      {content}
      <dialog ref={qrDialogRef} className="ps-qr-dialog" aria-labelledby="expanded-qr-title" onClick={(event) => { if (event.target === event.currentTarget) event.currentTarget.close(); }}>
        <div className="ps-qr-dialog-card">
          <button type="button" className="ps-qr-close" onClick={() => qrDialogRef.current?.close()}>Close</button>
          <img src={`/api/v1/qr/public-pass/${encodeURIComponent(token)}`} alt="Expanded participant pass QR code for station staff to scan" />
          <strong id="expanded-qr-title">Ready to scan</strong>
          <span>Hold the screen steady in front of the station camera.</span>
        </div>
      </dialog>
      <footer className="participant-status-footer"><span>No personal information is shown on this page.</span><Link to="/">Staff sign in</Link></footer>
    </div>
  </main>;
}
