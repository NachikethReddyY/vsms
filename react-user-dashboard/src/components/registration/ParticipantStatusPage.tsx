import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { getApiError as getApiMessage } from '../../utils/apiClient';
import {
  DEFAULT_HANDOFF_STATION,
  HANDOFF_STATION_OPTIONS,
  QrVerifyResult,
  stationHandoffUrl,
  STATION_LABEL,
  verifyQrToken,
} from '../../features/screening/qrHandoff';
import type { StationType } from '../../features/screening/screeningApi';

/**
 * Landing page for the URL encoded inside generated QR images:
 * `/participant-status/:token`
 *
 * Staff verify the token, then continue to a station with registrationId handoff.
 */
export default function ParticipantStatusPage() {
  const { token = '' } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [pending, setPending] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [verified, setVerified] = useState<QrVerifyResult | null>(null);
  const [stationType, setStationType] = useState<StationType>(DEFAULT_HANDOFF_STATION);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!token) {
        setError('Missing QR token in the URL.');
        setPending(false);
        return;
      }
      setPending(true);
      setError(null);
      try {
        const result = await verifyQrToken(token);
        if (!cancelled) setVerified(result);
      } catch (cause) {
        if (!cancelled) setError(getApiMessage(cause, 'Invalid or expired QR pass.'));
      } finally {
        if (!cancelled) setPending(false);
      }
    };
    void run();
    return () => { cancelled = true; };
  }, [token]);

  const defaultHref = useMemo(() => {
    if (!verified) return null;
    return stationHandoffUrl(verified.event.id, verified.registrationId, DEFAULT_HANDOFF_STATION);
  }, [verified]);

  const goToStation = (type: StationType) => {
    if (!verified) return;
    const href = stationHandoffUrl(verified.event.id, verified.registrationId, type);
    if (href) navigate(href);
  };

  if (pending) {
    return (
      <div className="page-frame narrow">
        <p className="eyebrow">Participant pass</p>
        <h1>Verifying QR…</h1>
      </div>
    );
  }

  if (error || !verified) {
    return (
      <div className="page-frame narrow">
        <p className="eyebrow">Participant pass</p>
        <h1>Invalid or expired pass</h1>
        <p className="form-error" role="alert">{error || 'The scanned QR pass could not be verified.'}</p>
        <div className="action-cluster">
          <Link className="secondary" to="/qr-scanner">Open QR scanner</Link>
          <Link className="secondary" to="/events">Back to events</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="page-frame narrow">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Participant pass</p>
          <h1>{verified.participant.firstName} {verified.participant.lastName}</h1>
          <p>
            {verified.event.name}
            {verified.queueNumber != null ? <> · queue #{verified.queueNumber}</> : null}
          </p>
        </div>
        <div className="action-cluster">
          <Link className="secondary" to="/qr-scanner">Scanner</Link>
        </div>
      </div>

      <section className="detail-panel">
        <p>
          Registration <code>{verified.registrationId}</code>
        </p>
        <p>Continue to a screening station (handoff keeps this participant via query string).</p>

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
          <button type="button" className="primary" onClick={() => goToStation(stationType)}>
            Open {STATION_LABEL[stationType]}
          </button>
          {defaultHref && stationType !== DEFAULT_HANDOFF_STATION && (
            <button type="button" className="secondary" onClick={() => goToStation(DEFAULT_HANDOFF_STATION)}>
              Default: Visual Acuity
            </button>
          )}
          {HANDOFF_STATION_OPTIONS.filter((type) => type !== stationType).map((type) => (
            <button key={type} type="button" className="secondary" onClick={() => goToStation(type)}>
              {STATION_LABEL[type]}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
