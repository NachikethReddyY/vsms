import { ArrowPathIcon, CheckCircleIcon, QrCodeIcon, ShieldCheckIcon } from '@heroicons/react/24/outline';
import { useState, type FormEvent } from 'react';
import type { components } from '../../generated/api';
import { getApiMessage } from '../../auth/authState';
import apiClient from '../../utils/apiClient';
import QRCode from './QRCode';
import './qrCodePage.css';

type QrPass = components['schemas']['QrPassResponse'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default function QRCodePage() {
  const [participantId, setParticipantId] = useState('');
  const [pass, setPass] = useState<QrPass | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const generate = async (event: FormEvent) => {
    event.preventDefault();
    const id = participantId.trim();
    setError(''); setPass(null);
    if (!UUID.test(id)) { setError('Enter a valid participant UUID from the event registration.'); return; }
    setLoading(true);
    try {
      const { data } = await apiClient.post<QrPass>(`/api/qr/generate/${id}`);
      setPass(data);
    } catch (cause) { setError(getApiMessage(cause, 'A QR pass could not be generated for this participant.')); }
    finally { setLoading(false); }
  };

  return <div className="page-frame qr-page">
    <header className="page-heading qr-heading"><div><h1>Participant QR passes</h1><p>Generate a replacement event pass only after confirming the participant’s registration identifier.</p></div></header>

    <div className="qr-layout">
      <section className="qr-lookup" aria-labelledby="qr-lookup-title">
        <div className="qr-section-heading"><QrCodeIcon /><div><h2 id="qr-lookup-title">Generate a pass</h2><p>Access is checked against your assigned events before a pass is created.</p></div></div>
        <form className="qr-form" onSubmit={generate} noValidate>
          <label htmlFor="participant-id">Participant UUID</label>
          <input id="participant-id" value={participantId} onChange={(event) => setParticipantId(event.target.value)} autoComplete="off" spellCheck="false" placeholder="00000000-0000-0000-0000-000000000000" aria-invalid={!!error} aria-describedby={error ? 'qr-error' : 'qr-id-help'} />
          <span id="qr-id-help">Use the identifier from the participant’s event registration record.</span>
          {error && <div className="alert error" id="qr-error" role="alert">{error}</div>}
          <button className="primary" type="submit" disabled={loading}>{loading ? <><ArrowPathIcon className="qr-spin" />Generating pass…</> : <><QrCodeIcon />Generate new pass</>}</button>
        </form>
        <div className="qr-security-note"><ShieldCheckIcon /><p><strong>Scoped and replaceable.</strong> A new pass revokes the previous active pass. Clinical information is never encoded in the QR image.</p></div>
      </section>

      <section className="qr-preview" aria-labelledby="qr-preview-title" aria-live="polite">
        {pass ? <>
          <div className="qr-result-heading"><CheckCircleIcon /><div><h2 id="qr-preview-title">Pass ready</h2><p>Show this code only to the participant or authorized event staff.</p></div></div>
          <QRCode qrImage={pass.qrImage} />
          <p className="qr-expiry">Expires {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(pass.expiresAt))}</p>
          <button className="secondary" type="button" onClick={() => { setPass(null); setParticipantId(''); }}>Generate another pass</button>
        </> : <div className="qr-idle"><QrCodeIcon /><h2 id="qr-preview-title">No pass generated</h2><p>Enter a verified participant UUID to create a time-limited QR image.</p></div>}
      </section>
    </div>
  </div>;
}
