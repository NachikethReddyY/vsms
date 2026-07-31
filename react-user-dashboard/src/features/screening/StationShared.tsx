import { ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import { FormEvent, ReactNode, useState } from 'react';
import { Link } from 'react-router-dom';
import { getApiMessage } from '../../auth/authState';
import {
  FlagEvaluation,
  QueueRegistration,
  screeningApi,
  Station,
  StationType,
} from './screeningApi';

/** Slugs for station pages that currently have UI routes. */
export const STATION_PATH_SLUG: Partial<Record<StationType, string>> = {
  VISUAL_ACUITY: 'visual-acuity',
  REFRACTION: 'refraction',
  COLOUR_VISION: 'colour-vision',
};

export const STATION_LABEL: Record<StationType, string> = {
  VISUAL_ACUITY: 'Visual Acuity',
  REFRACTION: 'Refraction',
  COLOUR_VISION: 'Colour Vision',
  EYE_HEALTH: 'Eye Health',
};

/** Default clinical order when event stationOrder is unavailable. */
export const DEFAULT_STATION_ORDER: StationType[] = [
  'VISUAL_ACUITY',
  'REFRACTION',
  'COLOUR_VISION',
  'EYE_HEALTH',
];

export function stationPath(
  eventId: string,
  stationType: StationType,
  registrationId?: string | null,
): string | null {
  const slug = STATION_PATH_SLUG[stationType];
  if (!slug) return null;
  const base = `/events/${eventId}/stations/${slug}`;
  if (!registrationId) return base;
  return `${base}?registrationId=${encodeURIComponent(registrationId)}`;
}

export function orderedStationTypes(stations?: Station[]): StationType[] {
  if (stations && stations.length > 0) {
    return [...stations]
      .filter((item) => item.isActive)
      .sort((a, b) => a.stationOrder - b.stationOrder)
      .map((item) => item.stationType);
  }
  return DEFAULT_STATION_ORDER;
}

/** Stations after the current one that have a working staff UI route. */
export function nextStationTypes(
  current: StationType,
  stations?: Station[],
): StationType[] {
  const order = orderedStationTypes(stations);
  const index = order.indexOf(current);
  const after = index >= 0 ? order.slice(index + 1) : order.filter((type) => type !== current);
  return after.filter((type) => Boolean(STATION_PATH_SLUG[type]));
}

export function StationHandoffLinks({
  eventId,
  currentStationType,
  registrationId,
  stations,
}: {
  eventId: string;
  currentStationType: StationType;
  registrationId?: string | null;
  stations?: Station[];
}) {
  const next = nextStationTypes(currentStationType, stations);
  const isLastScreeningStation = next.length === 0;

  return (
    <nav className="va-handoff" aria-label="Continue screening">
      <p className="va-handoff-label">
        {next.length > 0 ? 'Continue to next station' : 'Screening stations complete for this route'}
        {registrationId ? ' · same participant kept' : null}
      </p>
      <div className="action-cluster" style={{ paddingTop: 0 }}>
        {next.map((type, index) => {
          const href = stationPath(eventId, type, registrationId);
          if (!href) return null;
          return (
            <Link
              key={type}
              className={index === 0 ? 'primary' : 'secondary'}
              to={href}
            >
              {index === 0 ? 'Next: ' : ''}{STATION_LABEL[type]}
            </Link>
          );
        })}
        {isLastScreeningStation && (
          <Link className="primary" to={`/events/${eventId}/reviews`}>
            Open clinical review
          </Link>
        )}
        <Link className="secondary" to={`/events/${eventId}`}>Back to event</Link>
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
          <strong>{evaluation.isFlagged ? `${evaluation.overallFlag} flag` : 'No clinical flag'}</strong>
          <small>Rule {evaluation.ruleVersion}</small>
        </div>
      </div>
      <p>{evaluation.flagSummary}</p>
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
  const [passToken, setPassToken] = useState('VSMS-DEMO-QR-001');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const resolvePass = async () => {
    if (!eventId || !passToken.trim()) return;
    setError(null);
    setSuccess(null);
    try {
      const person = await screeningApi.resolve(eventId, { passToken: passToken.trim() });
      onSelect(person.registrationId);
      setSuccess(`Loaded ${person.participantDisplayName} from pass token.`);
    } catch (cause) {
      setError(getApiMessage(cause, 'Could not resolve that participant pass.'));
    }
  };

  return (
    <section className="detail-panel" style={{ marginBottom: 24 }}>
      <h2>Find participant</h2>
      {error && <p className="form-error" role="alert">{error}</p>}
      {success && <p className="banner-success" role="status">{success}</p>}
      <div className="va-resolve-row">
        <label>
          Pass token / QR value
          <input value={passToken} onChange={(event) => setPassToken(event.target.value)} placeholder="VSMS-DEMO-QR-001" />
        </label>
        <button type="button" className="primary" onClick={() => void resolvePass()}>Load pass</button>
      </div>
      <label>
        Or choose from station queue
        <select value={selectedId} onChange={(event) => onSelect(event.target.value)}>
          <option value="" disabled>Select participant</option>
          {queue.map((row) => (
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
          {selected.passToken ? <> · pass <code>{selected.passToken}</code></> : null}
        </p>
      )}
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
      {success && <p className="banner-success" role="status">{success}</p>}
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
}

export function preventDefaultSubmit(handler: () => Promise<void>) {
  return (event: FormEvent) => {
    event.preventDefault();
    void handler();
  };
}
