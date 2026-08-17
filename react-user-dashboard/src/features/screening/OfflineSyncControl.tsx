import { useEffect } from 'react';
import { ArrowDownTrayIcon, ArrowPathIcon, ExclamationTriangleIcon, TrashIcon } from '@heroicons/react/24/outline';
import { useOfflineSync } from './OfflineSyncProvider';

const QUIET_REFRESH_MS = 5 * 60 * 1000;

export function OfflineSyncControl({ eventId }: { eventId: string }) {
  const { online, autoSync, setAutoSync, statusFor, downloadEvent, syncEvent, discardConflicts, clearDeviceData, ensureOfflineReady } = useOfflineSync();
  const status = statusFor(eventId);
  const working = status.downloading || status.syncing;
  const hasAttention = status.conflicts > 0;
  const hasLockedRecovery = status.locked > 0;

  // Prefetch (or refresh) as soon as a screener opens this event while online.
  useEffect(() => {
    if (!eventId || !online) return;
    void ensureOfflineReady(eventId);
  }, [ensureOfflineReady, eventId, online]);

  // Keep the assigned-station snapshot fresh while the tablet stays on this event.
  useEffect(() => {
    if (!eventId || !online || !status.downloaded) return undefined;
    const timer = window.setInterval(() => {
      if (!navigator.onLine) return;
      void ensureOfflineReady(eventId, { refreshIfPresent: true });
    }, QUIET_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [ensureOfflineReady, eventId, online, status.downloaded]);

  const label = status.downloading
    ? 'Preparing offline'
    : status.syncing
      ? 'Syncing'
      : hasAttention
        ? `${status.conflicts} needs attention`
        : hasLockedRecovery
          ? `${status.locked} locked for recovery`
        : status.pending > 0
          ? `${status.pending} pending`
          : status.downloaded
            ? 'Offline ready'
            : online
              ? 'Retry offline prep'
              : 'Offline unavailable';
  const action = hasAttention
    ? () => {
      if (window.confirm('Discard the rejected offline saves from this device? Re-enter any result that still needs to be recorded.')) {
        void discardConflicts(eventId);
      }
    }
    : status.downloaded
      ? () => void syncEvent(eventId)
      : () => void downloadEvent(eventId);
  const disabled = working || (!status.downloaded && !online);
  const title = status.error
    ?? (hasAttention
      ? 'The server rejected one or more offline saves. Tap to discard those rejected copies, then re-enter any result that is still required.'
      : hasLockedRecovery
        ? 'Offline access expired. Encrypted unconfirmed work remains locked on this device for supervised recovery.'
      : status.downloaded
        ? 'Offline pack is ready. Tap to sync pending results now.'
        : 'Assigned station queues download automatically while you are online. Tap to retry if preparation failed.');

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
      {status.downloaded && (
        <button
          type="button"
          className="workspace-sync-action"
          onClick={() => setAutoSync(!autoSync)}
          disabled={working}
          title={autoSync ? 'Switch to manual end-of-event sync' : 'Sync automatically whenever connectivity is available'}
          aria-pressed={autoSync}
        >
          <ArrowPathIcon aria-hidden="true" />
          <span>{autoSync ? 'Auto-sync on' : 'Manual sync'}</span>
        </button>
      )}
      {status.downloaded && (
        <button
          type="button"
          className="workspace-sync-action"
          onClick={() => {
            const detail = status.pending > 0 ? ` This will permanently discard ${status.pending} pending save${status.pending === 1 ? '' : 's'}.` : '';
            if (window.confirm(`Clear all encrypted offline data from this device?${detail}`)) void clearDeviceData();
          }}
          disabled={working}
          title="Clear all offline event downloads and saved results from this device"
          aria-label="Clear all offline data"
        >
          <TrashIcon aria-hidden="true" />
          <span>Clear offline data</span>
        </button>
      )}
      {(status.error || hasAttention) && (
        <p className="workspace-sync-hint" role="status">
          {status.error
            ?? 'Some offline saves were rejected. Tap the warning to discard them, then re-enter any result that is still required.'}
        </p>
      )}
      <span className="sr-only" aria-live="polite">{status.error ?? label}</span>
    </div>
  );
}
