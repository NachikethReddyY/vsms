import { useEffect } from 'react';
import { ArrowDownTrayIcon, ArrowPathIcon, ExclamationTriangleIcon, TrashIcon } from '@heroicons/react/24/outline';
import { useOfflineSync } from './OfflineSyncProvider';

const QUIET_REFRESH_MS = 5 * 60 * 1000;

export function OfflineSyncControl({ eventId }: { eventId: string }) {
  const { online, autoSync, setAutoSync, statusFor, downloadEvent, syncEvent, clearDeviceData, ensureOfflineReady } = useOfflineSync();
  const status = statusFor(eventId);
  const working = status.downloading || status.syncing;
  const hasAttention = status.conflicts > 0;
  const hasLockedRecovery = status.locked > 0;
  const sizeLabel = status.snapshotBytes
    ? status.snapshotBytes < 1024 * 1024
      ? `${Math.max(1, Math.ceil(status.snapshotBytes / 1024))} KB`
      : `${(status.snapshotBytes / 1024 / 1024).toFixed(1)} MB`
    : null;
  const conflictLabel = status.conflictCodes.length ? ` (${status.conflictCodes.join(', ')})` : '';

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
        ? `${status.conflicts} conflict${status.conflicts === 1 ? '' : 's'} retained`
        : hasLockedRecovery
          ? `${status.locked} locked for recovery`
        : status.pending > 0
          ? `${status.pending} pending`
          : status.downloaded
            ? `Offline ready${sizeLabel ? ` · ${sizeLabel}` : ''}`
            : online
              ? 'Retry offline prep'
              : 'Offline unavailable';
  const action = status.downloaded
    ? () => void syncEvent(eventId)
    : () => void downloadEvent(eventId);
  const disabled = working || (!status.downloaded && !online);
  const title = status.error
    ?? (hasAttention
      ? `Server-rejected saves remain encrypted on this device for supervised recovery${conflictLabel}. They are removed only by the confirmed full-device purge.`
      : hasLockedRecovery
        ? 'Offline access expired. Encrypted unconfirmed work remains locked on this device for supervised recovery.'
      : status.downloaded
        ? `Encrypted offline pack is ready${sizeLabel ? ` (${sizeLabel})` : ''}. Tap to sync pending results now.`
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
            const unconfirmed = status.pending + status.conflicts;
            const detail = unconfirmed > 0 ? ` This will permanently discard ${unconfirmed} unconfirmed save${unconfirmed === 1 ? '' : 's'}, including retained conflicts.` : '';
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
            ?? `Server-rejected saves are retained encrypted for supervised recovery${conflictLabel}. Use the confirmed full-device purge only when a supervisor authorizes deletion.`}
        </p>
      )}
      <span className="sr-only" aria-live="polite">{status.error ?? label}</span>
    </div>
  );
}
