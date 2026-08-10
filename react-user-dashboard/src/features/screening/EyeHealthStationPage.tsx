import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { getApiError as getApiMessage } from '../../utils/apiClient';
import {
  EyeHealthResultData,
  EyeHealthRisk,
  FlagEvaluation,
  newIdempotencyKey,
  QueueRegistration,
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

const EYE_HEALTH_RISKS: { value: EyeHealthRisk; label: string }[] = [
  { value: 'NOT_ASSESSED', label: 'Not assessed' },
  { value: 'NONE', label: 'None' },
  { value: 'SUSPECTED', label: 'Suspected' },
  { value: 'PRESENT', label: 'Present' },
];

export default function EyeHealthStationPage() {
  const { eventId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const [eventName, setEventName] = useState('');
  const [station, setStation] = useState<Station | null>(null);
  const [eventStations, setEventStations] = useState<Station[]>([]);
  const [queue, setQueue] = useState<QueueRegistration[]>([]);
  const [selectedId, setSelectedId] = useState(() => searchParams.get('registrationId') || '');
  const [cataractRisk, setCataractRisk] = useState<EyeHealthRisk>('NOT_ASSESSED');
  const [glaucomaRisk, setGlaucomaRisk] = useState<EyeHealthRisk>('NOT_ASSESSED');
  const [symptomsNoted, setSymptomsNoted] = useState(false);
  const [symptomSummary, setSymptomSummary] = useState('');
  const [observations, setObservations] = useState('');
  const [deviceFindings, setDeviceFindings] = useState('');
  const [evaluation, setEvaluation] = useState<FlagEvaluation | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [previewPending, setPreviewPending] = useState(false);
  const [instructionsOpen, setInstructionsOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [savedRegistrationId, setSavedRegistrationId] = useState<string | null>(null);
  const participantRequestGeneration = useRef(0);

  const selected = useMemo(
    () => queue.find((row) => row.registrationId === selectedId) || null,
    [queue, selectedId],
  );

  const resultData: EyeHealthResultData = useMemo(() => ({
    cataractRisk,
    glaucomaRisk,
    symptomsNoted,
    ...(symptomsNoted && symptomSummary.trim() ? { symptomSummary: symptomSummary.trim() } : {}),
    observations: observations.trim(),
    ...(deviceFindings.trim() ? { deviceFindings: deviceFindings.trim() } : {}),
  }), [cataractRisk, glaucomaRisk, symptomsNoted, symptomSummary, observations, deviceFindings]);

  useEffect(() => {
    setAcknowledged(false);
    setEvaluation(null);
  }, [cataractRisk, glaucomaRisk, symptomsNoted, symptomSummary, observations, deviceFindings]);

  useEffect(() => {
    setCataractRisk('NOT_ASSESSED');
    setGlaucomaRisk('NOT_ASSESSED');
    setSymptomsNoted(false);
    setSymptomSummary('');
    setObservations('');
    setDeviceFindings('');
    setEvaluation(null);
    setAcknowledged(false);
    setError(null);
    setSuccess(null);
    setSavedRegistrationId(null);
  }, [selectedId]);

  const selectParticipant = (registrationId: string) => {
    if (registrationId === selectedId) return;
    participantRequestGeneration.current += 1;
    setPreviewPending(false);
    setPending(false);
    setSelectedId(registrationId);
  };

  const load = async () => {
    if (!eventId) return;
    setError(null);
    try {
      const context = await loadStationContext(eventId, 'EYE_HEALTH', 'Eye Health', selectedId);
      setEventName(context.eventName);
      setStation(context.station);
      setEventStations(context.stations);
      setQueue(context.queue);
      if (!selectedId && context.nextSelectedId) selectParticipant(context.nextSelectedId);
    } catch (cause) {
      setError(getApiMessage(cause, 'Could not load the Eye Health station.'));
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  const runPreview = async () => {
    if (!eventId || !station) return null;
    if (!observations.trim()) {
      setError('Observations are required before checking flags.');
      return null;
    }
    if (symptomsNoted && symptomSummary.trim().length < 3) {
      setError('Symptom summary is required when symptoms are noted.');
      return null;
    }
    setPreviewPending(true);
    setError(null);
    const generation = participantRequestGeneration.current;
    try {
      const next = await screeningApi.previewEyeHealth(eventId, station.stationId, resultData);
      if (generation !== participantRequestGeneration.current) return null;
      setEvaluation(next);
      if (!next.isFlagged) setAcknowledged(false);
      return next;
    } catch (cause) {
      if (generation === participantRequestGeneration.current) {
        setError(getApiMessage(cause, 'Could not evaluate screening flags.'));
      }
      return null;
    } finally {
      if (generation === participantRequestGeneration.current) setPreviewPending(false);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!eventId || !station || !selected) return;
    if (!observations.trim()) {
      setError('Observations are required before saving.');
      return;
    }
    if (symptomsNoted && symptomSummary.trim().length < 3) {
      setError('Symptom summary is required when symptoms are noted.');
      return;
    }
    setPending(true);
    setError(null);
    setSuccess(null);
    const generation = participantRequestGeneration.current;
    const registrationId = selected.registrationId;
    try {
      const preview = evaluation ?? await runPreview();
      if (!preview) return;
      if (generation !== participantRequestGeneration.current) return;
      if (preview.isFlagged && !acknowledged) {
        setError('This result is flagged. Review the flag and tick acknowledgement before saving.');
        return;
      }

      const saved = await screeningApi.saveEyeHealth(eventId, station.stationId, {
        registrationId,
        idempotencyKey: newIdempotencyKey(),
        acknowledged: preview.isFlagged ? acknowledged : false,
        resultData,
      });
      if (generation !== participantRequestGeneration.current) return;
      setSuccess(saved.queued
        ? 'Saved offline. It will sync when connected.'
        : saved.isFlagged
          ? `Saved with ${saved.overallFlag} flag (${saved.ruleVersion ?? preview.ruleVersion}): ${saved.flagSummary}`
          : `Saved Eye Health result (${saved.overallFlag}, ${saved.ruleVersion ?? preview.ruleVersion}).`);
      setSavedRegistrationId(registrationId);
      setEvaluation(null);
      setAcknowledged(false);
      await load();
    } catch (cause) {
      if (generation === participantRequestGeneration.current) {
        setError(getApiMessage(cause, 'Could not save the Eye Health result.'));
      }
    } finally {
      if (generation === participantRequestGeneration.current) setPending(false);
    }
  };

  const canSave = Boolean(selected && station)
    && observations.trim().length >= 1
    && !pending
    && !previewPending
    && (!symptomsNoted || symptomSummary.trim().length >= 3)
    && (!evaluation?.isFlagged || acknowledged);

  return (
    <StationPageFrame
      eventId={eventId}
      title="Eye Health"
      eyebrow="Station workflow · Issue #26"
      description="Record cataract and glaucoma risk, symptoms, and clinical observations, then review automatic flags before save when flagged."
      eventName={eventName}
      instructionsOpen={instructionsOpen}
      onToggleInstructions={() => setInstructionsOpen((open) => !open)}
      instructions={(
        <>
          <p>Record anterior segment, media, and fundus observations from the configured eye-health assessment. Include device findings when tonometry, imaging, or autorefractor notes apply.</p>
          <p>Rule version <code>VSMS-EH-1.0</code> flags <strong>PRESENT</strong> cataract or glaucoma risk as REFER, <strong>SUSPECTED</strong> risk or reported symptoms as REVIEW. Flagged results require acknowledgement.</p>
        </>
      )}
      error={error}
      success={success}
      handoff={(
        <StationHandoffLinks
          eventId={eventId}
          currentStationType="EYE_HEALTH"
          registrationId={savedRegistrationId || selectedId}
          stations={eventStations}
        />
      )}
    >
      <ParticipantLookup
        eventId={eventId}
        queue={queue}
        selectedId={selectedId}
        onSelect={selectParticipant}
        selected={selected}
      />

      <form className="detail-panel va-form" onSubmit={(event) => void submit(event)}>
        <h2>Eye health assessment</h2>
        <div className="va-eye-grid">
          <label className="va-eye-card">
            Cataract risk
            <select value={cataractRisk} onChange={(event) => setCataractRisk(event.target.value as EyeHealthRisk)}>
              {EYE_HEALTH_RISKS.map((risk) => <option key={risk.value} value={risk.value}>{risk.label}</option>)}
            </select>
          </label>
          <label className="va-eye-card">
            Glaucoma risk
            <select value={glaucomaRisk} onChange={(event) => setGlaucomaRisk(event.target.value as EyeHealthRisk)}>
              {EYE_HEALTH_RISKS.map((risk) => <option key={risk.value} value={risk.value}>{risk.label}</option>)}
            </select>
          </label>
        </div>

        <label className="decision-confirm eye-health-symptoms">
          <input type="checkbox" checked={symptomsNoted} onChange={(event) => setSymptomsNoted(event.target.checked)} />
          <span><strong>Symptoms noted</strong><small>Record participant-reported symptoms when present.</small></span>
        </label>

        {symptomsNoted && (
          <label>
            Symptom summary
            <textarea
              required
              minLength={3}
              maxLength={500}
              rows={3}
              value={symptomSummary}
              onChange={(event) => setSymptomSummary(event.target.value)}
              placeholder="Brief symptom description."
            />
          </label>
        )}

        <label>
          Observations
          <textarea
            required
            minLength={1}
            maxLength={2000}
            rows={5}
            value={observations}
            onChange={(event) => setObservations(event.target.value)}
            placeholder="Anterior segment, media, fundus, or other clinical observations."
          />
        </label>

        <label>
          Device findings <em>Optional</em>
          <textarea
            maxLength={2000}
            rows={3}
            value={deviceFindings}
            onChange={(event) => setDeviceFindings(event.target.value)}
            placeholder="Autorefractor notes, tonometry, imaging findings, or similar."
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
            stationLabel="Eye Health"
          />
        )}

        <button className="primary" type="submit" disabled={!canSave}>
          {pending ? 'Saving…' : evaluation?.isFlagged ? 'Save flagged result' : 'Save Eye Health result'}
        </button>
      </form>
    </StationPageFrame>
  );
}
