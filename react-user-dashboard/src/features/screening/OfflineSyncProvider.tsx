import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react';
import { useAuth } from '../../auth/AuthProvider';
import { getStoredSession } from '../../utils/session';
import {
  clearOfflineData,
  downloadOfflineEvent,
  getOfflineSyncStatus,
  listOfflineEventIds,
  OfflineSyncStatus,
  offlineSyncChangeEvent,
  purgeExpiredOfflineData,
  syncOfflineEvent,
} from './offlineSync';

type EventSyncState = OfflineSyncStatus & {
  downloading: boolean;
  syncing: boolean;
  error: string | null;
};

type OfflineSyncContextValue = {
  online: boolean;
  autoSync: boolean;
  setAutoSync: (enabled: boolean) => void;
  statusFor: (eventId: string) => EventSyncState;
  downloadEvent: (eventId: string) => Promise<void>;
  syncEvent: (eventId: string) => Promise<void>;
  clearDeviceData: () => Promise<void>;
  /** Download if missing, or refresh the snapshot when already present. Safe to call repeatedly. */
  ensureOfflineReady: (eventId: string, options?: { refreshIfPresent?: boolean }) => Promise<void>;
};

const EMPTY_STATE: EventSyncState = {
  downloaded: false,
  pending: 0,
  conflicts: 0,
  locked: 0,
  expiresAt: null,
  snapshotBytes: null,
  conflictCodes: [],
  downloading: false,
  syncing: false,
  error: null,
};

const OfflineSyncContext = createContext<OfflineSyncContextValue | undefined>(undefined);
const AUTO_SYNC_KEY = 'vsms_offline_auto_sync';

function storedAutoSync() {
  try { return localStorage.getItem(AUTO_SYNC_KEY) !== 'false'; } catch { return true; }
}

function readableError(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function OfflineSyncProvider({ children }: PropsWithChildren) {
  const { session, isAuthenticated } = useAuth();
  const ownerId = isAuthenticated ? session?.user.id ?? null : null;
  const [online, setOnline] = useState(() => navigator.onLine);
  const [autoSync, setAutoSyncState] = useState(storedAutoSync);
  const [states, setStates] = useState<Record<string, EventSyncState>>({});
  const ensureInFlight = useRef(new Set<string>());
  const syncInFlight = useRef(new Set<string>());

  const setAutoSync = useCallback((enabled: boolean) => {
    setAutoSyncState(enabled);
    try { localStorage.setItem(AUTO_SYNC_KEY, String(enabled)); } catch { /* Manual sync remains available. */ }
  }, []);

  const setEventState = useCallback((eventId: string, update: Partial<EventSyncState>) => {
    setStates((current) => ({
      ...current,
      [eventId]: { ...(current[eventId] ?? EMPTY_STATE), ...update },
    }));
  }, []);

  const refreshEvent = useCallback(async (eventId: string) => {
    if (!ownerId) return;
    const status = await getOfflineSyncStatus(ownerId, eventId);
    setEventState(eventId, { ...status, error: null });
  }, [ownerId, setEventState]);

  const downloadEvent = useCallback(async (eventId: string, options: { quiet?: boolean } = {}) => {
    if (!ownerId) return;
    if (!navigator.onLine) {
      if (!options.quiet) {
        setEventState(eventId, { error: 'Connect to the network before downloading an offline copy.' });
      }
      return;
    }
    if (!options.quiet) setEventState(eventId, { downloading: true, error: null });
    try {
      const status = await downloadOfflineEvent(ownerId, eventId);
      setEventState(eventId, { ...status, error: null });
    } catch (error) {
      if (!options.quiet) {
        setEventState(eventId, { error: readableError(error, 'Could not download the offline copy.') });
      }
    } finally {
      if (!options.quiet) setEventState(eventId, { downloading: false });
    }
  }, [ownerId, setEventState]);

  const syncEvent = useCallback(async (eventId: string) => {
    if (!ownerId || !navigator.onLine || syncInFlight.current.has(eventId)) return;
    syncInFlight.current.add(eventId);
    setEventState(eventId, { syncing: true, error: null });
    try {
      const status = await syncOfflineEvent(ownerId, eventId);
      setEventState(eventId, {
        ...status,
        error: status.expired ? 'Offline access expired. Encrypted unconfirmed work remains locked for supervised recovery.' : null,
      });
    } catch (error) {
      setEventState(eventId, { error: readableError(error, 'Could not sync offline results.') });
    } finally {
      syncInFlight.current.delete(eventId);
      setEventState(eventId, { syncing: false });
    }
  }, [ownerId, setEventState]);

  const clearDeviceData = useCallback(async () => {
    await clearOfflineData();
    setStates({});
  }, []);

  const ensureOfflineReady = useCallback(async (
    eventId: string,
    options: { refreshIfPresent?: boolean } = {},
  ) => {
    if (!ownerId || !navigator.onLine || !eventId) return;
    if (ensureInFlight.current.has(eventId)) return;

    ensureInFlight.current.add(eventId);
    try {
      const status = await getOfflineSyncStatus(ownerId, eventId);
      setEventState(eventId, { ...status, error: null });
      if (status.downloaded && (!options.refreshIfPresent || status.pending > 0 || status.conflicts > 0)) return;
      await downloadEvent(eventId, { quiet: Boolean(status.downloaded && options.refreshIfPresent) });
    } catch (error) {
      setEventState(eventId, { error: readableError(error, 'Could not prepare the offline copy.') });
    } finally {
      ensureInFlight.current.delete(eventId);
    }
  }, [downloadEvent, ownerId, setEventState]);

  useEffect(() => {
    if (!ownerId) {
      setStates({});
      return undefined;
    }

    let active = true;
    const refreshAll = async () => {
      await purgeExpiredOfflineData(ownerId);
      const eventIds = await listOfflineEventIds(ownerId);
      if (!active) return;
      await Promise.all(eventIds.map((eventId) => refreshEvent(eventId)));
    };
    const syncAll = async () => {
      await refreshAll();
      if (!navigator.onLine || !active || !autoSync) return;
      const eventIds = await listOfflineEventIds(ownerId);
      await Promise.all(eventIds.map((eventId) => syncEvent(eventId)));
    };
    const goOnline = () => {
      setOnline(true);
      void syncAll();
    };
    const goOffline = () => setOnline(false);
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void syncAll();
    };
    const onOfflineChange = () => void (autoSync && navigator.onLine ? syncAll() : refreshAll());
    setStates({});
    void syncAll();
    const expiryTimer = window.setInterval(() => {
      const storedSession = getStoredSession();
      if (!storedSession || storedSession.user.id !== ownerId || (session?.expiresAt && session.expiresAt <= Date.now())) return;
      void (autoSync && navigator.onLine ? syncAll() : refreshAll());
    }, 60_000);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    window.addEventListener(offlineSyncChangeEvent, onOfflineChange);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      active = false;
      window.clearInterval(expiryTimer);
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
      window.removeEventListener(offlineSyncChangeEvent, onOfflineChange);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [autoSync, ownerId, refreshEvent, session?.expiresAt, syncEvent]);

  const value = useMemo<OfflineSyncContextValue>(() => ({
    online,
    autoSync,
    setAutoSync,
    statusFor(eventId) {
      return states[eventId] ?? EMPTY_STATE;
    },
    downloadEvent,
    syncEvent,
    clearDeviceData,
    ensureOfflineReady,
  }), [autoSync, clearDeviceData, downloadEvent, ensureOfflineReady, online, setAutoSync, states, syncEvent]);

  return <OfflineSyncContext.Provider value={value}>{children}</OfflineSyncContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useOfflineSync() {
  const context = useContext(OfflineSyncContext);
  if (!context) throw new Error('useOfflineSync must be used within an OfflineSyncProvider');
  return context;
}
