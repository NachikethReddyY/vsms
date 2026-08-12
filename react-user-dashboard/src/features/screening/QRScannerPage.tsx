import { FormEvent, useCallback, useEffect, useId, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowPathIcon,
  ArrowRightIcon,
  CameraIcon,
  CheckBadgeIcon,
  ExclamationTriangleIcon,
  LightBulbIcon,
  QrCodeIcon,
  ShieldCheckIcon,
} from '@heroicons/react/24/outline';
import { getApiError as getApiMessage } from '../../utils/apiClient';
import { startQrScanner } from './startQrScanner';
import {
  DEFAULT_HANDOFF_STATION,
  extractQrToken,
  HANDOFF_STATION_OPTIONS,
  stationHandoffUrl,
  STATION_LABEL,
  verifyQrToken,
} from './qrHandoff';
import type { QrVerifyResult } from './qrHandoff';
import type { StationType } from './screeningApi';
import './QRScannerPage.css';

/**
 * Seeded demonstration pass from backend/prisma/seed.js (`DEMO_QR_TOKEN`).
 * `VSMS-DEMO-QR-001` was never a real token and always failed verification.
 */
const DEMO_QR_TOKEN = 'ab'.repeat(32);

type ScanStatus = 'scanning' | 'verifying' | 'verified';

/** Non-standard `torch` constraint used by html5-qrcode for the flashlight. */
type TrackCapabilitiesWithTorch = MediaTrackCapabilities & { advanced?: Array<Record<string, unknown>> };

export default function QRScannerPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [rawInput, setRawInput] = useState(() => searchParams.get('token') || '');
  const [status, setStatus] = useState<ScanStatus>('scanning');
  const [error, setError] = useState<string | null>(null);
  const [verified, setVerified] = useState<QrVerifyResult | null>(null);

  const verifyToken = useCallback(async (token: string) => {
    setStatus('verifying');
    setError(null);
    setVerified(null);
    try {
      const result = await verifyQrToken(token);
      setRawInput(token);
      setVerified(result);
      setStatus('verified');
    } catch (cause) {
      setError(getApiMessage(cause, 'Could not verify that QR token.'));
      setStatus('scanning');
      throw new Error(getApiMessage(cause, 'Could not verify that QR token.'));
    }
  }, []);

  const onCameraScan = useCallback(async (raw: string) => {
    const token = extractQrToken(raw);
    if (!token) throw new Error('No QR token found in the scan.');
    await verifyToken(token);
  }, [verifyToken]);

  const runVerify = useCallback(async (source: string) => {
    const token = extractQrToken(source);
    if (!token) {
      setError('Paste a QR URL or token first.');
      return;
    }
    try {
      await verifyToken(token);
    } catch {
      // message already surfaced by verifyToken
    }
  }, [verifyToken]);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void runVerify(rawInput);
  };

  const goToStation = (type: StationType) => {
    if (!verified) return;
    const href = stationHandoffUrl(verified.event.id, verified.registrationId, type);
    if (href) navigate(href);
  };

  const resetScan = () => {
    setVerified(null);
    setError(null);
    setRawInput('');
    setStatus('scanning');
  };

  return (
    <div className="page-frame qr-scan-page">
      <header className="page-heading qr-scan-heading">
        <div>
          <p className="eyebrow">Staff screening</p>
          <h1>Scan participant QR</h1>
          <p>
            Point the camera at the participant's pass, or paste its QR value below. The pass is
            resolved on the server — the QR itself never contains personal or clinical data.
          </p>
        </div>
        <div className="action-cluster">
          <Link className="secondary" to="/events">Back to events</Link>
        </div>
      </header>

      {error && (
        <div className="qr-scan-alert" role="alert">
          <ExclamationTriangleIcon aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      <div className="qr-scan-layout">
        <section className="qr-scan-main" aria-live="polite">
          {status === 'verified' && verified ? (
            <div className="qr-verified">
              <div className="qr-verified-head">
                <span className="qr-verified-badge"><CheckBadgeIcon aria-hidden="true" />Verified</span>
                <button type="button" className="qr-scan-again" onClick={resetScan}>
                  <ArrowPathIcon aria-hidden="true" />Scan next
                </button>
              </div>

              <div className="qr-verified-identity">
                <span className="qr-verified-avatar">
                  {`${verified.participant.firstName.charAt(0)}${verified.participant.lastName.charAt(0)}`.toUpperCase()}
                </span>
                <div>
                  <h2>{verified.participant.firstName} {verified.participant.lastName}</h2>
                  <p>{verified.event.name}</p>
                </div>
              </div>

              <dl className="qr-verified-facts">
                <div><dt>Queue</dt><dd>{verified.queueNumber != null ? `#${verified.queueNumber}` : '—'}</dd></div>
                <div><dt>Registration</dt><dd className="qr-mono">{verified.registrationId.slice(0, 8)}…</dd></div>
                <div><dt>Pass</dt><dd><ShieldCheckIcon aria-hidden="true" />Server-verified</dd></div>
              </dl>

            <div className="qr-station-picker">
                <h3>Open station with this participant</h3>
                <div className="qr-station-grid">
                  {HANDOFF_STATION_OPTIONS.map((type) => (
                    <button
                      key={type}
                      type="button"
                      className={type === DEFAULT_HANDOFF_STATION ? 'primary' : 'secondary'}
                      onClick={() => goToStation(type)}
                    >
                      <span>{STATION_LABEL[type]}</span>
                      <ArrowRightIcon aria-hidden="true" />
                    </button>
                  ))}
                </div>
              </div>

              <p className="qr-verified-note">
                The station opens pre-loaded with this registration — no re-scan needed.
              </p>
            </div>
          ) : (
            <CameraScanPanel
              status={status === 'verified' ? 'scanning' : status}
              onScanResult={onCameraScan}
            />
          )}
        </section>

        <aside className="qr-scan-side">
          <section className="qr-paste-panel">
            <h2>Paste a QR value</h2>
            <p>If the camera is unavailable, type or paste the token (or the full pass URL) here.</p>
            <form onSubmit={onSubmit}>
              <label htmlFor="qr-scan-input">QR URL or token</label>
              <input
                id="qr-scan-input"
                value={rawInput}
                onChange={(event) => setRawInput(event.target.value)}
                placeholder="…/participant-status/&lt;token&gt; or 64-hex token"
                autoComplete="off"
                spellCheck="false"
              />
              <div className="action-cluster">
                <button type="submit" className="primary" disabled={status === 'verifying'}>
                  {status === 'verifying' ? 'Verifying…' : 'Verify'}
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={status === 'verifying'}
                  onClick={() => void runVerify(DEMO_QR_TOKEN)}
                >
                  Use seeded demo pass
                </button>
              </div>
            </form>
          </section>

          <section className="qr-scan-help">
            <h2>About the QR codes</h2>
            <div className="qr-scan-help-row">
              <QrCodeIcon aria-hidden="true" />
              <div>
                <strong>Participant pass</strong>
                <p>A single QR per registration containing only a random 64-char token. No name, no
                clinical data — the server resolves identity when staff scan it.</p>
              </div>
            </div>
            <div className="qr-scan-help-row">
              <QrCodeIcon aria-hidden="true" />
              <div>
                <strong>Screener handoff</strong>
                <p>Participants can show a per-station QR that encodes just the event and
                registration. Scanning it opens that station with the record pre-loaded.</p>
              </div>
            </div>
            <p className="qr-scan-help-note">
              Camera access requires HTTPS (or localhost). Use the paste fallback on any device.
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}

function CameraScanPanel({
  status,
  onScanResult,
}: {
  status: Extract<ScanStatus, 'scanning' | 'verifying'>;
  onScanResult: (raw: string) => Promise<void>;
}) {
  const scannerId = `qr-scanner-${useId().replace(/:/g, '')}`;
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const scannerRef = useRef<import('html5-qrcode').Html5Qrcode | null>(null);

  useEffect(() => {
    let stopped = false;
    let running = false;
    let decoding = false;
    let scanner: import('html5-qrcode').Html5Qrcode | null = null;

    setCameraError(null);
    setTorchSupported(false);
    setTorchOn(false);

    const start = async () => {
      try {
        const { Html5Qrcode } = await import('html5-qrcode');
        if (stopped) return;
        scanner = new Html5Qrcode(scannerId);
        scannerRef.current = scanner;
        await startQrScanner(
          scanner,
          { fps: 10, qrboxWidth: 240, qrboxHeight: 240 },
          async (value) => {
            if (stopped || decoding) return;
            decoding = true;
            try { await scanner?.pause(); } catch { /* ignore */ }
            try {
              await onScanResult(value);
            } catch {
              // verification failed — keep the camera running for another attempt
            }
            if (stopped) return;
            try { await scanner?.resume(); } catch { /* ignore */ }
            decoding = false;
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
        setCameraError(
          cause instanceof DOMException && cause.name === 'NotAllowedError'
            ? 'Camera access was blocked. Allow camera access in your browser, or use the paste field below.'
            : 'The camera could not be opened. Check that this page is served over HTTPS (or localhost) and try again, or use the paste field below.',
        );
      }
    };

    void start();

    return () => {
      stopped = true;
      // html5-qrcode's stop() throws synchronously if the scanner never
      // started (e.g. camera permission denied) — guard it so an unmount
      // cannot crash the page.
      if (scanner && running) {
        try {
          void scanner.stop().catch(() => {});
        } catch {
          // scanner is not running — nothing to release
        }
      }
      scannerRef.current = null;
    };
  }, [onScanResult, scannerId, retryCount]);

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
    <div className="qr-camera">
      <div className="qr-camera-viewport">
        <div id={scannerId} aria-label="Live camera preview" />
        <div className="qr-camera-frame" aria-hidden="true">
          <span className="qr-corner qr-corner-tl" />
          <span className="qr-corner qr-corner-tr" />
          <span className="qr-corner qr-corner-bl" />
          <span className="qr-corner qr-corner-br" />
        </div>

        {cameraError ? (
          <div className="qr-camera-error">
            <ExclamationTriangleIcon aria-hidden="true" />
            <p>{cameraError}</p>
            <button
              type="button"
              className="secondary"
              onClick={() => setRetryCount((count) => count + 1)}
            >
              <ArrowPathIcon aria-hidden="true" />Try camera again
            </button>
          </div>
        ) : (
          <div className={`qr-camera-status ${status === 'verifying' ? 'is-verifying' : ''}`}>
            {status === 'verifying' ? (
              <><ArrowPathIcon className="qr-spin" aria-hidden="true" />Verifying pass…</>
            ) : (
              <><CameraIcon aria-hidden="true" />Hold the QR inside the frame</>
            )}
          </div>
        )}
      </div>

      <div className="qr-camera-toolbar">
        <p className="qr-camera-hint">
          The code is scanned and verified automatically when it enters the frame.
        </p>
        {!cameraError && torchSupported && (
          <button
            type="button"
            className={`qr-torch ${torchOn ? 'is-on' : ''}`}
            onClick={() => void toggleTorch()}
            aria-pressed={torchOn}
          >
            <LightBulbIcon aria-hidden="true" />{torchOn ? 'Torch on' : 'Torch'}
          </button>
        )}
      </div>
    </div>
  );
}
