import { useEffect } from 'react';
import { ArrowDownTrayIcon, ArrowPathIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import { useOfflineSync } from './OfflineSyncProvider';

const QUIET_REFRESH_MS = 5 * 60 * 1000;

export function OfflineSyncControl({ eventId }: { eventId: string }) {
  const { online, statusFor, downloadEvent, syncEvent, ensureOfflineReady } = useOfflineSync();
  const status = statusFor(eventId);
  const working = status.downloading || status.syncing;
  const hasAttention = status.conflicts > 0;

  // Prefetch (or refresh) as soon as a screener opens this event while online.
  useEffect(() => {
    if (!eventId || !online) return;
    void ensureOfflineReady(eventId);
  }, [ensureOfflineReady, eventId, online]);

  // Keep the assigned-station snapshot fresh while the tablet stays on this event.
  useEffect(() => {
    if (!eventId || !online) return undefined;
    const timer = window.setInterval(() => {
      if (!navigator.onLine) return;
      void ensureOfflineReady(eventId, { refreshIfPresent: true });
    }, QUIET_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [ensureOfflineReady, eventId, online]);

  const label = status.downloading
    ? 'Preparing offline'
    : status.syncing
      ? 'Syncing'
      : hasAttention
        ? `${status.conflicts} needs attention`
        : status.pending > 0
          ? `${status.pending} pending`
          : status.downloaded
            ? 'Offline ready'
            : online
              ? 'Retry offline prep'
              : 'Offline unavailable';
  const action = status.downloaded
    ? () => void syncEvent(eventId)
    : () => void downloadEvent(eventId);
  const disabled = working || (!status.downloaded && !online);
  const title = status.error
    ?? (hasAttention
      ? 'One or more offline results need staff attention before they can be sent. Open the station, fix the flagged save, then sync again.'
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
      {(status.error || hasAttention) && (
        <p className="workspace-sync-hint" role="status">
          {status.error
            ?? 'Some offline saves conflicted (for example missing acknowledgement or an ended event). Fix on the station form, then sync again.'}
        </p>
      )}
      <span className="sr-only" aria-live="polite">{status.error ?? label}</span>
    </div>
  );
}
