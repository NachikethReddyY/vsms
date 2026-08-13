/* eslint-disable react-refresh/only-export-components */
import { ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import { FormEvent, ReactNode, useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppToast } from '../../components/AppToast';
import { getApiError as getApiMessage } from '../../utils/apiClient';
import { getStoredSession } from '../../utils/session';
import {
  FlagEvaluation,
  QueueRegistration,
  screeningApi,
  Station,
  StationType,
} from './screeningApi';
import { extractQrToken } from './qrHandoff';
import { getOfflineStationContext, isNetworkError } from './offlineSync';
import { StationCameraScanner } from './StationCameraScanner';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function participantReference(value: string) {
  const reference = value.trim();
  if (UUID.test(reference)) return { registrationId: reference };
  const token = extractQrToken(reference) || reference;
  return { passToken: token, qrToken: token };
}

export function RouteProgressionNotice({
  eventId,
  queued = false,
}: {
  eventId: string;
  queued?: boolean;
}) {
  return (
    <section className="va-handoff" aria-live="polite">
      <p className="va-handoff-label">{queued
        ? 'Pending sync — the participant has not entered the next queue yet.'
        : 'Result committed. The server has updated the participant route and queue.'}</p>
      <div className="action-cluster" style={{ paddingTop: 0 }}>
        <Link className="secondary" to={`/events/${eventId}`}>Back to event</Link>
      </div>
    </section>
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
          <strong>{evaluation.isFlagged ? `${evaluation.overallFlag} flag` : 'No clinical flag'}</strong>
          <small>Rule {evaluation.ruleVersion}</small>
        </div>
      </div>
      {evaluation.flagSummary && <p>{evaluation.flagSummary}</p>}
      {evaluation.reasons.length > 0 && (
        <ul>
          {evaluation.reasons.map((item) => (
            <li key={`${item.flag}-${item.reason}`}>{item.flag}: {item.reason}</li>
          ))}
        </ul>
      )}
      {evaluation.isFlagged && (
        <label className="va-ack">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(event) => onAcknowledgedChange(event.target.checked)}
          />
          <span>
            I have reviewed this automatic flag and acknowledge saving a {evaluation.overallFlag} {stationLabel} result.
          </span>
        </label>
      )}
    </aside>
  );
}

export function ParticipantLookup({
  eventId,
  currentStationId,
  queue,
  selectedId,
  onSelect,
  selected,
}: {
  eventId: string;
  currentStationId: string;
  queue: QueueRegistration[];
  selectedId: string;
  onSelect: (registrationId: string) => void;
  selected: QueueRegistration | null;
}) {
  const [passToken, setPassToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [queueSearch, setQueueSearch] = useState('');
  const [lookupPending, setLookupPending] = useState(false);
  const filteredQueue = useMemo(() => {
    const search = queueSearch.trim().toLowerCase();
    if (!search) return queue;
    return queue.filter((row) => row.participantDisplayName.toLowerCase().includes(search) || String(row.queueNumber ?? '').includes(search));
  }, [queue, queueSearch]);

  const applyResolved = useCallback((person: {
    registrationId: string;
    participantDisplayName: string;
    activeStation: { stationId: string; stationName: string } | null;
  }, source: string) => {
    if (!person.activeStation) {
      const message = 'This participant has no active station assignment. Ask an authorized officer to resolve the route.';
      setError(message);
      throw new Error(message);
    }
    if (person.activeStation.stationId !== currentStationId) {
      const message = `This participant is assigned to ${person.activeStation.stationName}, not this station.`;
      setError(message);
      throw new Error(message);
    }
    setError(null);
    onSelect(person.registrationId);
    setSuccess(`Loaded ${person.participantDisplayName} from ${source}.`);
  }, [currentStationId, onSelect]);

  const resolvePass = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!eventId || !passToken.trim()) return;
    setLookupPending(true);
    setError(null);
    setSuccess(null);
    try {
      const reference = participantReference(passToken);
      const person = await screeningApi.resolve(eventId, reference);
      applyResolved(person, 'registration reference');
    } catch (cause) {
      setError(getApiMessage(cause, 'Could not resolve that participant pass.'));
    } finally {
      setLookupPending(false);
    }
  };

  const onCameraScan = useCallback(async (raw: string) => {
    if (!eventId) throw new Error('Event is not ready.');
    const reference = participantReference(raw);
    setError(null);
    setSuccess(null);
    setPassToken(raw.trim());
    try {
      const person = await screeningApi.resolve(eventId, reference);
      applyResolved(person, 'scanner');
    } catch (cause) {
      const message = getApiMessage(cause, 'Could not resolve that participant pass.');
      setError(message);
      throw new Error(message);
    }
  }, [eventId, applyResolved]);

  return (
    <section className="detail-panel" style={{ marginBottom: 24 }}>
      <h2>Find participant</h2>
      {error && <p className="form-error" role="alert">{error}</p>}
      <AppToast message={success ?? ''} />
      <form className="va-resolve-row" onSubmit={(event) => void resolvePass(event)}>
        <label>
          QR value / registration UUID
          <input
            value={passToken}
            onChange={(event) => setPassToken(event.target.value)}
            placeholder="QR URL, token, or registration UUID"
          />
        </label>
        <button type="submit" className="primary" disabled={lookupPending}>{lookupPending ? 'Loading…' : 'Load pass'}</button>
        <button type="button" className="secondary" onClick={() => setScannerOpen(true)}>
          Scan QR with camera
        </button>
      </form>
      <p className="va-resolve-hint">Registration UUID lookup continues to work from the encrypted station download when offline.</p>
      <label>
        Search this station queue
        <input type="search" value={queueSearch} onChange={(event) => setQueueSearch(event.target.value)} placeholder="Queue number or participant name" />
      </label>
      <label>
        Choose from this station queue
        <select value={selectedId} onChange={(event) => onSelect(event.target.value)}>
          <option value="" disabled>Select participant</option>
          {filteredQueue.map((row) => (
            <option key={row.registrationId} value={row.registrationId}>
              #{row.queueNumber ?? '—'} {row.participantDisplayName}
              {row.existingResult ? ` · ${row.existingResult.overallFlag}` : ''}
            </option>
          ))}
        </select>
      </label>
      {selected && (
        <p>
          Screening <strong>{selected.participantDisplayName}</strong>
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
          <p>{eventName || 'Loading event…'} — {description}</p>
        </div>
        <div className="action-cluster">
          <button type="button" className="secondary" onClick={onToggleInstructions} aria-expanded={instructionsOpen}>
            Instructions
          </button>
          <Link className="secondary" to={`/events/${eventId}`}>Back to event</Link>
        </div>
      </div>

      {instructionsOpen && (
        <aside className="detail-panel" style={{ marginBottom: 24 }}>
          <h2>Station instructions</h2>
          {instructions}
        </aside>
      )}

      {error && <p className="form-error" role="alert">{error}</p>}
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
    const stationsPayload = await screeningApi.listStations(eventId);
    const station = stationsPayload.stations.find((item) => item.stationType === stationType);
    if (!station) throw new Error(`${label} station is not configured for this event.`);
    const queuePayload = await screeningApi.listQueue(eventId, station.stationId);
    return {
      eventName: stationsPayload.event.name,
      station,
      stations: stationsPayload.stations,
      queue: queuePayload.registrations,
      nextSelectedId: selectedId || queuePayload.registrations[0]?.registrationId || '',
    };
  } catch (error) {
    if (!isNetworkError(error)) throw error;
    const ownerId = getStoredSession()?.user.id;
    const offline = ownerId ? await getOfflineStationContext(ownerId, eventId, stationType) : null;
    if (!offline) throw error;
    return {
      ...offline,
      nextSelectedId: selectedId || offline.queue[0]?.registrationId || '',
    };
  }
}

export function preventDefaultSubmit(handler: () => Promise<void>) {
  return (event: FormEvent) => {
    event.preventDefault();
    void handler();
  };
}
