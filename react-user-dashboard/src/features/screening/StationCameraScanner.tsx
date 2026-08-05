import { useEffect, useId, useState } from 'react';
import { AppDialog } from '../../components/AppDialog';
import './StationCameraScanner.css';

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

  useEffect(() => {
    if (!open) return;

    let stopped = false;
    let running = false;
    let scanner: import('html5-qrcode').Html5Qrcode | null = null;

    const start = async () => {
      setError('');
      try {
        const { Html5Qrcode } = await import('html5-qrcode');
        if (stopped) return;
        scanner = new Html5Qrcode(scannerId);
        await scanner.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 260, height: 260 } },
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
      } catch (cause) {
        setError(
          cause instanceof DOMException && cause.name === 'NotAllowedError'
            ? 'Camera access was blocked. Allow camera access and try again.'
            : 'The camera could not be opened. Use Load pass to paste the token instead.',
        );
      }
    };

    void start();
    return () => {
      stopped = true;
      if (running) void scanner?.stop().catch(() => {});
      setResolving(false);
    };
  }, [onOpenChange, onScan, open, scannerId]);

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
      </div>
    </AppDialog>
  );
}
