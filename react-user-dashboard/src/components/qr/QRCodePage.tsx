import { ArrowDownTrayIcon, ArrowPathIcon, CheckCircleIcon, PrinterIcon, QrCodeIcon, ShieldCheckIcon, UserPlusIcon, XCircleIcon } from '@heroicons/react/24/outline';
import { useState, type FormEvent } from 'react';
import apiClient, { getApiError as getApiMessage } from '../../utils/apiClient';
import QRCode from './QRCode';
import './qrCodePage.css';

type QrPass = { qrId: string; registrationId: string; issuedAt: string; expiresAt: string; qrImage: string };
type QrMutationResponse = { success: boolean; message?: string; data: QrPass };
type QrRenderResponse = { success: boolean; data: { qrId: string; expiresAt: string; qrImage: string } };
type ManualCheckInResult = { registrationId: string; eventId: string; registrationStatus: string; checkedIn: boolean; checkedInAt: string | null; queueNumber: number | null };
type ManualCheckInResponse = { success: boolean; message?: string; data: ManualCheckInResult };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const QR_TOKEN = /^[a-f0-9]{64}$/i;

function openPrintWindow(dataUrl: string) {
  const win = window.open('', '_blank');
  if (!win) return false;
  win.document.write(`<!doctype html><html><head><title>VSMS Event Pass</title><style>html,body{margin:0;padding:24px;display:grid;place-items:center;background:#fff}img{max-width:100%;width:600px;height:auto}</style></head><body><img src="${dataUrl}" alt="VSMS Event Pass" onload="setTimeout(function(){window.print()},200)"/></body></html>`);
  win.document.close();
  return true;
}

export default function QRCodePage() {
  const [registrationId, setRegistrationId] = useState('');
  const [pass, setPass] = useState<QrPass | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [action, setAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');
  const [confirmRevoke, setConfirmRevoke] = useState(false);

  const [checkInMode, setCheckInMode] = useState<'registration' | 'token'>('registration');
  const [checkInEventId, setCheckInEventId] = useState('');
  const [checkInReference, setCheckInReference] = useState('');
  const [checkInPending, setCheckInPending] = useState(false);
  const [checkInError, setCheckInError] = useState('');
  const [checkInResult, setCheckInResult] = useState<ManualCheckInResult | null>(null);

  const generate = async (event: FormEvent) => {
    event.preventDefault();
    const id = registrationId.trim();
    setError(''); setPass(null); setActionError(''); setConfirmRevoke(false);
    if (!UUID.test(id)) { setError('Enter a valid event registration UUID.'); return; }
    setLoading(true);
    try {
      const { data } = await apiClient.post<QrMutationResponse>(`/qr/generate/${id}`);
      setPass(data.data);
    } catch (cause) { setError(getApiMessage(cause, 'A QR pass could not be generated for this registration.')); }
    finally { setLoading(false); }
  };

  const runAction = async (name: string, fn: () => Promise<{ image?: string }>) => {
    setAction(name); setActionError('');
    try {
      const result = await fn();
      if (name === 'download' && result.image) {
        const anchor = document.createElement('a');
        anchor.href = result.image;
        anchor.download = `vsms-pass-${pass?.registrationId.slice(0, 8) ?? 'event'}.svg`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
      }
      if (name === 'print' && result.image) {
        if (!openPrintWindow(result.image)) setActionError('Pop-up blocked. Allow pop-ups to print the pass.');
      }
    } catch (cause) {
      setActionError(getApiMessage(cause, `Could not ${name} this pass.`));
    } finally {
      setAction(null);
    }
  };

  const download = () => runAction('download', async () => {
    const { data } = await apiClient.get<QrRenderResponse>(`/qr/download/${pass?.qrId}`);
    return { image: data.data.qrImage };
  });

  const print = () => runAction('print', async () => {
    const { data } = await apiClient.get<QrRenderResponse>(`/qr/print/${pass?.qrId}`);
    return { image: data.data.qrImage };
  });

  const revoke = async () => {
    if (!confirmRevoke) { setConfirmRevoke(true); return; }
    await runAction('revoke', async () => {
      await apiClient.put(`/qr/revoke/${pass?.qrId}`, { revokedReason: 'Revoked by staff' });
      setPass(null); setConfirmRevoke(false);
      return {};
    });
  };

  const reissue = () => runAction('reissue', async () => {
    const { data } = await apiClient.post<QrMutationResponse>(`/qr/reissue/${pass?.registrationId}`);
    setPass(data.data); setConfirmRevoke(false);
    return {};
  });

  const manualCheckIn = async (event: FormEvent) => {
    event.preventDefault();
    setCheckInError(''); setCheckInResult(null);
    const eventId = checkInEventId.trim();
    const reference = checkInReference.trim();
    if (!UUID.test(eventId)) { setCheckInError('Enter a valid event UUID.'); return; }
    if (checkInMode === 'registration') {
      if (!UUID.test(reference)) { setCheckInError('Enter a valid registration UUID.'); return; }
    } else if (!QR_TOKEN.test(reference)) {
      setCheckInError('Enter a 64-character hex QR token (the value scanned from the pass).'); return;
    }
    setCheckInPending(true);
    try {
      const body = checkInMode === 'registration'
        ? { eventId, registrationId: reference }
        : { eventId, identifier: reference };
      const { data } = await apiClient.post<ManualCheckInResponse>('/qr/manual-checkin', body);
      setCheckInResult(data.data);
      setCheckInReference('');
    } catch (cause) { setCheckInError(getApiMessage(cause, 'That participant could not be checked in.')); }
    finally { setCheckInPending(false); }
  };

  const resetAll = () => {
    setPass(null); setRegistrationId(''); setError(''); setActionError(''); setConfirmRevoke(false);
    setCheckInResult(null); setCheckInError(''); setCheckInReference(''); setCheckInEventId('');
  };

  return <div className="page-frame qr-page">
    <header className="page-heading qr-heading"><div><h1>Participant QR passes</h1><p>Open, replace, and verify the single secure pass used throughout an event, with a manual check-in fallback.</p></div></header>

    <div className="qr-layout">
      <section className="qr-lookup" aria-labelledby="qr-lookup-title">
        <div className="qr-section-heading"><QrCodeIcon /><div><h2 id="qr-lookup-title">Open an event pass</h2><p>Access is checked against your assigned events. The active pass is reused at every station unless authorized staff explicitly reissue it.</p></div></div>
        <form className="qr-form" onSubmit={generate} noValidate>
          <label htmlFor="registration-id">Registration UUID</label>
          <input id="registration-id" value={registrationId} onChange={(event) => setRegistrationId(event.target.value)} autoComplete="off" spellCheck="false" placeholder="00000000-0000-0000-0000-000000000000" aria-invalid={!!error} aria-describedby={error ? 'qr-error' : 'qr-id-help'} />
          <span id="qr-id-help">Use the identifier from the participant’s event registration record.</span>
          {error && <div className="alert error" id="qr-error" role="alert">{error}</div>}
          <button className="primary" type="submit" disabled={loading}>{loading ? <><ArrowPathIcon className="qr-spin" />Opening pass…</> : <><QrCodeIcon />Open active pass</>}</button>
        </form>
        <div className="qr-security-note"><ShieldCheckIcon /><p><strong>Scoped and replaceable.</strong> A new pass revokes the previous active pass. Clinical information is never encoded in the QR image.</p></div>
      </section>

      <section className="qr-preview" aria-labelledby="qr-preview-title" aria-live="polite">
        {pass ? <>
          <div className="qr-result-heading"><CheckCircleIcon /><div><h2 id="qr-preview-title">Pass ready</h2><p>Show this code only to the participant or authorized event staff.</p></div></div>
          <QRCode qrImage={pass.qrImage} />
          <p className="qr-expiry">Expires {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(pass.expiresAt))}</p>
          {actionError && <div className="alert error" role="alert">{actionError}</div>}
          <div className="qr-actions">
            <button className="secondary" type="button" onClick={() => void download()} disabled={action !== null}>{action === 'download' ? <><ArrowPathIcon className="qr-spin" />Downloading…</> : <><ArrowDownTrayIcon />Download</>}</button>
            <button className="secondary" type="button" onClick={() => void print()} disabled={action !== null}>{action === 'print' ? <><ArrowPathIcon className="qr-spin" />Preparing…</> : <><PrinterIcon />Print</>}</button>
            <button className={confirmRevoke ? 'danger-button' : 'secondary'} type="button" onClick={() => void revoke()} disabled={action !== null}>{action === 'revoke' ? <><ArrowPathIcon className="qr-spin" />Revoking…</> : <><XCircleIcon />{confirmRevoke ? 'Confirm revoke' : 'Revoke'}</>}</button>
            <button className="secondary" type="button" onClick={() => void reissue()} disabled={action !== null}>{action === 'reissue' ? <><ArrowPathIcon className="qr-spin" />Reissuing…</> : <><ArrowPathIcon />Reissue</>}</button>
          </div>
          <button className="qr-reset" type="button" onClick={resetAll}>Open another registration</button>
        </> : <div className="qr-idle"><QrCodeIcon /><h2 id="qr-preview-title">No pass selected</h2><p>Enter a verified registration UUID to open its active event QR.</p></div>}
      </section>
    </div>

    <section className="qr-checkin" aria-labelledby="qr-checkin-title">
      <div className="qr-section-heading"><UserPlusIcon /><div><h2 id="qr-checkin-title">Manual check-in fallback</h2><p>When a QR cannot be scanned, check a participant in by registration reference or by the 64-character hex token printed on the pass. NRIC is not accepted.</p></div></div>
      <form className="qr-form qr-checkin-form" onSubmit={manualCheckIn} noValidate>
        <div className="qr-checkin-mode" role="group" aria-label="Check-in reference type">
          <button type="button" className={checkInMode === 'registration' ? 'selected' : ''} onClick={() => setCheckInMode('registration')}>Registration UUID</button>
          <button type="button" className={checkInMode === 'token' ? 'selected' : ''} onClick={() => setCheckInMode('token')}>QR token</button>
        </div>
        <label htmlFor="checkin-event">Event UUID</label>
        <input id="checkin-event" value={checkInEventId} onChange={(event) => setCheckInEventId(event.target.value)} autoComplete="off" spellCheck="false" placeholder="00000000-0000-0000-0000-000000000000" />
        <label htmlFor="checkin-reference">{checkInMode === 'registration' ? 'Registration UUID' : 'QR token (64 hex characters)'}</label>
        <input id="checkin-reference" value={checkInReference} onChange={(event) => setCheckInReference(event.target.value)} autoComplete="off" spellCheck="false" placeholder={checkInMode === 'registration' ? '00000000-0000-0000-0000-000000000000' : 'a'.repeat(64)} />
        {checkInError && <div className="alert error" role="alert">{checkInError}</div>}
        {checkInResult && <div className="alert success" role="status">Checked in <strong>#{checkInResult.queueNumber ?? '—'}</strong> at {checkInResult.checkedInAt ? new Date(checkInResult.checkedInAt).toLocaleTimeString() : '—'}.</div>}
        <button className="primary" type="submit" disabled={checkInPending}>{checkInPending ? <><ArrowPathIcon className="qr-spin" />Checking in…</> : <><UserPlusIcon />Check in participant</>}</button>
      </form>
    </section>
  </div>;
}
