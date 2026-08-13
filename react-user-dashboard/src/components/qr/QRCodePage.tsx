import { ArrowDownTrayIcon, ArrowPathIcon, CheckCircleIcon, PrinterIcon, QrCodeIcon, ShieldCheckIcon, UserPlusIcon, XCircleIcon } from '@heroicons/react/24/outline';
import { useState, type FormEvent } from 'react';
import apiClient, { getApiError as getApiMessage, newIdempotencyHeaders } from '../../utils/apiClient';
import QRCode from './QRCode';

type QrPass = { qrId: string; registrationId: string; issuedAt: string; expiresAt: string; qrImage: string };
type QrMutationResponse = { success: boolean; message?: string; data: QrPass };
type QrRenderResponse = { success: boolean; data: { qrId: string; expiresAt: string; qrImage: string } };
type ManualCheckInResult = { registrationId: string; eventId: string; registrationStatus: string; checkedIn: boolean; checkedInAt: string | null; queueNumber: number | null };
type ManualCheckInResponse = { success: boolean; message?: string; data: ManualCheckInResult };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const QR_TOKEN = /^[a-f0-9]{64}$/i;
const headingClass = 'grid grid-cols-[1.75rem_minmax(0,1fr)] items-start gap-3.5 [&>svg]:size-6 [&>svg]:text-[var(--accent)] [&_h2]:mb-1 [&_p]:m-0 [&_p]:max-w-[54ch] [&_p]:text-xs [&_p]:leading-[1.1875rem] [&_p]:text-[var(--muted)]';
const formClass = 'mt-7.5 grid gap-2.25 border-t border-[var(--hairline)] pt-6.5 [&>label]:text-[0.8125rem] [&>label]:font-semibold [&>label]:text-[var(--ink-2)] [&>input]:min-h-12 [&>input]:w-full [&>input]:rounded-lg [&>input]:border [&>input]:border-[var(--hairline-strong)] [&>input]:bg-[var(--surface)] [&>input]:px-3.25 [&>input]:font-mono [&>input]:text-[0.8125rem] [&>input]:text-[var(--ink)] [&>input]:outline-0 [&>input:focus]:border-[var(--accent)] [&>input:focus]:shadow-[0_0_0_3px_var(--accent-tint)] [&>input[aria-invalid=true]]:border-[var(--red)] [&>span]:text-[0.6875rem] [&>span]:leading-[1.0625rem] [&>span]:text-[var(--muted)] [&>.alert]:mt-1.75 [&>.primary]:mt-2.5 [&>.primary]:w-max max-sm:[&>.primary]:w-full';
const spinClass = 'animate-spin motion-reduce:animate-none';

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
      const { data } = await apiClient.post<QrMutationResponse>(`/qr/generate/${id}`, undefined, { headers: newIdempotencyHeaders() });
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
      await apiClient.put(`/qr/revoke/${pass?.qrId}`, { revokedReason: 'Revoked by staff' }, { headers: newIdempotencyHeaders() });
      setPass(null); setConfirmRevoke(false);
      return {};
    });
  };

  const reissue = () => runAction('reissue', async () => {
    const { data } = await apiClient.post<QrMutationResponse>(`/qr/reissue/${pass?.registrationId}`, undefined, { headers: newIdempotencyHeaders() });
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
      const { data } = await apiClient.post<ManualCheckInResponse>('/qr/manual-checkin', body, { headers: newIdempotencyHeaders() });
      setCheckInResult(data.data);
      setCheckInReference('');
    } catch (cause) { setCheckInError(getApiMessage(cause, 'That participant could not be checked in.')); }
    finally { setCheckInPending(false); }
  };

  const resetAll = () => {
    setPass(null); setRegistrationId(''); setError(''); setActionError(''); setConfirmRevoke(false);
    setCheckInResult(null); setCheckInError(''); setCheckInReference(''); setCheckInEventId('');
  };

  return <div className="page-frame max-w-[73.75rem]">
    <header className="page-heading border-b border-[var(--hairline)] pb-8.5"><div><h1>Participant QR passes</h1><p>Open, replace, and verify the single secure pass used throughout an event, with a manual check-in fallback.</p></div></header>

    <div className="grid grid-cols-[minmax(0,1fr)_minmax(20rem,.78fr)] items-start gap-[clamp(3rem,7vw,5.5rem)] pt-10.5 max-[860px]:grid-cols-1 max-sm:gap-9 max-sm:pt-7.5">
      <section className="min-w-0" aria-labelledby="qr-lookup-title">
        <div className={headingClass}><QrCodeIcon /><div><h2 id="qr-lookup-title">Open an event pass</h2><p>Access is checked against your assigned events. The active pass is reused at every station unless authorized staff explicitly reissue it.</p></div></div>
        <form className={formClass} onSubmit={generate} noValidate>
          <label htmlFor="registration-id">Registration UUID</label>
          <input id="registration-id" value={registrationId} onChange={(event) => setRegistrationId(event.target.value)} autoComplete="off" spellCheck="false" placeholder="00000000-0000-0000-0000-000000000000" aria-invalid={!!error} aria-describedby={error ? 'qr-error' : 'qr-id-help'} />
          <span id="qr-id-help">Use the identifier from the participant’s event registration record.</span>
          {error && <div className="alert error" id="qr-error" role="alert">{error}</div>}
          <button className="primary" type="submit" disabled={loading}>{loading ? <><ArrowPathIcon className={spinClass} />Opening pass…</> : <><QrCodeIcon />Open active pass</>}</button>
        </form>
        <div className="mt-8.5 grid grid-cols-[1.375rem_minmax(0,1fr)] gap-3 border-t border-[var(--hairline)] pt-5.5 text-[var(--muted)] [&_svg]:size-5 [&_svg]:text-[var(--green)] [&_p]:m-0 [&_p]:text-[0.6875rem] [&_p]:leading-4.5 [&_strong]:text-[var(--ink-2)]"><ShieldCheckIcon /><p><strong>Scoped and replaceable.</strong> A new pass revokes the previous active pass. Clinical information is never encoded in the QR image.</p></div>
      </section>

      <section className="flex min-h-105 min-w-0 flex-col items-center justify-center rounded-xl border border-[var(--hairline)] bg-[var(--canvas-soft)] p-8.5 text-center max-[860px]:min-h-90 max-sm:min-h-82.5 max-sm:px-4.5 max-sm:py-6" aria-labelledby="qr-preview-title" aria-live="polite">
        {pass ? <>
          <div className={`${headingClass} w-full self-stretch text-left`}><CheckCircleIcon /><div><h2 id="qr-preview-title">Pass ready</h2><p>Show this code only to the participant or authorized event staff.</p></div></div>
          <QRCode qrImage={pass.qrImage} />
          <p className="mt-0 mb-5 text-xs text-[var(--ink-2)] tabular-nums">Expires {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(pass.expiresAt))}</p>
          {actionError && <div className="alert error" role="alert">{actionError}</div>}
          <div className="grid w-full max-w-70 grid-cols-2 gap-2 max-sm:max-w-none [&_button]:min-h-10.5 [&_button]:w-full [&_button]:justify-center [&_button]:gap-1.75 [&_button]:text-xs [&_svg]:size-4">
            <button className="secondary" type="button" onClick={() => void download()} disabled={action !== null}>{action === 'download' ? <><ArrowPathIcon className={spinClass} />Downloading…</> : <><ArrowDownTrayIcon />Download</>}</button>
            <button className="secondary" type="button" onClick={() => void print()} disabled={action !== null}>{action === 'print' ? <><ArrowPathIcon className={spinClass} />Preparing…</> : <><PrinterIcon />Print</>}</button>
            <button className={confirmRevoke ? 'danger-button' : 'secondary'} type="button" onClick={() => void revoke()} disabled={action !== null}>{action === 'revoke' ? <><ArrowPathIcon className={spinClass} />Revoking…</> : <><XCircleIcon />{confirmRevoke ? 'Confirm revoke' : 'Revoke'}</>}</button>
            <button className="secondary" type="button" onClick={() => void reissue()} disabled={action !== null}>{action === 'reissue' ? <><ArrowPathIcon className={spinClass} />Reissuing…</> : <><ArrowPathIcon />Reissue</>}</button>
          </div>
          <button className="mt-3.5 cursor-pointer border-0 bg-transparent p-0 text-[0.6875rem] text-[var(--muted)] underline" type="button" onClick={resetAll}>Open another registration</button>
        </> : <div className="grid justify-items-center gap-2 text-[var(--muted)] [&>svg]:mb-1.5 [&>svg]:size-10 [&_h2]:m-0 [&_p]:m-0 [&_p]:max-w-[36ch] [&_p]:text-xs [&_p]:leading-[1.1875rem]"><QrCodeIcon /><h2 id="qr-preview-title">No pass selected</h2><p>Enter a verified registration UUID to open its active event QR.</p></div>}
      </section>
    </div>

    <section className="mt-[clamp(2.25rem,6vw,4rem)] border-t border-[var(--hairline)] pt-8.5" aria-labelledby="qr-checkin-title">
      <div className={headingClass}><UserPlusIcon /><div><h2 id="qr-checkin-title">Manual check-in fallback</h2><p>When a QR cannot be scanned, check a participant in by registration reference or by the 64-character hex token printed on the pass. NRIC is not accepted.</p></div></div>
      <form className={`${formClass} max-w-140 [&_.alert.success]:border-[color-mix(in_srgb,var(--green)_35%,var(--hairline))] [&_.alert.success]:bg-[color-mix(in_srgb,var(--green)_8%,var(--surface))] [&_.alert.success]:text-[var(--ink-2)]`} onSubmit={manualCheckIn} noValidate>
        <div className="mt-6 mb-1 flex gap-1.5 [&_button]:min-h-9.5 [&_button]:cursor-pointer [&_button]:rounded-lg [&_button]:border [&_button]:border-[var(--hairline-strong)] [&_button]:bg-[var(--surface)] [&_button]:px-3.5 [&_button]:text-xs [&_button]:text-[var(--ink-2)]" role="group" aria-label="Check-in reference type">
          <button type="button" className={checkInMode === 'registration' ? '!border-[var(--accent)] !bg-[var(--accent-tint)] !font-semibold !text-[var(--accent)]' : ''} onClick={() => setCheckInMode('registration')}>Registration UUID</button>
          <button type="button" className={checkInMode === 'token' ? '!border-[var(--accent)] !bg-[var(--accent-tint)] !font-semibold !text-[var(--accent)]' : ''} onClick={() => setCheckInMode('token')}>QR token</button>
        </div>
        <label htmlFor="checkin-event">Event UUID</label>
        <input id="checkin-event" value={checkInEventId} onChange={(event) => setCheckInEventId(event.target.value)} autoComplete="off" spellCheck="false" placeholder="00000000-0000-0000-0000-000000000000" />
        <label htmlFor="checkin-reference">{checkInMode === 'registration' ? 'Registration UUID' : 'QR token (64 hex characters)'}</label>
        <input id="checkin-reference" value={checkInReference} onChange={(event) => setCheckInReference(event.target.value)} autoComplete="off" spellCheck="false" placeholder={checkInMode === 'registration' ? '00000000-0000-0000-0000-000000000000' : 'a'.repeat(64)} />
        {checkInError && <div className="alert error" role="alert">{checkInError}</div>}
        {checkInResult && <div className="alert success" role="status">Checked in <strong>#{checkInResult.queueNumber ?? '—'}</strong> at {checkInResult.checkedInAt ? new Date(checkInResult.checkedInAt).toLocaleTimeString() : '—'}.</div>}
        <button className="primary" type="submit" disabled={checkInPending}>{checkInPending ? <><ArrowPathIcon className={spinClass} />Checking in…</> : <><UserPlusIcon />Check in participant</>}</button>
      </form>
    </section>
  </div>;
}
