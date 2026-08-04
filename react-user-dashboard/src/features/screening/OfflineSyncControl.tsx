import { ArrowDownTrayIcon, ArrowPathIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import { useOfflineSync } from './OfflineSyncProvider';

export function OfflineSyncControl({ eventId }: { eventId: string }) {
  const { online, statusFor, downloadEvent, syncEvent } = useOfflineSync();
  const status = statusFor(eventId);
  const working = status.downloading || status.syncing;
  const hasAttention = status.conflicts > 0;
  const label = status.downloading
    ? 'Downloading'
    : status.syncing
      ? 'Syncing'
      : hasAttention
        ? `${status.conflicts} needs attention`
        : status.pending > 0
          ? `${status.pending} pending`
          : status.downloaded
            ? 'Offline copy'
            : online
              ? 'Download offline'
              : 'Offline unavailable';
  const action = status.downloaded ? () => void syncEvent(eventId) : () => void downloadEvent(eventId);
  const disabled = working || (!status.downloaded && !online);
  const title = status.error
    ?? (hasAttention
      ? 'One or more offline results need staff attention before they can be sent.'
      : status.downloaded
        ? 'Sync downloaded screening data now.'
        : 'Download your assigned station queues for temporary offline use.');

  return (
    <div className={`workspace-sync-control${hasAttention ? ' has-attention' : ''}`}>
      <button
        type="button"
        className="workspace-sync-action"
        onClick={action}
        disabled={disabled}
        aria-busy={working}
        title={title}
      >
        {hasAttention ? <ExclamationTriangleIcon aria-hidden="true" /> : working || status.downloaded ? <ArrowPathIcon aria-hidden="true" /> : <ArrowDownTrayIcon aria-hidden="true" />}
        <span>{label}</span>
      </button>
      <span className="sr-only" aria-live="polite">{status.error ?? label}</span>
    </div>
  );
}
