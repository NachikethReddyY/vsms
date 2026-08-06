import { CheckBadgeIcon, ClockIcon, ExclamationTriangleIcon, QrCodeIcon, XCircleIcon } from '@heroicons/react/24/outline';
import { useEffect, useRef, useState } from 'react';
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

type HandoffStation = {
  type: string;
  label: string;
};

const HANDOFF_STATIONS: HandoffStation[] = [
  { type: 'VISUAL_ACUITY', label: 'Visual Acuity' },
  { type: 'REFRACTION', label: 'Refraction' },
  { type: 'COLOUR_VISION', label: 'Colour Vision' },
];

const POLL_MS = 5000;

const formatExpiry = (value: string) =>
  new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));

export default function ParticipantStatusPage() {
  const { token = '' } = useParams();
  const [status, setStatus] = useState<PublicPassStatus | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const [handoffOpen, setHandoffOpen] = useState(false);
  const [handoffLoading, setHandoffLoading] = useState(false);
  const [handoffError, setHandoffError] = useState('');
  const [handoffQr, setHandoffQr] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hasStatusRef = useRef(false);
  const dialogRef = useRef<HTMLDialogElement | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const fetchStatus = () => {
      if (!hasStatusRef.current) setLoading(true);
      return apiClient.get<{ success: boolean; data: PublicPassStatus }>(`/qr/public-status/${encodeURIComponent(token)}`, { signal: controller.signal })
        .then(({ data }) => { if (!controller.signal.aborted) { setStatus(data.data); setError(''); } })
        .catch((cause) => { if (!controller.signal.aborted) setError(getApiMessage(cause, 'This pass could not be verified.')); })
        .finally(() => { if (!controller.signal.aborted) { setLoading(false); hasStatusRef.current = true; } });
    };
    void fetchStatus();
    pollRef.current = setInterval(() => void fetchStatus(), POLL_MS);
    return () => {
      controller.abort();
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [token]);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = 'Pass status · VSMS';
    return () => { document.title = previousTitle; };
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (handoffOpen && !dialog.open) dialog.showModal();
    else if (!handoffOpen && dialog.open) dialog.close();
  }, [handoffOpen]);

  const closeHandoff = () => {
    setHandoffOpen(false);
    setHandoffLoading(false);
    setHandoffError('');
    setHandoffQr('');
  };

  const showHandoff = async (station: HandoffStation) => {
    setHandoffLoading(true);
    setHandoffError('');
    setHandoffQr('');
    try {
      const { data } = await apiClient.get<{ success: boolean; data: { qrImage: string } }>(`/qr/handoff/${encodeURIComponent(token)}?station=${encodeURIComponent(station.type)}`);
      setHandoffQr(data.data.qrImage);
    } catch (cause) {
      setHandoffError(getApiMessage(cause, 'This screener pass could not be created.'));
    } finally {
      setHandoffLoading(false);
    }
  };

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

      <div className="ps-queue-stack">
        <div className="ps-queue-cell ps-queue-now">
          <span className="ps-queue-label">Now serving</span>
          <strong className="ps-queue-value">{status.currentQueueNumber != null ? `#${status.currentQueueNumber}` : '—'}</strong>
          <span className="ps-queue-hint">people checked in so far</span>
        </div>
        <div className="ps-queue-cell ps-queue-yours">
          <span className="ps-queue-label">Your queue number</span>
          <strong className="ps-queue-value">{status.queueNumber != null ? `#${status.queueNumber}` : '—'}</strong>
          <span className="ps-queue-hint">watch for your number below</span>
        </div>
      </div>

      <p className="ps-live-note"><ClockIcon aria-hidden="true" />Updates automatically every few seconds.</p>

      <dl className="ps-facts">
        {status.expiresAt ? <div><dt>Expires</dt><dd>{formatExpiry(status.expiresAt)}</dd></div> : null}
      </dl>

      <div className="ps-handoff">
        <button
          type="button"
          className="ps-handoff-toggle"
          aria-haspopup="dialog"
          onClick={() => setHandoffOpen(true)}
        >
          <QrCodeIcon aria-hidden="true" />Show a screener pass
        </button>
      </div>

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

    <dialog
      ref={dialogRef}
      className="ps-handoff-dialog"
      aria-labelledby="ps-handoff-title"
      onClose={() => {
        setHandoffOpen(false);
        setHandoffLoading(false);
      }}
    >
      <button type="button" className="ps-handoff-close" aria-label="Close" onClick={closeHandoff}>✕</button>
      <h2 id="ps-handoff-title">Screener pass</h2>
      <p className="ps-handoff-lead">Pick the station you are heading to next. The screener scans the pass to open your screening record directly.</p>
      <div className="ps-handoff-stations">
        {HANDOFF_STATIONS.map((station) => (
          <button
            key={station.type}
            type="button"
            className="ps-handoff-station"
            disabled={handoffLoading}
            onClick={() => void showHandoff(station)}
          >
            {station.label}
          </button>
        ))}
      </div>
      {handoffLoading && <p className="ps-handoff-state" role="status">Creating screener pass…</p>}
      {handoffError && <p className="ps-handoff-state ps-handoff-error" role="alert">{handoffError}</p>}
      {handoffQr && (
        <div className="ps-handoff-qr">
          <img src={handoffQr} alt="Screener pass QR code" />
          <p>Show this to the station screener. No personal information is stored in the code.</p>
        </div>
      )}
    </dialog>
  </main>;
}
