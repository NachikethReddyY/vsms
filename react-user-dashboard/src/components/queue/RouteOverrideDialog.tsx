import { ArrowDownIcon, ArrowUpIcon } from '@heroicons/react/24/outline';
import { useEffect, useMemo, useState } from 'react';
import { AppDialog } from '../AppDialog';
import { getApiError } from '../../utils/apiClient';
import { queueApi, type RegistrationRouteState, type RouteOverrideReason } from '../../features/queue/queueApi';

const REASONS: Array<{ value: RouteOverrideReason; label: string }> = [
  { value: 'STATION_UNAVAILABLE', label: 'Station unavailable' },
  { value: 'QUEUE_BALANCING', label: 'Queue balancing' },
  { value: 'PARTICIPANT_NEED', label: 'Participant need' },
  { value: 'EQUIPMENT_ISSUE', label: 'Equipment issue' },
  { value: 'OPERATIONAL_EXCEPTION', label: 'Operational exception' },
];

export function RouteOverrideDialog({
  open,
  eventId,
  registrationId,
  fullAccess,
  onOpenChange,
  onCommitted,
}: {
  open: boolean;
  eventId: string;
  registrationId: string | null;
  fullAccess: boolean;
  onOpenChange: (open: boolean) => void;
  onCommitted: () => Promise<void>;
}) {
  const [route, setRoute] = useState<RegistrationRouteState | null>(null);
  const [stationIds, setStationIds] = useState<string[]>([]);
  const [reasonCode, setReasonCode] = useState<RouteOverrideReason>('STATION_UNAVAILABLE');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    if (!registrationId) return;
    setPending(true);
    setError(null);
    try {
      const next = await queueApi.getParticipantRoute(eventId, registrationId);
      setRoute(next);
      setStationIds(next.steps.filter((step) => step.state !== 'COMPLETED').map((step) => step.stationId));
    } catch (cause) {
      setError(getApiError(cause, 'Unable to load this route.'));
    } finally {
      setPending(false);
    }
  };

  useEffect(() => {
    if (open) void load();
    else {
      setRoute(null);
      setStationIds([]);
      setError(null);
    }
    // The dialog reloads only when its identity/open state changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, open, registrationId]);

  const stationById = useMemo(() => new Map(route?.steps.map((step) => [step.stationId, step]) ?? []), [route]);
  const activeStationId = route?.steps.find((step) => step.state === 'CURRENT')?.stationId ?? null;
  const mutableIds = stationIds.filter((stationId) => stationId !== activeStationId);

  const move = (stationId: string, direction: -1 | 1) => {
    const mutableIndex = mutableIds.indexOf(stationId);
    const swapWith = mutableIndex + direction;
    if (mutableIndex < 0 || swapWith < 0 || swapWith >= mutableIds.length) return;
    const nextMutable = [...mutableIds];
    [nextMutable[mutableIndex], nextMutable[swapWith]] = [nextMutable[swapWith], nextMutable[mutableIndex]];
    setStationIds(stationIds.map((id) => id === activeStationId ? id : nextMutable.shift() as string));
  };

  const makeNext = (stationId: string) => {
    const nextMutable = [stationId, ...mutableIds.filter((id) => id !== stationId)];
    setStationIds(stationIds.map((id) => id === activeStationId ? id : nextMutable.shift() as string));
  };

  const save = async () => {
    if (!registrationId || !route) return;
    setPending(true);
    setError(null);
    try {
      await queueApi.replaceParticipantRoute(eventId, registrationId, {
        stationIds,
        reasonCode,
        expectedVersion: route.routeVersion,
      });
      await onCommitted();
      onOpenChange(false);
    } catch (cause) {
      setError(getApiError(cause, 'Unable to update this route. The latest route has been reloaded.'));
      await load();
    } finally {
      setPending(false);
    }
  };

  return <AppDialog
    open={open}
    onOpenChange={onOpenChange}
    title="Change participant route"
    description="Completed and current steps are locked. Clinical review always remains last."
  >
    {error && <p className="mb-3 text-sm text-red-700" role="alert">{error}</p>}
    {!route ? <p role="status">Loading route…</p> : <div className="grid gap-4">
      <ol className="grid gap-2" aria-label="Participant route order">
        {route.steps.filter((step) => step.state === 'COMPLETED').map((step) => (
          <li key={step.stationId} className="flex min-h-11 items-center justify-between rounded-lg border bg-stone-50 px-3 opacity-70">
            <span><strong>{step.stationName}</strong> · completed</span><span>Locked</span>
          </li>
        ))}
        {stationIds.map((stationId) => {
          const step = stationById.get(stationId);
          if (!step) return null;
          const locked = stationId === activeStationId;
          const mutableIndex = mutableIds.indexOf(stationId);
          return <li key={stationId} className="flex min-h-11 items-center justify-between gap-3 rounded-lg border px-3">
            <span><strong>{step.stationName}</strong>{locked ? ' · current' : ''}</span>
            {locked ? <span>Locked</span> : fullAccess ? <span className="flex gap-2">
              <button type="button" className="min-h-11 min-w-11 rounded-lg border" disabled={mutableIndex <= 0} onClick={() => move(stationId, -1)} aria-label={`Move ${step.stationName} earlier`}><ArrowUpIcon className="mx-auto size-4" /></button>
              <button type="button" className="min-h-11 min-w-11 rounded-lg border" disabled={mutableIndex >= mutableIds.length - 1} onClick={() => move(stationId, 1)} aria-label={`Move ${step.stationName} later`}><ArrowDownIcon className="mx-auto size-4" /></button>
            </span> : <button type="button" className="min-h-11 rounded-lg border px-3" disabled={mutableIndex === 0} onClick={() => makeNext(stationId)}>Make next</button>}
          </li>;
        })}
        <li className="flex min-h-11 items-center justify-between rounded-lg border bg-stone-50 px-3"><strong>Clinical review</strong><span>Final · locked</span></li>
      </ol>
      <label className="grid gap-1 text-sm font-semibold">Reason
        <select className="min-h-11 rounded-lg border px-3" value={reasonCode} onChange={(event) => setReasonCode(event.target.value as RouteOverrideReason)}>
          {REASONS.map((reason) => <option key={reason.value} value={reason.value}>{reason.label}</option>)}
        </select>
      </label>
      <div className="flex justify-end gap-2">
        <button type="button" className="secondary min-h-11" disabled={pending} onClick={() => onOpenChange(false)}>Cancel</button>
        <button type="button" className="primary min-h-11" disabled={pending || !route} onClick={() => void save()}>{pending ? 'Saving…' : 'Save route'}</button>
      </div>
    </div>}
  </AppDialog>;
}
