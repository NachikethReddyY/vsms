import { FormEvent, useCallback, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { getApiError as getApiMessage } from '../../utils/apiClient';
import {
  DEFAULT_HANDOFF_STATION,
  extractQrToken,
  HANDOFF_STATION_OPTIONS,
  QrVerifyResult,
  stationHandoffUrl,
  STATION_LABEL,
  verifyQrToken,
} from './qrHandoff';
import type { StationType } from './screeningApi';
import { StationCameraScanner } from './StationCameraScanner';
import './QRScannerPage.css';

const DEMO_TOKEN = 'VSMS-DEMO-QR-001';

export default function QRScannerPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [rawInput, setRawInput] = useState(() => searchParams.get('token') || DEMO_TOKEN);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verified, setVerified] = useState<QrVerifyResult | null>(null);
  const [stationType, setStationType] = useState<StationType>(DEFAULT_HANDOFF_STATION);
  const [scannerOpen, setScannerOpen] = useState(false);

  const handoffHref = useMemo(() => {
    if (!verified) return null;
    return stationHandoffUrl(verified.event.id, verified.registrationId, stationType);
  }, [verified, stationType]);

  const runVerify = async (source: string) => {
    const token = extractQrToken(source);
    if (!token) {
      setError('Paste a QR URL or token first.');
      return;
    }
    setPending(true);
    setError(null);
    setVerified(null);
    try {
      const result = await verifyQrToken(token);
      setVerified(result);
    } catch (cause) {
      setError(getApiMessage(cause, 'Could not verify that QR token.'));
    } finally {
      setPending(false);
    }
  };

  const onCameraScan = useCallback(async (raw: string) => {
    const token = extractQrToken(raw);
    if (!token) throw new Error('No QR token found in the scan.');
    setRawInput(token);
    setPending(true);
    setError(null);
    setVerified(null);
    try {
      const result = await verifyQrToken(token);
      setVerified(result);
    } catch (cause) {
      const message = getApiMessage(cause, 'Could not verify that QR token.');
      setError(message);
      throw new Error(message);
    } finally {
      setPending(false);
    }
  }, []);

  const goToStation = (type: StationType = stationType) => {
    if (!verified) return;
    const href = stationHandoffUrl(verified.event.id, verified.registrationId, type);
    if (href) navigate(href);
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void runVerify(rawInput);
  };

  return (
    <div className="page-frame narrow qr-scanner-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Staff screening</p>
          <h1>Scan participant QR</h1>
          <p>
            Verify the pass token, then open a station with <code>registrationId</code> in the URL.
            Station id is never in the QR.
          </p>
        </div>
        <div className="action-cluster">
          <Link className="secondary" to="/events">Back to events</Link>
        </div>
      </div>

      {error && <p className="form-error" role="alert">{error}</p>}

      <section className="detail-panel" style={{ marginBottom: 24 }}>
        <h2>QR token</h2>
        <form onSubmit={onSubmit}>
          <label>
            Paste QR URL or token
            <input
              value={rawInput}
              onChange={(event) => setRawInput(event.target.value)}
              placeholder="VSMS-DEMO-QR-001 or …/participant-status/&lt;token&gt;"
              autoComplete="off"
            />
          </label>
          <div className="action-cluster" style={{ paddingTop: 16 }}>
            <button type="submit" className="primary" disabled={pending}>
              {pending ? 'Verifying…' : 'Verify QR'}
            </button>
            <button
              type="button"
              className="secondary"
              disabled={pending}
              onClick={() => setScannerOpen(true)}
            >
              Scan with camera
            </button>
            <button
              type="button"
              className="secondary"
              disabled={pending}
              onClick={() => {
                setRawInput(DEMO_TOKEN);
                void runVerify(DEMO_TOKEN);
              }}
            >
              Simulate demo scan
            </button>
          </div>
        </form>
      </section>

      {verified && (
        <section className="detail-panel">
          <h2>Verified — choose station</h2>
          <p>
            <strong>{verified.participant.firstName} {verified.participant.lastName}</strong>
            {' · '}{verified.event.name}
            {verified.queueNumber != null ? <> · queue #{verified.queueNumber}</> : null}
          </p>
          <p>
            Registration <code>{verified.registrationId}</code>
          </p>

          <label>
            Station
            <select
              value={stationType}
              onChange={(event) => setStationType(event.target.value as StationType)}
            >
              {HANDOFF_STATION_OPTIONS.map((type) => (
                <option key={type} value={type}>{STATION_LABEL[type]}</option>
              ))}
            </select>
          </label>

          <div className="action-cluster" style={{ paddingTop: 16 }}>
            <button type="button" className="primary" onClick={() => goToStation()}>
              Open {STATION_LABEL[stationType]}
            </button>
            {HANDOFF_STATION_OPTIONS.filter((type) => type !== stationType).map((type) => (
              <button key={type} type="button" className="secondary" onClick={() => goToStation(type)}>
                {STATION_LABEL[type]}
              </button>
            ))}
          </div>

          {handoffHref && (
            <p style={{ marginTop: 12 }}>
              Target: <code>{handoffHref}</code>
            </p>
          )}
        </section>
      )}

      <StationCameraScanner
        open={scannerOpen}
        onOpenChange={setScannerOpen}
        onScan={onCameraScan}
      />
    </div>
  );
}
