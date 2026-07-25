import { InformationCircleIcon } from '@heroicons/react/24/outline';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getApiMessage } from '../../auth/authState';
import {
  EyeReading,
  QueueRegistration,
  screeningApi,
  Station,
} from './screeningApi';

const EXCEPTION_CODES = ['CF', 'HM', 'LP', 'NLP', 'NOT_TESTABLE'] as const;
const DENOMINATORS = [6, 7.5, 9, 12, 15, 18, 24, 36, 60];

function newIdempotencyKey() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID().replace(/-/g, '');
  return `${Date.now()}${Math.random().toString(16).slice(2)}`;
}

function EyeFields({
  label,
  value,
  onChange,
}: {
  label: string;
  value: EyeReading;
  onChange: (next: EyeReading) => void;
}) {
  const isFraction = value.kind === 'FRACTION';
  return (
    <fieldset className="va-eye-card">
      <legend>{label}</legend>
      <div className="va-fraction">
        <span>6 /</span>
        <select
          value={isFraction ? String(value.denominator) : ''}
          onChange={(event) => onChange({ kind: 'FRACTION', denominator: Number(event.target.value) })}
          disabled={!isFraction}
        >
          <option value="" disabled>Select line</option>
          {DENOMINATORS.map((line) => (
            <option key={line} value={line}>{line}</option>
          ))}
        </select>
      </div>
      <div className="va-exceptions">
        {EXCEPTION_CODES.map((code) => (
          <button
            key={code}
            type="button"
            className={`secondary compact ${!isFraction && value.code === code ? 'is-selected' : ''}`}
            onClick={() => onChange({ kind: 'EXCEPTION', code })}
          >
            {code === 'NOT_TESTABLE' ? 'Not testable' : code}
          </button>
        ))}
        {!isFraction && (
          <button type="button" className="secondary compact" onClick={() => onChange({ kind: 'FRACTION', denominator: 6 })}>
            Use chart line
          </button>
        )}
      </div>
    </fieldset>
  );
}

export default function VisualAcuityStationPage() {
  const { eventId = '' } = useParams();
  const [eventName, setEventName] = useState('');
  const [station, setStation] = useState<Station | null>(null);
  const [queue, setQueue] = useState<QueueRegistration[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [passToken, setPassToken] = useState('VSMS-DEMO-QR-001');
  const [od, setOd] = useState<EyeReading>({ kind: 'FRACTION', denominator: 6 });
  const [os, setOs] = useState<EyeReading>({ kind: 'FRACTION', denominator: 6 });
  const [glasses, setGlasses] = useState<'yes' | 'no' | 'unknown'>('unknown');
  const [instructionsOpen, setInstructionsOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const selected = useMemo(
    () => queue.find((row) => row.registrationId === selectedId) || null,
    [queue, selectedId],
  );

  const load = async () => {
    if (!eventId) return;
    setError(null);
    try {
      const stationsPayload = await screeningApi.listStations(eventId);
      setEventName(stationsPayload.event.name);
      const va = stationsPayload.stations.find((item) => item.stationType === 'VISUAL_ACUITY');
      if (!va) throw new Error('Visual Acuity station is not configured for this event.');
      setStation(va);
      const queuePayload = await screeningApi.listQueue(eventId, va.stationId);
      setQueue(queuePayload.registrations);
      if (!selectedId && queuePayload.registrations[0]) {
        setSelectedId(queuePayload.registrations[0].registrationId);
      }
    } catch (cause) {
      setError(getApiMessage(cause, 'Could not load the Visual Acuity station.'));
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  const resolvePass = async () => {
    if (!eventId || !passToken.trim()) return;
    setError(null);
    try {
      const person = await screeningApi.resolve(eventId, { passToken: passToken.trim() });
      setSelectedId(person.registrationId);
      setSuccess(`Loaded ${person.participantDisplayName} from pass token.`);
    } catch (cause) {
      setError(getApiMessage(cause, 'Could not resolve that participant pass.'));
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!eventId || !station || !selected) return;
    setPending(true);
    setError(null);
    setSuccess(null);
    try {
      const saved = await screeningApi.saveVisualAcuity(eventId, station.stationId, {
        registrationId: selected.registrationId,
        idempotencyKey: newIdempotencyKey(),
        acknowledged: true,
        resultData: {
          chartDistanceMetres: 6,
          od,
          os,
          withUsualDistanceGlasses: glasses === 'unknown' ? null : glasses === 'yes',
        },
      });
      setSuccess(
        saved.isFlagged
          ? `Saved with ${saved.overallFlag} flag: ${saved.flagSummary}`
          : `Saved Visual Acuity result (${saved.overallFlag}).`,
      );
      await load();
    } catch (cause) {
      setError(getApiMessage(cause, 'Could not save the Visual Acuity result.'));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="page-frame narrow">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Station workflow</p>
          <h1>Visual Acuity</h1>
          <p>{eventName || 'Loading event…'} — record chart results for a checked-in participant. Participants do not log in.</p>
        </div>
        <div className="action-cluster">
          <button type="button" className="secondary" onClick={() => setInstructionsOpen((open) => !open)} aria-expanded={instructionsOpen}>
            <InformationCircleIcon /> Instructions
          </button>
          <Link className="secondary" to={`/events/${eventId}`}>Back to event</Link>
        </div>
      </div>

      {instructionsOpen && (
        <aside className="detail-panel" style={{ marginBottom: 24 }}>
          <h2>Station instructions</h2>
          <p>Position the participant at the marked 6 m chart distance. Test right eye, then left eye; cover the other eye without pressure. Record the smallest line read. Use exception buttons if no chart line is readable. Use the participant’s usual distance glasses where applicable.</p>
        </aside>
      )}

      {error && <p className="form-error" role="alert">{error}</p>}
      {success && <p className="banner-success" role="status">{success}</p>}

      <section className="detail-panel" style={{ marginBottom: 24 }}>
        <h2>Find participant</h2>
        <div className="va-resolve-row">
          <label>
            Pass token / QR value
            <input value={passToken} onChange={(event) => setPassToken(event.target.value)} placeholder="VSMS-DEMO-QR-001" />
          </label>
          <button type="button" className="primary" onClick={() => void resolvePass()}>Load pass</button>
        </div>
        <label>
          Or choose from station queue
          <select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
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

      <form className="detail-panel va-form" onSubmit={(event) => void submit(event)}>
        <h2>Chart result</h2>
        <p>Test distance fixed at <strong>6 m</strong>. Enter denominators only.</p>
        <div className="va-eye-grid">
          <EyeFields label="Right eye (OD)" value={od} onChange={setOd} />
          <EyeFields label="Left eye (OS)" value={os} onChange={setOs} />
        </div>
        <label>
          Usual distance glasses?
          <select value={glasses} onChange={(event) => setGlasses(event.target.value as typeof glasses)}>
            <option value="unknown">Unknown</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </label>
        <button className="primary" type="submit" disabled={pending || !selected || !station}>
          {pending ? 'Saving…' : 'Save Visual Acuity result'}
        </button>
      </form>
    </div>
  );
}
