import { CheckBadgeIcon, ClockIcon, ExclamationTriangleIcon, QrCodeIcon, XCircleIcon, BoltIcon, ArrowRightIcon, QueueListIcon } from '@heroicons/react/24/outline';
import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { LiveStationHandoffPicker, type LiveStationHandoffStation } from '../../components/qr/LiveStationHandoffPicker';
import apiClient, { getApiError as getApiMessage } from '../../utils/apiClient';
import type { components } from '../../generated/api';
import './ParticipantStatusPage.css';

type PublicPassStatus = components['schemas']['QrPublicStatusResponse']['data'];

const POLL_MS = 5000;

const formatExpiry = (value: string) =>
  new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));

const QUEUE_STATE_LABEL: Record<string, { label: string; tone: 'waiting' | 'called' | 'inprogress' | 'done' }> = {
  WAITING: { label: 'You are in the queue', tone: 'waiting' },
  CALLED: { label: 'Your number is called', tone: 'called' },
  IN_PROGRESS: { label: 'Being screened now', tone: 'inprogress' },
  COMPLETED: { label: 'Screening completed', tone: 'done' },
};

const STATION_TYPE_LABEL: Record<string, string> = {
  VISUAL_ACUITY: 'Visual Acuity',
  REFRACTION: 'Refraction',
  COLOUR_VISION: 'Colour Vision',
  EYE_HEALTH: 'Eye Health',
};

const workloadRows = (station: PublicPassStatus['stations'][number]) => [
  ['Waiting', station.workload.WAITING],
  ['Called', station.workload.CALLED],
  ['In progress', station.workload.IN_PROGRESS],
] as const;

export default function ParticipantStatusPage() {
  const { token = '' } = useParams();
  const [status, setStatus] = useState<PublicPassStatus | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const [handoffOpen, setHandoffOpen] = useState(false);
  const [handoffStationId, setHandoffStationId] = useState<string | null>(null);
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
    setHandoffStationId(null);
    setHandoffError('');
    setHandoffQr('');
  };

  const showHandoff = async (station: LiveStationHandoffStation) => {
    setHandoffStationId(station.stationId);
    setHandoffError('');
    setHandoffQr('');
    try {
      const { data } = await apiClient.get<{ success: boolean; data: { qrImage: string } }>(`/qr/handoff/${encodeURIComponent(token)}?station=${encodeURIComponent(station.stationType)}`);
      setHandoffQr(data.data.qrImage);
    } catch (cause) {
      setHandoffError(getApiMessage(cause, 'This screener pass could not be created.'));
    } finally {
      setHandoffStationId(null);
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
    const queueState = status.queueState;
    const stateMeta = queueState ? QUEUE_STATE_LABEL[queueState.status] : null;
    const stationLabel = queueState?.station ? STATION_TYPE_LABEL[queueState.station.type] || queueState.station.name : null;
    content = <section className="ps-state ps-state-valid" aria-live="polite">
      <CheckBadgeIcon aria-hidden="true" />
      <span className="ps-badge">Valid pass</span>
      <h1>{status.eventName ?? 'Event pass'}</h1>

      {queueState?.isPriority && (
        <span className="ps-badge ps-badge-urgent"><BoltIcon aria-hidden="true" />Priority — urgent handling</span>
      )}

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

      {queueState && stateMeta && (
        <div className={`ps-state-card ps-state-tone-${stateMeta.tone}`}>
          <div className="ps-state-card-head">
            <span className="ps-state-dot" aria-hidden="true" />
            <strong>{stateMeta.label}</strong>
          </div>
          {stationLabel && <p className="ps-state-card-sub">Go to <b>{stationLabel}</b> station{queueState.queueNumber != null ? ` · queue #${queueState.queueNumber}` : ''}</p>}
          {queueState.status === 'WAITING' && status.aheadAtStation != null && status.aheadAtStation > 0 && (
            <p className="ps-state-card-sub">{status.aheadAtStation} {status.aheadAtStation === 1 ? 'person' : 'people'} ahead at this station.</p>
          )}
        </div>
      )}

      {status.stations.some((station) => station.workload.WAITING > 0 || station.workload.CALLED > 0 || station.workload.IN_PROGRESS > 0) && (
        <div className="ps-stations">
          <h2><QueueListIcon aria-hidden="true" />Station workload</h2>
          {status.stations.map((station) => (
            <div key={station.stationId} className={`ps-station ${queueState?.station?.id === station.stationId ? 'ps-station-current' : ''}`}>
              <div className="ps-station-name">{station.stationName}</div>
              <div className="ps-station-row">
                {workloadRows(station).map(([label, count]) => (
                  <span key={label} className="ps-station-metric">
                    <b>{count}</b> {label.toLowerCase()}
                  </span>
                ))}
                {station.nextUp?.queueNumber != null && (
                  <span className="ps-station-nextup">Next up #<b>{station.nextUp.queueNumber}</b></span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {status.transfers.length > 0 && (
        <div className="ps-transfers">
          <h2><ArrowRightIcon aria-hidden="true" />Your station journey</h2>
          <ol className="ps-transfer-list">
            {status.transfers.map((transfer, index) => (
              <li key={`${transfer.fromStation}-${transfer.toStation}-${index}`}>
                <span>{transfer.fromStation}</span>
                <ArrowRightIcon aria-hidden="true" />
                <span>{transfer.toStation}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      <p className="ps-live-note"><ClockIcon aria-hidden="true" />Updates automatically every few seconds.</p>

      <dl className="ps-facts">
        {status.expiresAt ? <div><dt>Expires</dt><dd>{formatExpiry(status.expiresAt)}</dd></div> : null}
        {status.registrationStatus ? <div><dt>Status</dt><dd>{String(status.registrationStatus).replace(/_/g, ' ').toLowerCase()}</dd></div> : null}
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
        setHandoffStationId(null);
      }}
    >
      <button type="button" className="ps-handoff-close" aria-label="Close" onClick={closeHandoff}>x</button>
      <h2 id="ps-handoff-title">Screener pass</h2>
      <p className="ps-handoff-lead">Pick the station you are heading to next. The screener scans the pass to open your screening record directly.</p>
      <LiveStationHandoffPicker
        stations={status?.stations ?? []}
        pendingStationId={handoffStationId}
        onSelect={(station) => void showHandoff(station)}
        actionLabel="Create screener pass"
        emptyMessage="No stations are available for handoff."
      />
      {handoffStationId && <p className="ps-handoff-state" role="status">Creating screener pass...</p>}
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
