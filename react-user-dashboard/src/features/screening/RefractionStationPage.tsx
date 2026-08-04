import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { getApiError as getApiMessage } from '../../utils/apiClient';
import {
  FlagEvaluation,
  newIdempotencyKey,
  QueueRegistration,
  RefractionEye,
  RefractionResultData,
  screeningApi,
  Station,
} from './screeningApi';
import {
  FlagBanner,
  loadStationContext,
  ParticipantLookup,
  StationHandoffLinks,
  StationPageFrame,
} from './StationShared';

const DEFAULT_EYE: RefractionEye = { sphere: 0, cylinder: 0, axis: null };

function DiopterFields({
  label,
  value,
  onChange,
}: {
  label: string;
  value: RefractionEye;
  onChange: (next: RefractionEye) => void;
}) {
  const needsAxis = Math.abs(value.cylinder) >= 0.25;
  return (
    <fieldset className="va-eye-card">
      <legend>{label}</legend>
      <label>
        Sphere (SPH)
        <input
          type="number"
          step="0.25"
          min={-20}
          max={20}
          value={value.sphere}
          onChange={(event) => onChange({ ...value, sphere: Number(event.target.value) })}
        />
      </label>
      <label>
        Cylinder (CYL)
        <input
          type="number"
          step="0.25"
          min={-10}
          max={10}
          value={value.cylinder}
          onChange={(event) => {
            const cylinder = Number(event.target.value);
            onChange({
              ...value,
              cylinder,
              axis: Math.abs(cylinder) < 0.25 ? null : (value.axis ?? 90),
            });
          }}
        />
      </label>
      <label>
        Axis
        <input
          type="number"
          step="1"
          min={0}
          max={180}
          disabled={!needsAxis}
          value={needsAxis ? (value.axis ?? '') : ''}
          placeholder={needsAxis ? '0–180' : 'N/A'}
          onChange={(event) => onChange({
            ...value,
            axis: event.target.value === '' ? null : Number(event.target.value),
          })}
        />
      </label>
    </fieldset>
  );
}

export default function RefractionStationPage() {
  const { eventId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const [eventName, setEventName] = useState('');
  const [station, setStation] = useState<Station | null>(null);
  const [eventStations, setEventStations] = useState<Station[]>([]);
  const [queue, setQueue] = useState<QueueRegistration[]>([]);
  const [selectedId, setSelectedId] = useState(() => searchParams.get('registrationId') || '');
  const [status, setStatus] = useState<RefractionResultData['measurementStatus']>('COMPLETED');
  const [glasses, setGlasses] = useState<'yes' | 'no' | 'unknown'>('unknown');
  const [od, setOd] = useState<RefractionEye>(DEFAULT_EYE);
  const [os, setOs] = useState<RefractionEye>(DEFAULT_EYE);
  const [notes, setNotes] = useState('');
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

  const wearsDistanceGlasses = glasses === 'unknown' ? null : glasses === 'yes';

  const resultData: RefractionResultData = useMemo(() => {
    if (status === 'COMPLETED') {
      return {
        measurementStatus: 'COMPLETED',
        wearsDistanceGlasses,
        od,
        os,
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      };
    }
    return {
      measurementStatus: status,
      wearsDistanceGlasses,
      notes: notes.trim() || 'Measurement incomplete',
    };
  }, [status, wearsDistanceGlasses, od, os, notes]);

  useEffect(() => {
    setAcknowledged(false);
    setEvaluation(null);
  }, [status, glasses, od, os, notes, selectedId]);

  const load = async () => {
    if (!eventId) return;
    setError(null);
    try {
      const context = await loadStationContext(eventId, 'REFRACTION', 'Refraction', selectedId);
      setEventName(context.eventName);
      setStation(context.station);
      setEventStations(context.stations);
      setQueue(context.queue);
      if (!selectedId && context.nextSelectedId) setSelectedId(context.nextSelectedId);
    } catch (cause) {
      setError(getApiMessage(cause, 'Could not load the Refraction station.'));
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
      const next = await screeningApi.previewRefraction(eventId, station.stationId, resultData);
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
      if (status !== 'COMPLETED' && notes.trim().length < 3) {
        setError('Add a short note explaining why measurement was incomplete.');
        return;
      }
      const preview = evaluation ?? await runPreview();
      if (!preview) return;
      if (preview.isFlagged && !acknowledged) {
        setError('This result is flagged. Review the flag and tick acknowledgement before saving.');
        return;
      }

      const saved = await screeningApi.saveRefraction(eventId, station.stationId, {
        registrationId: selected.registrationId,
        idempotencyKey: newIdempotencyKey(),
        acknowledged: preview.isFlagged ? acknowledged : false,
        resultData,
      });
      setSuccess(
        saved.isFlagged
          ? `Saved with ${saved.overallFlag} flag (${saved.ruleVersion ?? preview.ruleVersion}): ${saved.flagSummary}`
          : `Saved Refraction result (${saved.overallFlag}, ${saved.ruleVersion ?? preview.ruleVersion}).`,
      );
      setSavedRegistrationId(selected.registrationId);
      setEvaluation(null);
      setAcknowledged(false);
      await load();
    } catch (cause) {
      setError(getApiMessage(cause, 'Could not save the Refraction result.'));
    } finally {
      setPending(false);
    }
  };

  const canSave = Boolean(selected && station)
    && !pending
    && !previewPending
    && (!evaluation?.isFlagged || acknowledged);

  return (
    <StationPageFrame
      eventId={eventId}
      title="Refraction"
      eyebrow="Station workflow · Issue #26"
      description="record autorefractor SPH/CYL/Axis, review automatic flags, then acknowledge before save when flagged."
      eventName={eventName}
      instructionsOpen={instructionsOpen}
      onToggleInstructions={() => setInstructionsOpen((open) => !open)}
      instructions={(
        <>
          <p>Ask whether the participant normally wears distance glasses, then run the autorefractor for both eyes. Enter machine readings only — this is a screening input, not a prescription.</p>
          <p>Rule version <code>VSMS-REF-1.0</code> flags SPH outside -6.00 to +5.00 as REFER, |CYL| &gt; 3.00 or ≥2.00 D anisometropia as REVIEW, and incomplete measurements as REVIEW. Flagged results require acknowledgement.</p>
        </>
      )}
      error={error}
      success={success}
      handoff={(
        <StationHandoffLinks
          eventId={eventId}
          currentStationType="REFRACTION"
          registrationId={savedRegistrationId || selectedId}
          stations={eventStations}
        />
      )}
    >
      <ParticipantLookup
        eventId={eventId}
        queue={queue}
        selectedId={selectedId}
        onSelect={setSelectedId}
        selected={selected}
      />

      <form className="detail-panel va-form" onSubmit={(event) => void submit(event)}>
        <h2>Autorefractor result</h2>
        <label>
          Measurement status
          <select value={status} onChange={(event) => setStatus(event.target.value as typeof status)}>
            <option value="COMPLETED">Completed</option>
            <option value="UNABLE_TO_MEASURE">Unable to measure</option>
            <option value="REPEAT_REQUIRED">Repeat required</option>
          </select>
        </label>
        <label>
          Usual distance glasses?
          <select value={glasses} onChange={(event) => setGlasses(event.target.value as typeof glasses)}>
            <option value="unknown">Unknown</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </label>

        {status === 'COMPLETED' && (
          <div className="va-eye-grid">
            <DiopterFields label="Right eye (OD)" value={od} onChange={setOd} />
            <DiopterFields label="Left eye (OS)" value={os} onChange={setOs} />
          </div>
        )}

        <label>
          Notes{status !== 'COMPLETED' ? ' (required)' : ' (optional)'}
          <input
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder={status === 'COMPLETED' ? 'Optional screener note' : 'Why measurement could not be completed'}
          />
        </label>

        <div className="va-flag-actions">
          <button type="button" className="secondary" disabled={!station || previewPending} onClick={() => void runPreview()}>
            {previewPending ? 'Evaluating…' : 'Check automatic flags'}
          </button>
        </div>

        {evaluation && (
          <FlagBanner
            evaluation={evaluation}
            acknowledged={acknowledged}
            onAcknowledgedChange={setAcknowledged}
            stationLabel="Refraction"
          />
        )}

        <button className="primary" type="submit" disabled={!canSave}>
          {pending ? 'Saving…' : evaluation?.isFlagged ? 'Save flagged result' : 'Save Refraction result'}
        </button>
      </form>
    </StationPageFrame>
  );
}
