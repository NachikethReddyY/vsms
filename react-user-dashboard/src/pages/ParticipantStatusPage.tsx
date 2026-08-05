import { CheckBadgeIcon, ClockIcon, ExclamationTriangleIcon, XCircleIcon } from '@heroicons/react/24/outline';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import apiClient, { getApiError as getApiMessage } from '../utils/apiClient';
import './ParticipantStatusPage.css';

type PublicPassStatus = {
  valid: boolean;
  eventName: string | null;
  currentQueueNumber: number | null;
  queueNumber: number | null;
  expiresAt: string | null;
};

const formatExpiry = (value: string) =>
  new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));

export default function ParticipantStatusPage() {
  const { token = '' } = useParams();
  const [status, setStatus] = useState<PublicPassStatus | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    setStatus(null); setError(''); setLoading(true);
    apiClient.get<{ success: boolean; data: PublicPassStatus }>(`/qr/public-status/${encodeURIComponent(token)}`, { signal: controller.signal })
      .then(({ data }) => { if (!controller.signal.aborted) setStatus(data.data); })
      .catch((cause) => { if (!controller.signal.aborted) setError(getApiMessage(cause, 'This pass could not be verified.')); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [token]);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = 'Pass status · VSMS';
    return () => { document.title = previousTitle; };
  }, []);

  let content;
  if (error) {
    content = <section className="ps-state ps-state-error" role="alert">
      <ExclamationTriangleIcon aria-hidden="true" />
      <h1>Pass could not be verified</h1>
      <p>{error}</p>
      <Link to="/">Return to VSMS</Link>
    </section>;
  } else if (loading || !status) {
    content = <section className="ps-state" aria-live="polite">
      <ClockIcon aria-hidden="true" />
      <h1>Checking pass</h1>
      <p>Verifying this pass with the event system…</p>
    </section>;
  } else if (status.valid) {
    content = <section className="ps-state ps-state-valid" aria-live="polite">
      <CheckBadgeIcon aria-hidden="true" />
      <span className="ps-badge">Valid pass</span>
      <h1>{status.eventName ?? 'Event pass'}</h1>
      <div className="ps-queue-grid">
        <div className="ps-queue-cell ps-queue-now">
          <span className="ps-queue-label">Now serving</span>
          <strong className="ps-queue-value">{status.currentQueueNumber != null ? `#${status.currentQueueNumber}` : '—'}</strong>
          <span className="ps-queue-hint">people checked in so far</span>
        </div>
        <div className="ps-queue-cell ps-queue-yours">
          <span className="ps-queue-label">Your queue number</span>
          <strong className="ps-queue-value">{status.queueNumber != null ? `#${status.queueNumber}` : '—'}</strong>
          <span className="ps-queue-hint">keep this pass ready</span>
        </div>
      </div>
      <dl className="ps-facts">
        {status.expiresAt ? <div><dt>Expires</dt><dd>{formatExpiry(status.expiresAt)}</dd></div> : null}
      </dl>
      <Link to="/">Return to VSMS</Link>
    </section>;
  } else {
    content = <section className="ps-state ps-state-invalid" role="alert">
      <XCircleIcon aria-hidden="true" />
      <h1>Pass is no longer valid</h1>
      <p>This pass is expired, revoked, or has been replaced by the event team.</p>
      <Link to="/">Return to VSMS</Link>
    </section>;
  }

  return <main className="participant-status-page">
    <div className="participant-status-shell">
      <Link className="participant-status-brand" to="/"><span aria-hidden="true">V</span>VSMS</Link>
      {content}
      <footer className="participant-status-footer"><span>No personal information is shown on this page.</span><Link to="/">Staff sign in</Link></footer>
    </div>
  </main>;
}
