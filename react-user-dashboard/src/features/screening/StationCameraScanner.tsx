import { LightBulbIcon, VideoCameraIcon } from '@heroicons/react/24/outline';
import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import { AppDialog } from '../../components/AppDialog';
import { startQrScanner, type QrCamera } from './startQrScanner';

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
          { fps: 10, qrboxWidth: 260, qrboxHeight: 260, deviceId: requestedCameraId },
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
      className="w-[min(42.5rem,calc(100vw-2rem))]"
    >
      <div className="grid gap-3">
        <div className="relative aspect-4/3 overflow-hidden rounded-lg border border-[var(--hairline-strong)] bg-[var(--canvas)] dark:bg-[var(--events-canvas-dark,#0b0b0d)] [&_video]:size-full [&_video]:object-cover">
          <div id={scannerId} aria-label="Live camera preview" />
          <div className="pointer-events-none absolute inset-[18%] rounded-lg border-2 border-white/85 shadow-[0_0_0_999px_color-mix(in_srgb,var(--canvas)_35%,transparent)]" aria-hidden="true" />
          {resolving && <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-[color-mix(in_srgb,var(--canvas)_82%,var(--events-canvas-dark,#0b0b0d))] px-3.5 py-2 text-xs whitespace-nowrap text-[var(--ink)]">Loading participant…</div>}
        </div>
        {error && <p className="m-0 text-xs leading-4.5 text-[var(--red)]" role="alert">{error}</p>}
        <div className="flex flex-wrap items-center justify-center gap-2">
          {cameras.length > 1 && <label className="flex min-h-11 items-center gap-2 text-xs font-semibold text-[var(--ink-2)] [&>svg]:size-4.25"><VideoCameraIcon aria-hidden="true" /><span>Camera</span><select className="min-h-11 max-w-[min(20rem,70vw)] rounded-lg border border-[var(--hairline-strong)] bg-[var(--surface)] py-0 pr-8.5 pl-2.75 text-[var(--ink)]" value={activeCameraId} disabled={resolving || switchingCamera} onChange={(event) => void switchCamera(event.target.value)}>{cameras.map((camera, index) => <option key={camera.id} value={camera.id}>{camera.label || `Camera ${index + 1}`}</option>)}</select></label>}
          {!error && torchSupported && (
            <button
              type="button"
              className={`inline-flex min-h-11 cursor-pointer items-center gap-1.75 rounded-lg border px-3.5 text-xs transition-[background,border-color,color,transform] duration-150 active:scale-[.97] [&>svg]:size-3.75 ${torchOn ? 'border-[var(--accent)] bg-[var(--accent-tint)] text-[var(--accent)]' : 'border-[var(--hairline-strong)] bg-[var(--surface)] text-[var(--ink-2)] hover:border-[var(--accent)] hover:text-[var(--accent)]'}`}
              onClick={() => void toggleTorch()}
              aria-pressed={torchOn}
            >
              <LightBulbIcon aria-hidden="true" />
              {torchOn ? 'Torch on' : 'Torch'}
            </button>
          )}
        </div>
        <form className="grid gap-1.5 border-t border-[var(--hairline)] pt-1 [&>label]:text-xs [&>label]:font-semibold [&>label]:text-[var(--ink-2)]" onSubmit={(event) => void submitManual(event)}>
          <label htmlFor={`${scannerId}-manual`}>QR value or registration UUID</label>
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 max-[520px]:grid-cols-1"><input className="min-h-11 min-w-0 rounded-lg border border-[var(--hairline-strong)] bg-[var(--surface)] px-2.75 text-base text-[var(--ink)] outline-0 focus:border-[var(--accent)] focus:shadow-[0_0_0_3px_var(--accent-tint)]" id={`${scannerId}-manual`} data-dialog-autofocus value={manualValue} onChange={(event) => setManualValue(event.target.value)} autoComplete="off" spellCheck="false" placeholder="Paste, type, or scan with a physical reader" /><button className="secondary min-h-11" type="submit" disabled={resolving || !manualValue.trim()}>Load</button></div>
        </form>
        <p className="m-0 text-[0.71875rem] leading-[1.55] text-[var(--muted)]">
          Camera scanning is automatic. A physical reader can type into the field and submit with Enter.
        </p>
        <span className="sr-only" role="status" aria-live="polite">{announcement}</span>
      </div>
    </AppDialog>
  );
}
