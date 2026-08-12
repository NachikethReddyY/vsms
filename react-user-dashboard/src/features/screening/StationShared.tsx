/* eslint-disable react-refresh/only-export-components */
import { ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import {
  FormEvent,
  ReactNode,
  useCallback,
  useEffect,
  useState,
} from 'react';
import { Link } from 'react-router-dom';
import { AppToast } from '../../components/AppToast';
import {
  LiveStationHandoffPicker,
  type LiveStationHandoffStation,
} from '../../components/qr/LiveStationHandoffPicker';
import apiClient, { getApiError as getApiMessage } from '../../utils/apiClient';
import { getStoredSession } from '../../utils/session';
import {
  FlagEvaluation,
  QueueJourney,
  QueueRegistration,
  screeningApi,
  Station,
  StationType,
} from './screeningApi';
import { extractQrToken } from './qrHandoff';
import { getOfflineStationContext, isNetworkError } from './offlineSync';
import { stationPath } from './stationConfig';
import { StationCameraScanner } from './StationCameraScanner';
import './StationCameraScanner.css';

export function StationHandoffLinks({
  eventId,
  registrationId,
  journey,
  queuedOffline = false,
}: {
  eventId: string;
  registrationId?: string | null;
  journey?: QueueJourney | null;
  queuedOffline?: boolean;
}) {
  const nextStation = journey?.assignedStation;

  const nextHref =
    nextStation && registrationId
      ? stationPath(eventId, nextStation.stationType, registrationId)
      : null;

  const [liveStations, setLiveStations] = useState<
    LiveStationHandoffStation[]
  >([]);

  useEffect(() => {
    if (!eventId) return;

    let cancelled = false;

    void apiClient
      .get<{ stations: LiveStationHandoffStation[] }>(
        `/queues/events/${eventId}/stations`,
      )
      .then(({ data }) => {
        if (cancelled) return;

        setLiveStations(data.stations);
      })
      .catch(() => {
        if (!cancelled) {
          setLiveStations([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [eventId]);

  return (
    <nav className="va-handoff" aria-label="Continue screening">
      <p className="va-handoff-label">
        {queuedOffline
          ? 'Result saved offline. Queue movement will be decided by the backend when this action syncs.'
          : journey?.state === 'QUEUED' && nextStation
            ? `Station complete. The backend assigned ${nextStation.stationName}.`
            : journey?.state === 'COMPLETED'
              ? 'All required screening stations are complete.'
              : 'Station complete. No remaining staffed station is currently available.'}
      </p>

      <div className="action-cluster" style={{ paddingTop: 0 }}>
        {nextHref && nextStation && (
          <Link className="primary" to={nextHref}>
            Open {nextStation.stationName} tablet
          </Link>
        )}

        {journey?.state === 'COMPLETED' && (
          <Link className="primary" to={`/events/${eventId}/reviews`}>
            Open clinical review
          </Link>
        )}

        {!queuedOffline && liveStations.length > 0 && (
          <LiveStationHandoffPicker
            eventId={eventId}
            registrationId={registrationId ?? ''}
            stations={liveStations}
          />
        )}

        <Link className="secondary" to={`/events/${eventId}`}>
          Back to event
        </Link>
      </div>
    </nav>
  );
}

export function FlagBanner({
  evaluation,
  acknowledged,
  onAcknowledgedChange,
  stationLabel,
}: {
  evaluation: FlagEvaluation;
  acknowledged: boolean;
  onAcknowledgedChange: (next: boolean) => void;
  stationLabel: string;
}) {
  return (
    <aside
      className={`va-flag-banner flag-${evaluation.overallFlag.toLowerCase()}`}
      role="status"
      aria-live="polite"
    >
      <div className="va-flag-banner-head">
        <ExclamationTriangleIcon />
        <div>
          <strong>
            {evaluation.isFlagged
              ? `${evaluation.overallFlag} flag`
              : 'No clinical flag'}
          </strong>
          <small>Rule {evaluation.ruleVersion}</small>
        </div>
      </div>

      <p>{evaluation.flagSummary}</p>

      {evaluation.reasons.length > 0 && (
        <ul>
          {evaluation.reasons.map((item) => (
            <li key={`${item.flag}-${item.reason}`}>
              {item.flag}: {item.reason}
            </li>
          ))}
        </ul>
      )}

      {evaluation.isFlagged && (
        <label className="va-ack">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(event) =>
              onAcknowledgedChange(event.target.checked)
            }
          />
          <span>
            I have reviewed this automatic flag and acknowledge saving a{' '}
            {evaluation.overallFlag} {stationLabel} result.
          </span>
        </label>
      )}
    </aside>
  );
}

export function ParticipantLookup({
  eventId,
  queue,
  selectedId,
  onSelect,
  selected,
}: {
  eventId: string;
  queue: QueueRegistration[];
  selectedId: string;
  onSelect: (registrationId: string) => void;
  selected: QueueRegistration | null;
}) {
  const [passToken, setPassToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);

  const applyResolved = useCallback(
    (
      person: {
        registrationId: string;
        participantDisplayName: string;
      },
      source: string,
    ) => {
      onSelect(person.registrationId);
      setSuccess(
        `Loaded ${person.participantDisplayName} from ${source}.`,
      );
    },
    [onSelect],
  );

  const resolvePass = async () => {
    if (!eventId || !passToken.trim()) return;

    setError(null);
    setSuccess(null);

    try {
      const token = extractQrToken(passToken) || passToken.trim();

      const person = await screeningApi.resolve(eventId, {
        passToken: token,
        qrToken: token,
      });

      applyResolved(person, 'pass / QR token');
    } catch (cause) {
      setError(
        getApiMessage(
          cause,
          'Could not resolve that participant pass.',
        ),
      );
    }
  };

  const onCameraScan = useCallback(
    async (raw: string) => {
      if (!eventId) {
        throw new Error('Event is not ready.');
      }

      const token = extractQrToken(raw);

      if (!token) {
        throw new Error('No QR token found in the scan.');
      }

      setError(null);
      setSuccess(null);
      setPassToken(token);

      try {
        const person = await screeningApi.resolve(eventId, {
          passToken: token,
          qrToken: token,
        });

        applyResolved(person, 'camera scan');
      } catch (cause) {
        const message = getApiMessage(
          cause,
          'Could not resolve that participant pass.',
        );

        setError(message);
        throw new Error(message);
      }
    },
    [eventId, applyResolved],
  );

  return (
    <section className="detail-panel" style={{ marginBottom: 24 }}>
      <h2>Find participant</h2>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      <AppToast message={success ?? ''} />

      <div className="va-resolve-row">
        <label>
          Pass token / QR value
          <input
            value={passToken}
            onChange={(event) => setPassToken(event.target.value)}
            placeholder="…/participant-status/<token> or 64-hex token"
          />
        </label>

        <button
          type="button"
          className="primary"
          onClick={() => void resolvePass()}
        >
          Load pass
        </button>

        <button
          type="button"
          className="secondary"
          onClick={() => setScannerOpen(true)}
        >
          Scan QR with camera
        </button>
      </div>

      <p className="va-resolve-hint">
        Paste the full QR value or the hex token from the pass.
      </p>

      <label>
        Or choose from station queue
        <select
          value={selectedId}
          onChange={(event) => onSelect(event.target.value)}
        >
          <option value="" disabled>
            Select participant
          </option>

          {queue.map((row) => (
            <option
              key={row.registrationId}
              value={row.registrationId}
            >
              #{row.queueNumber ?? '—'} {row.participantDisplayName}
              {row.existingResult
                ? ` · ${row.existingResult.overallFlag}`
                : ''}
            </option>
          ))}
        </select>
      </label>

      {selected && (
        <p>
          Screening <strong>{selected.participantDisplayName}</strong>
          {selected.passToken ? (
            <>
              {' '}
              · pass <code>{selected.passToken}</code>
            </>
          ) : null}
        </p>
      )}

      <StationCameraScanner
        open={scannerOpen}
        onOpenChange={setScannerOpen}
        onScan={onCameraScan}
      />
    </section>
  );
}

export function StationPageFrame({
  eventId,
  title,
  eyebrow,
  description,
  eventName,
  instructionsOpen,
  onToggleInstructions,
  instructions,
  error,
  success,
  handoff,
  children,
}: {
  eventId: string;
  title: string;
  eyebrow: string;
  description: string;
  eventName: string;
  instructionsOpen: boolean;
  onToggleInstructions: () => void;
  instructions: ReactNode;
  error: string | null;
  success: string | null;
  handoff?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="page-frame narrow">
      <div className="page-heading">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
          <p>
            {eventName || 'Loading event…'} — {description}
          </p>
        </div>

        <div className="action-cluster">
          <button
            type="button"
            className="secondary"
            onClick={onToggleInstructions}
            aria-expanded={instructionsOpen}
          >
            Instructions
          </button>

          <Link
            className="secondary"
            to={`/events/${eventId}`}
          >
            Back to event
          </Link>
        </div>
      </div>

      {instructionsOpen && (
        <aside
          className="detail-panel"
          style={{ marginBottom: 24 }}
        >
          <h2>Station instructions</h2>
          {instructions}
        </aside>
      )}

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      <AppToast message={success ?? ''} />

      {success && handoff}

      {children}
    </div>
  );
}

export async function loadStationContext(
  eventId: string,
  stationType: StationType,
  label: string,
  selectedId: string,
): Promise<{
  eventName: string;
  station: Station;
  stations: Station[];
  queue: QueueRegistration[];
  nextSelectedId: string;
}> {
  try {
    const stationsPayload =
      await screeningApi.listStations(eventId);

    const station = stationsPayload.stations.find(
      (item) => item.stationType === stationType,
    );

    if (!station) {
      throw new Error(
        `${label} station is not configured for this event.`,
      );
    }

    const queuePayload = await screeningApi.listQueue(
      eventId,
      station.stationId,
    );

    return {
      eventName: stationsPayload.event.name,
      station,
      stations: stationsPayload.stations,
      queue: queuePayload.registrations,
      nextSelectedId:
        selectedId ||
        queuePayload.registrations[0]?.registrationId ||
        '',
    };
  } catch (error) {
    if (!isNetworkError(error)) {
      throw error;
    }

    const ownerId = getStoredSession()?.user.id;

    const offline = ownerId
      ? await getOfflineStationContext(
          ownerId,
          eventId,
          stationType,
        )
      : null;

    if (!offline) {
      throw error;
    }

    return {
      ...offline,
      nextSelectedId:
        selectedId ||
        offline.queue[0]?.registrationId ||
        '',
    };
  }
}

export function preventDefaultSubmit(
  handler: () => Promise<void>,
) {
  return (event: FormEvent) => {
    event.preventDefault();
    void handler();
  };
}
