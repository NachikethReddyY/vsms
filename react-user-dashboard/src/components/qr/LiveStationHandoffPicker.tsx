import './LiveStationHandoffPicker.css';

export type LiveStationHandoffStation = {
  stationId: string;
  stationName: string;
  stationType: string;
  stationOrder: number;
  status: 'AVAILABLE' | 'BUSY' | 'PAUSED' | 'OFFLINE';
  activeQueueCount: number;
  capacity: number;
  occupancyPercent: number;
  selectable: boolean;
};

type Props = {
  stations: LiveStationHandoffStation[];
  onSelect: (station: LiveStationHandoffStation) => void;
  pendingStationId?: string | null;
  actionLabel?: string;
  emptyMessage?: string;
  className?: string;
};

const displayStatus = (value: string) => value.charAt(0) + value.slice(1).toLowerCase();

const loadTone = (percent: number) => {
  if (percent >= 85) return 'high';
  if (percent >= 55) return 'medium';
  return 'low';
};

export function LiveStationHandoffPicker({
  stations,
  onSelect,
  pendingStationId = null,
  actionLabel = 'Assign here',
  emptyMessage = 'No stations are available for this event.',
  className = '',
}: Props) {
  const orderedStations = [...stations].sort((left, right) => left.stationOrder - right.stationOrder || left.stationName.localeCompare(right.stationName));

  if (!orderedStations.length) return <p className="live-station-handoff-empty">{emptyMessage}</p>;

  return (
    <div className={`live-station-handoff ${className}`.trim()} aria-label="Live station handoff options">
      {orderedStations.map((station) => {
        const percent = Math.max(0, Math.round(station.occupancyPercent));
        const tone = loadTone(percent);
        const isPending = pendingStationId === station.stationId;
        return (
          <button
            key={station.stationId}
            className={`live-station-handoff-card is-${tone} is-${station.status.toLowerCase()}`}
            type="button"
            disabled={!station.selectable || pendingStationId !== null}
            onClick={() => onSelect(station)}
          >
            <span className="live-station-handoff-topline">
              <span className="live-station-handoff-order">{station.stationOrder}</span>
              <span className="live-station-handoff-name"><strong>{station.stationName}</strong><small>{station.stationType.replace(/_/g, ' ')}</small></span>
              <span className="live-station-handoff-status">{displayStatus(station.status)}</span>
            </span>
            <span className="live-station-handoff-load">
              <span><strong>{percent}%</strong> full</span>
              <small>{station.activeQueueCount} active / {station.capacity} capacity</small>
            </span>
            <span className="live-station-handoff-track" aria-hidden="true"><span style={{ width: `${Math.min(percent, 100)}%` }} /></span>
            <span className="live-station-handoff-action">{isPending ? 'Assigning...' : station.selectable ? actionLabel : 'Unavailable'}</span>
          </button>
        );
      })}
    </div>
  );
}
