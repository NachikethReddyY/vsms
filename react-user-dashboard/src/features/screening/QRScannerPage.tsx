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
  VideoCameraIcon,
} from '@heroicons/react/24/outline';
import apiClient, { getApiError as getApiMessage } from '../../utils/apiClient';
import { startQrScanner, type QrCamera } from './startQrScanner';
import {
  extractQrToken,
  verifyQrToken,
} from './qrHandoff';
import type { QrVerifyResult } from './qrHandoff';
import { customStationPath, stationPath } from './stationConfig';
import './QRScannerPage.css';

type ScanStatus = 'scanning' | 'verifying' | 'verified';
type ActiveAssignment = { stationId: string; stationName: string; stationType: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Non-standard `torch` constraint used by html5-qrcode for the flashlight. */
type TrackCapabilitiesWithTorch = MediaTrackCapabilities & { advanced?: Array<Record<string, unknown>> };

export default function QRScannerPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [rawInput, setRawInput] = useState(() => searchParams.get('token') || '');
  const [status, setStatus] = useState<ScanStatus>('scanning');
  const [error, setError] = useState<string | null>(null);
  const [verified, setVerified] = useState<QrVerifyResult | null>(null);
  const [lookupOnly, setLookupOnly] = useState(false);
  const [activeAssignment, setActiveAssignment] = useState<ActiveAssignment | null>(null);
  const [lookupEventId, setLookupEventId] = useState('');
  const [lookupRegistrationId, setLookupRegistrationId] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const verificationRef = useRef(false);

  const loadAssignment = useCallback(async (eventId: string, registrationId: string) => {
    const { data } = await apiClient.get<{ activeEntry: { station: ActiveAssignment } | null }>(`/queues/events/${eventId}/participants/${registrationId}`);
    setActiveAssignment(data.activeEntry?.station ?? null);
  }, []);

  const verifyToken = useCallback(async (token: string) => {
    if (verificationRef.current) return;
    verificationRef.current = true;
    setStatus('verifying');
    setError(null);
    setVerified(null);
    setLookupOnly(false);
    setActiveAssignment(null);
    try {
      const result = await verifyQrToken(token);
      await loadAssignment(result.event.id, result.registrationId);
      setRawInput(token);
      setVerified(result);
      setStatus('verified');
    } catch (cause) {
      setError(getApiMessage(cause, 'Could not verify that QR token.'));
      setStatus('scanning');
      throw new Error(getApiMessage(cause, 'Could not verify that QR token.'));
    } finally {
      verificationRef.current = false;
    }
  }, [loadAssignment]);

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

  const goToStation = () => {
    if (!verified || !activeAssignment) return;
    const href = activeAssignment.stationType === 'CUSTOM'
      ? customStationPath(verified.event.id, activeAssignment.stationId, verified.registrationId)
      : stationPath(verified.event.id, activeAssignment.stationType as Parameters<typeof stationPath>[1], verified.registrationId);
    if (href) navigate(href);
  };

  const resetScan = () => {
    setVerified(null);
    setLookupOnly(false);
    setError(null);
    setRawInput('');
    setActiveAssignment(null);
    setStatus('scanning');
    window.requestAnimationFrame(() => inputRef.current?.focus());
  };

  const lookupParticipant = async (event: FormEvent) => {
    event.preventDefault();
    const eventId = lookupEventId.trim();
    const registrationId = lookupRegistrationId.trim();
    if (!UUID.test(eventId) || !UUID.test(registrationId) || verificationRef.current) {
      setError('Enter valid event and registration UUIDs.');
      return;
    }
    verificationRef.current = true;
    setError(null);
    setStatus('verifying');
    try {
      await loadAssignment(eventId, registrationId);
      setVerified({ valid: true, qrId: '', registrationId, participant: { id: '', firstName: 'Participant', lastName: '' }, event: { id: eventId, name: 'Selected event' }, queueNumber: null });
      setLookupOnly(true);
      setStatus('verified');
    } catch (cause) {
      setError(getApiMessage(cause, 'That participant could not be found in this event.'));
      setStatus('scanning');
    } finally {
      verificationRef.current = false;
    }
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
                <span className="qr-verified-badge"><CheckBadgeIcon aria-hidden="true" />{lookupOnly ? 'Participant found' : 'Verified'}</span>
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
                <div><dt>{lookupOnly ? 'Lookup' : 'Pass'}</dt><dd><ShieldCheckIcon aria-hidden="true" />{lookupOnly ? 'Event-scoped' : 'Server-verified'}</dd></div>
              </dl>

              <div className="qr-station-picker">
                <h3>Current route destination</h3>
                {activeAssignment ? <button type="button" className="primary" onClick={goToStation}><span>{activeAssignment.stationName}</span><ArrowRightIcon aria-hidden="true" /></button> : <p role="status">No active station is assigned. Open the event queue to resolve the route; do not send the participant to an arbitrary station.</p>}
              </div>

              <p className="qr-verified-note">
                The assigned station opens pre-loaded with this registration — no re-scan needed.
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
                ref={inputRef}
                autoFocus
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
              </div>
            </form>
          </section>

          <section className="qr-paste-panel">
            <h2>Participant lookup fallback</h2>
            <p>When the participant cannot present the QR, use the event-scoped registration reference. Access is checked by the server.</p>
            <form onSubmit={(event) => void lookupParticipant(event)}>
              <label htmlFor="qr-lookup-event">Event UUID</label>
              <input id="qr-lookup-event" value={lookupEventId} onChange={(event) => setLookupEventId(event.target.value)} autoComplete="off" spellCheck="false" />
              <label htmlFor="qr-lookup-registration">Registration UUID</label>
              <input id="qr-lookup-registration" value={lookupRegistrationId} onChange={(event) => setLookupRegistrationId(event.target.value)} autoComplete="off" spellCheck="false" />
              <button className="secondary" type="submit" disabled={status === 'verifying'}>Find participant</button>
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
            <p className="qr-scan-help-note">
              The same QR is used at every station. Camera access requires HTTPS (or localhost); paste or use a physical reader when unavailable.
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
  const [cameras, setCameras] = useState<QrCamera[]>([]);
  const [activeCameraId, setActiveCameraId] = useState('');
  const [requestedCameraId, setRequestedCameraId] = useState<string>();
  const [announcement, setAnnouncement] = useState('');
  const [retryCount, setRetryCount] = useState(0);
  const [switchingCamera, setSwitchingCamera] = useState(false);
  const scannerRef = useRef<import('html5-qrcode').Html5Qrcode | null>(null);
  const scannerGenerationRef = useRef(0);

  useEffect(() => {
    const generation = scannerGenerationRef.current + 1;
    scannerGenerationRef.current = generation;
    let stopped = false;
    let running = false;
    let decoding = false;
    let scanner: import('html5-qrcode').Html5Qrcode | null = null;

    setCameraError(null);
    setTorchSupported(false);
    setTorchOn(false);
    setAnnouncement(requestedCameraId ? 'Switching camera…' : 'Opening camera…');

    const start = async () => {
      try {
        const { Html5Qrcode } = await import('html5-qrcode');
        if (stopped) return;
        scanner = new Html5Qrcode(scannerId);
        scannerRef.current = scanner;
        const started = await startQrScanner(
          scanner,
          { fps: 10, qrboxWidth: 240, qrboxHeight: 240, deviceId: requestedCameraId },
          async (value) => {
            if (stopped || generation !== scannerGenerationRef.current || decoding) return;
            decoding = true;
            setAnnouncement('QR detected. Verifying pass…');
            try { await scanner?.pause(); } catch { /* ignore */ }
            try {
              await onScanResult(value);
              setAnnouncement('Participant pass verified.');
            } catch {
              // verification failed — keep the camera running for another attempt
              setAnnouncement('QR could not be verified. Camera remains active.');
            }
            if (stopped || generation !== scannerGenerationRef.current) return;
            try { await scanner?.resume(); } catch { /* ignore */ }
            decoding = false;
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
        setCameraError(
          cause instanceof DOMException && cause.name === 'NotAllowedError'
            ? 'Camera access was blocked. Allow camera access in your browser, or use the paste field below.'
            : 'The camera could not be opened. Check that this page is served over HTTPS (or localhost) and try again, or use the paste field below.',
        );
        setAnnouncement('Camera unavailable. Paste the QR value or use a physical reader.');
      }
    };

    void start();

    return () => {
      stopped = true;
      if (scannerGenerationRef.current === generation) scannerGenerationRef.current += 1;
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
  }, [onScanResult, requestedCameraId, scannerId, retryCount]);

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
    <div className="qr-camera">
      <div className="qr-camera-viewport">
        <div id={scannerId} aria-label="Live camera preview" />
        <div className="qr-camera-frame" aria-hidden="true" />

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
        <div className="qr-camera-controls">
        {cameras.length > 1 && <label className="qr-camera-select"><VideoCameraIcon aria-hidden="true" /><span>Camera</span><select value={activeCameraId} disabled={status === 'verifying' || switchingCamera} onChange={(event) => void switchCamera(event.target.value)}>{cameras.map((camera, index) => <option key={camera.id} value={camera.id}>{camera.label || `Camera ${index + 1}`}</option>)}</select></label>}
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
      <span className="sr-only" role="status" aria-live="polite">{announcement}</span>
    </div>
  );
}
