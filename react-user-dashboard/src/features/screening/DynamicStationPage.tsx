import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { getApiError as getApiMessage } from '../../utils/apiClient';
import { getStoredSession } from '../../utils/session';
import type { DynamicFieldValues } from './fieldSchema';
import { defaultValueForField, validateFieldValues } from './fieldSchema';
import { getOfflineStationContext, isNetworkError } from './offlineSync';
import { screeningApi, newIdempotencyKey, type FlagEvaluation, type QueueRegistration, type Station, type StationType } from './screeningApi';
import { StationFieldRenderer } from './StationFieldRenderer';
import { FlagBanner, ParticipantLookup, RouteProgressionNotice, StationPageFrame } from './StationShared';
import { STATION_LABEL } from './stationConfig';

const SCHEMA_DRIVEN_TYPES = new Set<StationType>(['CUSTOM', 'VISUAL_ACUITY', 'REFRACTION', 'COLOUR_VISION']);

export default function DynamicStationPage({ stationType }: { stationType?: StationType } = {}) {
  const { eventId = '', stationId: routeStationId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const [eventName, setEventName] = useState('');
  const [station, setStation] = useState<Station | null>(null);
  const [queue, setQueue] = useState<QueueRegistration[]>([]);
  const [selectedId, setSelectedId] = useState(() => searchParams.get('registrationId') || '');
  const [values, setValues] = useState<DynamicFieldValues>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [evaluation, setEvaluation] = useState<FlagEvaluation | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [previewPending, setPreviewPending] = useState(false);
  const [pending, setPending] = useState(false);
  const [instructionsOpen, setInstructionsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const participantRequestGeneration = useRef(0);

  const selected = useMemo(() => queue.find((row) => row.registrationId === selectedId) || null, [queue, selectedId]);
  const fieldSchema = station?.fieldSchemaSnapshot ?? [];
  const resolvedType = station?.stationType || stationType || 'CUSTOM';

  const selectParticipant = (registrationId: string) => {
    if (registrationId === selectedId) return;
    participantRequestGeneration.current += 1;
    setSelectedId(registrationId);
  };

  const pickStation = (stations: Station[]) => {
    if (routeStationId) {
      return stations.find((item) => (
        item.stationId === routeStationId
        && SCHEMA_DRIVEN_TYPES.has(item.stationType)
      )) || null;
    }
    if (stationType) {
      return stations.find((item) => item.stationType === stationType && item.isActive) || null;
    }
    return null;
  };

  const load = async () => {
    if (!eventId) return;
    setError(null);
    try {
      const payload = await screeningApi.listStations(eventId);
      const selectedStation = pickStation(payload.stations);
      if (!selectedStation) {
        throw new Error(stationType
          ? `This ${STATION_LABEL[stationType] || 'station'} is not assigned to your active shift.`
          : 'This station is not assigned to your active shift.');
      }
      if (!selectedStation.fieldSchemaSnapshot?.length) {
        throw new Error('This station does not have a field schema snapshot.');
      }
      const queuePayload = await screeningApi.listQueue(eventId, selectedStation.stationId);
      setEventName(payload.event.name);
      setStation(selectedStation);
      setQueue(queuePayload.registrations);
      if (!selectedId && queuePayload.registrations[0]) selectParticipant(queuePayload.registrations[0].registrationId);
    } catch (cause) {
      if (isNetworkError(cause)) {
        const ownerId = getStoredSession()?.user.id;
        const offlineType = stationType || 'CUSTOM';
        const offline = ownerId
          ? await getOfflineStationContext(ownerId, eventId, offlineType, routeStationId || undefined)
          : null;
        if (offline) {
          setEventName(offline.eventName);
          setStation(offline.station);
          setQueue(offline.queue);
          if (!selectedId && offline.queue[0]) selectParticipant(offline.queue[0].registrationId);
          return;
        }
      }
      setError(getApiMessage(cause, 'Could not load this station.'));
    }
  };

  useEffect(() => { void load(); }, [eventId, routeStationId, stationType]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const defaults: DynamicFieldValues = {};
    for (const field of (station?.fieldSchemaSnapshot ?? [])) {
      defaults[field.key] = defaultValueForField(field);
    }
    setValues(defaults);
    setFieldErrors({});
    setEvaluation(null);
    setAcknowledged(false);
    setError(null);
    setSuccess(null);
  }, [selectedId, station?.stationId, station?.schemaVersion]);

  const updateValue = (key: string, value: unknown) => {
    setValues((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    setEvaluation(null);
    setAcknowledged(false);
  };

  const validate = () => {
    const next = validateFieldValues(fieldSchema, values);
    if (resolvedType === 'REFRACTION' && values.measurementStatus === 'COMPLETED') {
      if (!values.od) next.od = 'Right eye refraction is required.';
      if (!values.os) next.os = 'Left eye refraction is required.';
    }
    if (
      resolvedType === 'REFRACTION'
      && values.measurementStatus !== 'COMPLETED'
      && (!values.notes || String(values.notes).trim().length < 3)
    ) {
      next.notes = 'Add notes when measurement is incomplete.';
    }
    setFieldErrors(next);
    if (Object.keys(next).length) setError('Complete the required station fields.');
    return Object.keys(next).length === 0;
  };

  const runPreview = async () => {
    if (!eventId || !station || !validate()) return null;
    setPreviewPending(true);
    setError(null);
    const generation = participantRequestGeneration.current;
    try {
      const next = await screeningApi.previewDynamic(eventId, station.stationId, values, resolvedType);
      if (generation !== participantRequestGeneration.current) return null;
      setEvaluation(next);
      if (!next.isFlagged) setAcknowledged(false);
      return next;
    } catch (cause) {
      if (generation === participantRequestGeneration.current) setError(getApiMessage(cause, 'Could not evaluate this station result.'));
      return null;
    } finally {
      if (generation === participantRequestGeneration.current) setPreviewPending(false);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!eventId || !station || !selected || !validate()) return;
    setPending(true);
    setError(null);
    setSuccess(null);
    const generation = participantRequestGeneration.current;
    try {
      const preview = evaluation ?? await runPreview();
      if (!preview || generation !== participantRequestGeneration.current) return;
      if (preview.isFlagged && !acknowledged) {
        setError('Review and acknowledge the flag before saving.');
        return;
      }
      const saved = await screeningApi.saveDynamic(eventId, station.stationId, {
        registrationId: selected.registrationId,
        idempotencyKey: newIdempotencyKey(),
        acknowledged: preview.isFlagged ? acknowledged : false,
        resultData: values,
      }, resolvedType);
      if (generation !== participantRequestGeneration.current) return;
      setSuccess(saved.syncState === 'PENDING_SYNC'
        ? 'Pending sync. The participant has not entered the next queue.'
        : `Saved ${station.stationName} result (${saved.overallFlag}).`);
      setEvaluation(null);
      setAcknowledged(false);
      await load();
    } catch (cause) {
      if (generation === participantRequestGeneration.current) setError(getApiMessage(cause, 'Could not save this station result.'));
    } finally {
      if (generation === participantRequestGeneration.current) setPending(false);
    }
  };

  return <StationPageFrame
    eventId={eventId}
    title={station?.stationName || STATION_LABEL[resolvedType] || 'Station'}
    eyebrow={`Dynamic station${station?.schemaVersion ? ` · Schema v${station.schemaVersion}` : ''}`}
    description="Record the configured screening fields and save the result."
    eventName={eventName}
    instructionsOpen={instructionsOpen}
    onToggleInstructions={() => setInstructionsOpen((open) => !open)}
    instructions={<p>Complete all required fields marked with an asterisk. This template uses the field schema captured when it was added to the event.</p>}
    error={error}
    success={success}
    handoff={<RouteProgressionNotice eventId={eventId} queued={Boolean(success?.startsWith('Pending sync'))} />}
  >
    <ParticipantLookup eventId={eventId} currentStationId={station?.stationId ?? ''} queue={queue} selectedId={selectedId} onSelect={selectParticipant} selected={selected} />
    <form className="detail-panel va-form" onSubmit={(event) => void submit(event)} noValidate>
      <h2>{station?.stationName || 'Station assessment'}</h2>
      {!fieldSchema.length ? <p className="form-error" role="alert">This station does not have a field schema.</p> : <StationFieldRenderer fieldSchema={fieldSchema} values={values} onChange={updateValue} errors={fieldErrors} disabled={pending} />}
      <div className="va-flag-actions"><button type="button" className="secondary" disabled={!selected || !fieldSchema.length || previewPending} onClick={() => void runPreview()}>{previewPending ? 'Evaluating…' : 'Check result'}</button></div>
      {evaluation && <FlagBanner evaluation={evaluation} acknowledged={acknowledged} onAcknowledgedChange={setAcknowledged} stationLabel={station?.stationName || 'station'} />}
      <button className="primary" type="submit" disabled={!selected || !fieldSchema.length || pending || previewPending || (evaluation?.isFlagged && !acknowledged)}>{pending ? 'Saving…' : 'Save station result'}</button>
    </form>
  </StationPageFrame>;
}
