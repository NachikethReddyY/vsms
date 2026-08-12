import { LightBulbIcon, VideoCameraIcon } from '@heroicons/react/24/outline';
import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import { AppDialog } from '../../components/AppDialog';
import { startQrScanner, type QrCamera } from './startQrScanner';
import './StationCameraScanner.css';

/** Non-standard `torch` constraint used by html5-qrcode for the flashlight. */
type TrackCapabilitiesWithTorch = MediaTrackCapabilities & { advanced?: Array<Record<string, unknown>> };

type StationCameraScannerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onScan: (rawValue: string) => Promise<void>;
  title?: string;
  description?: string;
};

/**
 * Tablet camera scan for participant QR passes (html5-qrcode).
 * Same pattern as clinical-review scanner; kept shared for station pages.
 */
export function StationCameraScanner({
  open,
  onOpenChange,
  onScan,
  title = 'Scan participant QR',
  description = 'Hold the participant’s phone QR inside the frame. The pass loads automatically.',
}: StationCameraScannerProps) {
  const scannerId = `station-qr-${useId().replace(/:/g, '')}`;
  const [error, setError] = useState('');
  const [resolving, setResolving] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [cameras, setCameras] = useState<QrCamera[]>([]);
  const [activeCameraId, setActiveCameraId] = useState('');
  const [requestedCameraId, setRequestedCameraId] = useState<string>();
  const [manualValue, setManualValue] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const [retryCount, setRetryCount] = useState(0);
  const [switchingCamera, setSwitchingCamera] = useState(false);
  const scannerRef = useRef<import('html5-qrcode').Html5Qrcode | null>(null);
  const resolvingRef = useRef(false);
  const scannerGenerationRef = useRef(0);

  useEffect(() => {
    if (!open) return;

    const generation = scannerGenerationRef.current + 1;
    scannerGenerationRef.current = generation;
    let stopped = false;
    let running = false;
    let scanner: import('html5-qrcode').Html5Qrcode | null = null;

    const start = async () => {
      setError('');
      setTorchSupported(false);
      setTorchOn(false);
      setAnnouncement(requestedCameraId ? 'Switching camera…' : 'Opening camera…');
      try {
        const { Html5Qrcode } = await import('html5-qrcode');
        if (stopped) return;
        scanner = new Html5Qrcode(scannerId);
        scannerRef.current = scanner;
        const started = await startQrScanner(
          scanner,
          { fps: 16, qrboxWidth: 340, qrboxHeight: 340 },
          async (value) => {
            if (stopped || generation !== scannerGenerationRef.current || resolvingRef.current) return;
            stopped = true;
            resolvingRef.current = true;
            setResolving(true);
            setAnnouncement('QR detected. Loading participant…');
            try {
              if (running) await scanner?.stop();
              running = false;
              await onScan(value);
              setAnnouncement('Participant loaded.');
              onOpenChange(false);
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : 'The QR pass could not be read.');
              setAnnouncement('QR could not be loaded. Scanner restarted.');
              setRetryCount((count) => count + 1);
            } finally {
              resolvingRef.current = false;
              setResolving(false);
            }
          },
          () => {},
        );
        if (stopped || generation !== scannerGenerationRef.current) {
          try { await scanner.stop(); } catch { /* scanner already stopped */ }
          return;
        }
        running = true;
        setCameras(started.cameras);
        setActiveCameraId(started.deviceId ?? '');
        const activeLabel = started.cameras.find((camera) => camera.id === started.deviceId)?.label;
        setAnnouncement(activeLabel ? `${activeLabel} active.` : 'Camera active.');
        try {
          const capabilities = scanner.getRunningTrackCapabilities() as TrackCapabilitiesWithTorch;
          setTorchSupported(Boolean(
            capabilities.advanced?.some((constraint) => 'torch' in constraint),
          ));
        } catch {
          // torch detection is best-effort
        }
      } catch (cause) {
        if (stopped || generation !== scannerGenerationRef.current) return;
        setError(
          cause instanceof DOMException && cause.name === 'NotAllowedError'
            ? 'Camera access was blocked. Allow camera access for this site, then reopen the scanner. Or use "Load pass" to paste the token instead.'
            : 'The camera could not be opened. The scanner needs HTTPS (or localhost) and a connected camera. Use "Load pass" to paste the token instead.',
        );
        setAnnouncement('Camera unavailable. Paste the QR value below or use a physical reader.');
      }
    };

    void start();
    return () => {
      stopped = true;
      if (scannerGenerationRef.current === generation) scannerGenerationRef.current += 1;
      // html5-qrcode's stop() throws synchronously if the scanner is not
      // actually running — guard it so closing the dialog cannot crash.
      if (running && scanner) {
        try {
          void scanner.stop().catch(() => {});
        } catch {
          // scanner is not running — nothing to release
        }
      }
      scannerRef.current = null;
    };
  }, [onOpenChange, onScan, open, requestedCameraId, retryCount, scannerId]);

  const submitManual = async (event: FormEvent) => {
    event.preventDefault();
    const value = manualValue.trim();
    if (!value || resolvingRef.current) return;
    resolvingRef.current = true;
    setResolving(true);
    setError('');
    setAnnouncement('Loading participant from QR value…');
    try {
      await onScan(value);
      setManualValue('');
      setAnnouncement('Participant loaded.');
      onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The QR pass could not be read.');
      setAnnouncement('QR value could not be loaded.');
    } finally {
      resolvingRef.current = false;
      setResolving(false);
    }
  };

  const toggleTorch = async () => {
    const scanner = scannerRef.current;
    if (!scanner || !torchSupported) return;
    const next = !torchOn;
    try {
      await scanner.applyVideoConstraints({ advanced: [{ torch: next }] } as unknown as MediaTrackConstraints);
      setTorchOn(next);
    } catch {
      setTorchSupported(false);
    }
  };

  const switchCamera = async (deviceId: string) => {
    if (!deviceId || deviceId === activeCameraId || switchingCamera) return;
    scannerGenerationRef.current += 1;
    setSwitchingCamera(true);
    setAnnouncement('Switching camera…');
    setTorchOn(false);
    setTorchSupported(false);
    const scanner = scannerRef.current;
    scannerRef.current = null;
    if (scanner) {
      try {
        await scanner.stop();
      } catch {
        // A scanner finishing startup or already stopped has no active track to release.
      }
    }
    setActiveCameraId('');
    setRequestedCameraId(deviceId);
    setSwitchingCamera(false);
  };

  return (
    <AppDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      className="station-scanner-dialog"
    >
      <div className="station-scanner">
        <div className="station-scanner-viewport">
          <div id={scannerId} aria-label="Live camera preview" />
          <div className="station-scanner-frame" aria-hidden="true" />
          {resolving && <div className="station-scanner-status">Loading participant…</div>}
        </div>
        {error && <p className="station-scanner-error" role="alert">{error}</p>}
        <div className="station-scanner-controls">
          {cameras.length > 1 && <label className="station-scanner-camera"><VideoCameraIcon aria-hidden="true" /><span>Camera</span><select value={activeCameraId} disabled={resolving || switchingCamera} onChange={(event) => void switchCamera(event.target.value)}>{cameras.map((camera, index) => <option key={camera.id} value={camera.id}>{camera.label || `Camera ${index + 1}`}</option>)}</select></label>}
          {!error && torchSupported && (
            <button
              type="button"
              className={`station-scanner-torch ${torchOn ? 'is-on' : ''}`}
              onClick={() => void toggleTorch()}
              aria-pressed={torchOn}
            >
              <LightBulbIcon aria-hidden="true" />
              {torchOn ? 'Torch on' : 'Torch'}
            </button>
          )}
        </div>
        <form className="station-scanner-manual" onSubmit={(event) => void submitManual(event)}>
          <label htmlFor={`${scannerId}-manual`}>QR URL or token</label>
          <div><input id={`${scannerId}-manual`} data-dialog-autofocus value={manualValue} onChange={(event) => setManualValue(event.target.value)} autoComplete="off" spellCheck="false" placeholder="Paste, type, or scan with a physical reader" /><button className="secondary" type="submit" disabled={resolving || !manualValue.trim()}>Load</button></div>
        </form>
        <p className="station-scanner-hint">
          Camera scanning is automatic. A physical reader can type into the field and submit with Enter.
        </p>
        <span className="sr-only" role="status" aria-live="polite">{announcement}</span>
      </div>
    </AppDialog>
  );
}
