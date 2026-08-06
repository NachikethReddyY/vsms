import { ExclamationTriangleIcon, InformationCircleIcon } from '@heroicons/react/24/outline';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { AppToast } from '../../components/AppToast';
import { getApiError as getApiMessage } from '../../utils/apiClient';
import {
  EyeReading,
  FlagEvaluation,
  QueueRegistration,
  screeningApi,
  Station,
  VisualAcuityResultData,
} from './screeningApi';
import { loadStationContext, ParticipantLookup, StationHandoffLinks } from './StationShared';

const EXCEPTION_CODES = ['CF', 'HM', 'LP', 'NLP', 'NOT_TESTABLE'] as const;
const DENOMINATORS = [6, 9, 12, 15, 18, 24, 36, 60];

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
  const [searchParams] = useSearchParams();
  const [eventName, setEventName] = useState('');
  const [station, setStation] = useState<Station | null>(null);
  const [eventStations, setEventStations] = useState<Station[]>([]);
  const [queue, setQueue] = useState<QueueRegistration[]>([]);
  const [selectedId, setSelectedId] = useState(() => searchParams.get('registrationId') || '');
  const [passToken, setPassToken] = useState('abababababababababababababababababababababababababababababababab');
  const [od, setOd] = useState<EyeReading>({ kind: 'FRACTION', denominator: 6 });
  const [os, setOs] = useState<EyeReading>({ kind: 'FRACTION', denominator: 6 });
  const [glasses, setGlasses] = useState<'yes' | 'no' | 'unknown'>('unknown');
  const [evaluation, setEvaluation] = useState<FlagEvaluation | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [previewPending, setPreviewPending] = useState(false);
  const [instructionsOpen, setInstructionsOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [savedRegistrationId, setSavedRegistrationId] = useState<string | null>(null);

  const selected = useMemo(
    () => queue.find((row) => row.registrationId === selectedId) || null,
    [queue, selectedId],
  );

  const resultData: VisualAcuityResultData = useMemo(() => ({
    chartDistanceMetres: 6,
    od,
    os,
    withUsualDistanceGlasses: glasses === 'unknown' ? null : glasses === 'yes',
  }), [od, os, glasses]);

  // Reset acknowledgement whenever readings change (stale ack must not carry over).
  useEffect(() => {
    setAcknowledged(false);
    setEvaluation(null);
  }, [od, os, glasses, selectedId]);

  const load = async () => {
    if (!eventId) return;
    setError(null);
    try {
      const context = await loadStationContext(eventId, 'VISUAL_ACUITY', 'Visual Acuity', selectedId);
      setEventName(context.eventName);
      setStation(context.station);
      setEventStations(context.stations);
      setQueue(context.queue);
      if (!selectedId && context.nextSelectedId) setSelectedId(context.nextSelectedId);
    } catch (cause) {
      setError(getApiMessage(cause, 'Could not load the Visual Acuity station.'));
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  const runPreview = async () => {
    if (!eventId || !station) return null;
    setPreviewPending(true);
    setError(null);
    try {
      const next = await screeningApi.previewVisualAcuity(eventId, station.stationId, resultData);
      setEvaluation(next);
      if (!next.isFlagged) setAcknowledged(false);
      return next;
    } catch (cause) {
      setError(getApiMessage(cause, 'Could not evaluate screening flags.'));
      return null;
    } finally {
      setPreviewPending(false);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!eventId || !station || !selected) return;
    setPending(true);
    setError(null);
    setSuccess(null);
    try {
      const preview = evaluation ?? await runPreview();
      if (!preview) return;

      if (preview.isFlagged && !acknowledged) {
        setError('This result is flagged. Review the flag and tick acknowledgement before saving.');
        return;
      }

      const saved = await screeningApi.saveVisualAcuity(eventId, station.stationId, {
        registrationId: selected.registrationId,
        idempotencyKey: newIdempotencyKey(),
        acknowledged: preview.isFlagged ? acknowledged : false,
        resultData,
      });
      setSuccess(saved.queued
        ? 'Saved offline. It will sync when connected.'
        : saved.isFlagged
          ? `Saved with ${saved.overallFlag} flag (${saved.ruleVersion ?? preview.ruleVersion}): ${saved.flagSummary}`
          : `Saved Visual Acuity result (${saved.overallFlag}, ${saved.ruleVersion ?? preview.ruleVersion}).`);
      setSavedRegistrationId(selected.registrationId);
      setEvaluation(null);
      setAcknowledged(false);
      await load();
    } catch (cause) {
      setError(getApiMessage(cause, 'Could not save the Visual Acuity result.'));
    } finally {
      setPending(false);
    }
  };

  const canSave = Boolean(selected && station)
    && !pending
    && !previewPending
    && (!evaluation?.isFlagged || acknowledged);

  return (
    <div className="page-frame narrow">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Station workflow · Issue #27</p>
          <h1>Visual Acuity</h1>
          <p>{eventName || 'Loading event…'} — record chart results, review automatic flags, then acknowledge before save when flagged.</p>
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
          <p>Rule version <code>VSMS-VA-1.0</code> flags worse than 6/12 as REVIEW, worse than 6/18 or CF/LP as REFER, and HM/NLP as URGENT. Flagged results require explicit acknowledgement.</p>
        </aside>
      )}

      {error && <p className="form-error" role="alert">{error}</p>}
      <AppToast message={success ?? ''} />
      {success && (
        <StationHandoffLinks
          eventId={eventId}
          currentStationType="VISUAL_ACUITY"
          registrationId={savedRegistrationId || selectedId}
          stations={eventStations}
        />
      )}

      <ParticipantLookup
        eventId={eventId}
        queue={queue}
        selectedId={selectedId}
        onSelect={setSelectedId}
        selected={selected}
      />
      <section className="detail-panel" style={{ marginBottom: 24 }}>
        <h2>Find participant</h2>
        <div className="va-resolve-row">
          <label>
            Pass token / QR value
            <input value={passToken} onChange={(event) => setPassToken(event.target.value)} placeholder="abababababababababababababababababababababababababababababababab" />
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

        <div className="va-flag-actions">
          <button type="button" className="secondary" disabled={!station || previewPending} onClick={() => void runPreview()}>
            {previewPending ? 'Evaluating…' : 'Check automatic flags'}
          </button>
        </div>

        {evaluation && (
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
                  onChange={(event) => setAcknowledged(event.target.checked)}
                />
                <span>
                  I have reviewed this automatic flag and acknowledge saving a {evaluation.overallFlag} Visual Acuity result.
                </span>
              </label>
            )}
          </aside>
        )}

        <button className="primary" type="submit" disabled={!canSave}>
          {pending ? 'Saving…' : evaluation?.isFlagged ? 'Save flagged result' : 'Save Visual Acuity result'}
        </button>
      </form>
    </div>
  );
}
