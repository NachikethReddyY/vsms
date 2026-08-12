import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { getApiError as getApiMessage } from '../../utils/apiClient';
import {
  ColourVisionResultData,
  FlagEvaluation,
  newIdempotencyKey,
  QueueJourney,
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

const DEFAULT_PLATES = 11;

export default function ColourVisionStationPage() {
  const { eventId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const [eventName, setEventName] = useState('');
  const [station, setStation] = useState<Station | null>(null);
  const [queue, setQueue] = useState<QueueRegistration[]>([]);
  const [selectedId, setSelectedId] = useState(() => searchParams.get('registrationId') || '');
  const [platesPresented, setPlatesPresented] = useState(DEFAULT_PLATES);
  const [odCorrect, setOdCorrect] = useState(DEFAULT_PLATES);
  const [osCorrect, setOsCorrect] = useState(DEFAULT_PLATES);
  const [evaluation, setEvaluation] = useState<FlagEvaluation | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [previewPending, setPreviewPending] = useState(false);
  const [instructionsOpen, setInstructionsOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [savedRegistrationId, setSavedRegistrationId] = useState<string | null>(null);
  const [savedJourney, setSavedJourney] = useState<QueueJourney | null>(null);
  const [savedOffline, setSavedOffline] = useState(false);

  const selected = useMemo(
    () => queue.find((row) => row.registrationId === selectedId) || null,
    [queue, selectedId],
  );

  const resultData: ColourVisionResultData = useMemo(() => ({
    testKit: 'ISHIHARA',
    platesPresented,
    odCorrect,
    osCorrect,
  }), [platesPresented, odCorrect, osCorrect]);

  useEffect(() => {
    setAcknowledged(false);
    setEvaluation(null);
  }, [platesPresented, odCorrect, osCorrect, selectedId]);

  useEffect(() => {
    setOdCorrect((value) => Math.min(value, platesPresented));
    setOsCorrect((value) => Math.min(value, platesPresented));
  }, [platesPresented]);

  const load = async () => {
    if (!eventId) return;
    setError(null);
    try {
      const context = await loadStationContext(eventId, 'COLOUR_VISION', 'Colour Vision', selectedId);
      setEventName(context.eventName);
      setStation(context.station);
      setQueue(context.queue);
      if (!selectedId && context.nextSelectedId) setSelectedId(context.nextSelectedId);
    } catch (cause) {
      setError(getApiMessage(cause, 'Could not load the Colour Vision station.'));
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
      const next = await screeningApi.previewColourVision(eventId, station.stationId, resultData);
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

      const saved = await screeningApi.saveColourVision(eventId, station.stationId, {
        registrationId: selected.registrationId,
        idempotencyKey: newIdempotencyKey(),
        acknowledged: preview.isFlagged ? acknowledged : false,
        resultData,
      });
      setSuccess(saved.queued
        ? 'Saved offline. It will sync when connected.'
        : saved.isFlagged
          ? `Saved with ${saved.overallFlag} flag (${saved.ruleVersion ?? preview.ruleVersion}): ${saved.flagSummary}`
          : `Saved Colour Vision result (${saved.overallFlag}, ${saved.ruleVersion ?? preview.ruleVersion}).`);
      setSavedRegistrationId(selected.registrationId);
      setSavedJourney(saved.journey || null);
      setSavedOffline(Boolean(saved.queued));
      setEvaluation(null);
      setAcknowledged(false);
      await load();
    } catch (cause) {
      setError(getApiMessage(cause, 'Could not save the Colour Vision result.'));
    } finally {
      setPending(false);
    }
  };

  const canSave = Boolean(selected && station)
    && !pending
    && !previewPending
    && (!evaluation?.isFlagged || acknowledged);
  const passThreshold = Math.max(1, platesPresented - 1);

  return (
    <StationPageFrame
      eventId={eventId}
      title="Colour Vision"
      eyebrow="Station workflow · Issue #26"
      description="record Ishihara plate scores per eye, review automatic flags, then acknowledge before save when flagged."
      eventName={eventName}
      instructionsOpen={instructionsOpen}
      onToggleInstructions={() => setInstructionsOpen((open) => !open)}
      instructions={(
        <>
          <p>Use the physical licensed plate set only. Do not display copyrighted Ishihara artwork in the app. Test right eye, then left eye, and record correct plate counts.</p>
          <p>Rule version <code>VSMS-CV-1.0</code> treats {passThreshold}/{DEFAULT_PLATES} (plates−1) as pass. Equal bilateral fails are REVIEW; one-eye fail or ≥3-plate asymmetry is URGENT. Flagged results require acknowledgement.</p>
        </>
      )}
      error={error}
      success={success}
      handoff={(
        <StationHandoffLinks
          eventId={eventId}
          currentStationType="COLOUR_VISION"
          registrationId={savedRegistrationId || selectedId}
          journey={savedJourney}
          queuedOffline={savedOffline}
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
        <h2>Ishihara plate scores</h2>
        <p>Test kit fixed as <strong>Ishihara</strong>. Pass threshold is <strong>{passThreshold}/{platesPresented}</strong>.</p>
        <label>
          Plates presented
          <input
            type="number"
            min={8}
            max={24}
            step={1}
            value={platesPresented}
            onChange={(event) => setPlatesPresented(Number(event.target.value) || DEFAULT_PLATES)}
          />
        </label>
        <div className="va-eye-grid">
          <label className="va-eye-card">
            Right eye (OD) correct
            <input
              type="number"
              min={0}
              max={platesPresented}
              step={1}
              value={odCorrect}
              onChange={(event) => setOdCorrect(Number(event.target.value))}
            />
          </label>
          <label className="va-eye-card">
            Left eye (OS) correct
            <input
              type="number"
              min={0}
              max={platesPresented}
              step={1}
              value={osCorrect}
              onChange={(event) => setOsCorrect(Number(event.target.value))}
            />
          </label>
        </div>

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
            stationLabel="Colour Vision"
          />
        )}

        <button className="primary" type="submit" disabled={!canSave}>
          {pending ? 'Saving…' : evaluation?.isFlagged ? 'Save flagged result' : 'Save Colour Vision result'}
        </button>
      </form>
    </StationPageFrame>
  );
}
