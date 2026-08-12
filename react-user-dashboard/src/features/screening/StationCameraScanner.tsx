import { LightBulbIcon } from '@heroicons/react/24/outline';
import { useEffect, useId, useRef, useState } from 'react';
import { AppDialog } from '../../components/AppDialog';
import { startQrScanner } from './startQrScanner';
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
  const scannerRef = useRef<import('html5-qrcode').Html5Qrcode | null>(null);

  useEffect(() => {
    if (!open) return;

    let stopped = false;
    let running = false;
    let scanner: import('html5-qrcode').Html5Qrcode | null = null;

    const start = async () => {
      setError('');
      setTorchSupported(false);
      setTorchOn(false);
      try {
        const { Html5Qrcode } = await import('html5-qrcode');
        if (stopped) return;
        scanner = new Html5Qrcode(scannerId);
        scannerRef.current = scanner;
        await startQrScanner(
          scanner,
          { fps: 10, qrboxWidth: 260, qrboxHeight: 260 },
          async (value) => {
            if (stopped) return;
            stopped = true;
            setResolving(true);
            try {
              if (running) await scanner?.stop();
              running = false;
              await onScan(value);
              onOpenChange(false);
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : 'The QR pass could not be read.');
              stopped = false;
              void start();
            } finally {
              setResolving(false);
            }
          },
          () => {},
        );
        running = true;
        try {
          const capabilities = scanner.getRunningTrackCapabilities() as TrackCapabilitiesWithTorch;
          setTorchSupported(Boolean(
            capabilities.advanced?.some((constraint) => 'torch' in constraint),
          ));
        } catch {
          // torch detection is best-effort
        }
      } catch (cause) {
        setError(
          cause instanceof DOMException && cause.name === 'NotAllowedError'
            ? 'Camera access was blocked. Allow camera access for this site, then reopen the scanner. Or use "Load pass" to paste the token instead.'
            : 'The camera could not be opened. The scanner needs HTTPS (or localhost) and a connected camera. Use "Load pass" to paste the token instead.',
        );
      }
    };

    void start();
    return () => {
      stopped = true;
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
  }, [onOpenChange, onScan, open, scannerId]);

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
        <p className="station-scanner-hint">
          Scanning is automatic. To paste a token instead, close this dialog and use "Load pass".
        </p>
      </div>
    </AppDialog>
  );
}
