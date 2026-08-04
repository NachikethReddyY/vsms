import {
  ArrowDownTrayIcon,
  ArrowLeftIcon,
  ArrowPathIcon,
  ArrowTopRightOnSquareIcon,
  CheckCircleIcon,
  ClipboardDocumentCheckIcon,
  ClockIcon,
  ExclamationCircleIcon,
  ExclamationTriangleIcon,
  IdentificationIcon,
  QueueListIcon,
  QrCodeIcon,
  ShieldCheckIcon,
  UserIcon,
} from '@heroicons/react/24/outline';
import axios from 'axios';
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AppDialog } from '../../components/AppDialog';
import { SignaturePad } from '../../components/SignaturePad';
import {
  reviewApi,
  type OverallFlag,
  type ReviewDecisionRequest,
  type ReviewDetailResponse,
  type ReviewOutcome,
  type ReviewQueueItem,
  type ReviewQueueResponse,
  type IssueReferralRequest,
  type IssueReferralResponse,
} from './reviewApi';
import './ReviewWorkspacePage.css';

type FormState = {
  outcome: ReviewOutcome;
  clinicalSummary: string;
  recommendations: string;
  urgency: 'ROUTINE' | 'PRIORITY' | 'URGENT';
  destinationName: string;
  reason: string;
  instructions: string;
  confirmed: boolean;
};

const EMPTY_FORM: FormState = {
  outcome: 'COMPLETE',
  clinicalSummary: '',
  recommendations: '',
  urgency: 'ROUTINE',
  destinationName: '',
  reason: '',
  instructions: '',
  confirmed: false,
};

const OUTCOMES: { value: ReviewOutcome; label: string; description: string }[] = [
  { value: 'COMPLETE', label: 'Complete', description: 'No clinical follow-up required.' },
  { value: 'MONITOR', label: 'Monitor', description: 'Provide advice and monitor symptoms.' },
  { value: 'REFER', label: 'Refer', description: 'Create a draft referral for follow-up.' },
  { value: 'URGENT_ESCALATION', label: 'Urgent', description: 'Escalate immediately with emergency urgency.' },
];

const FLAG_META: Record<OverallFlag, { label: string; icon: ReactNode }> = {
  NORMAL: { label: 'Normal', icon: <CheckCircleIcon /> },
  REVIEW: { label: 'Review', icon: <ExclamationCircleIcon /> },
  REFER: { label: 'Refer', icon: <ArrowTopRightOnSquareIcon /> },
  URGENT: { label: 'Urgent', icon: <ExclamationTriangleIcon /> },
};

const apiProblem = (error: unknown) => axios.isAxiosError(error)
  ? error.response?.data as { code?: string; title?: string; errors?: { field: string; message: string }[] } | undefined
  : undefined;

const prettyKey = (key: string) => key
  .replace(/([a-z])([A-Z])/g, '$1 $2')
  .replace(/_/g, ' ')
  .replace(/^\w/, (letter: string) => letter.toUpperCase());

const displayValue = (value: unknown) => {
  if (value == null) return 'Not recorded';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  try { return JSON.stringify(value); } catch { return 'Recorded value'; }
};

const genderLabel = (value: string) => ({
  M: 'Male', F: 'Female', O: 'Other', U: 'Prefer not to say',
}[value] ?? 'Not recorded');

const eyeReading = (value: unknown, distance: unknown) => {
  if (!value || typeof value !== 'object') return 'Not recorded';
  const reading = value as { kind?: unknown; denominator?: unknown; code?: unknown };
  if (reading.kind === 'FRACTION' && typeof reading.denominator === 'number') {
    return `${typeof distance === 'number' ? distance : 6}/${reading.denominator}`;
  }
  return typeof reading.code === 'string' ? reading.code.replace(/_/g, ' ') : 'Not recorded';
};

function FlagBadge({ flag }: { flag: OverallFlag }) {
  const meta = FLAG_META[flag];
  return <span className={`review-flag flag-${flag.toLowerCase()}`}>{meta.icon}{meta.label}</span>;
}

function ResultData({ station }: { station: ReviewDetailResponse['stations'][number] }) {
  const data = station.result?.resultData;
  if (!data) return <p className="review-missing-result">Awaiting result</p>;
  if (station.stationType === 'VISUAL_ACUITY') {
    return <dl className="visual-acuity-result">
      <div><dt>Right eye (OD)</dt><dd>{eyeReading(data.od, data.chartDistanceMetres)}</dd></div>
      <div><dt>Left eye (OS)</dt><dd>{eyeReading(data.os, data.chartDistanceMetres)}</dd></div>
      <div><dt>Chart distance</dt><dd>{displayValue(data.chartDistanceMetres)} m</dd></div>
      <div><dt>Usual distance glasses</dt><dd>{displayValue(data.withUsualDistanceGlasses)}</dd></div>
    </dl>;
  }
  if (station.stationType === 'REFRACTION') {
    const refraction = data as typeof data & {
      od?: { sphere?: number; cylinder?: number; axis?: number | null };
      os?: { sphere?: number; cylinder?: number; axis?: number | null };
    };
    const formatEye = (eye?: { sphere?: number; cylinder?: number; axis?: number | null }) => {
      if (!eye || eye.sphere == null || eye.cylinder == null) return '—';
      return `${eye.sphere}/${eye.cylinder} x ${eye.axis ?? '—'}`;
    };
    return <dl className="visual-acuity-result">
      <div><dt>Status</dt><dd>{displayValue(data.measurementStatus)}</dd></div>
      <div><dt>Usual distance glasses</dt><dd>{displayValue(data.wearsDistanceGlasses)}</dd></div>
      <div><dt>Right eye (OD)</dt><dd>{formatEye(refraction.od)}</dd></div>
      <div><dt>Left eye (OS)</dt><dd>{formatEye(refraction.os)}</dd></div>
      {data.notes ? <div><dt>Notes</dt><dd>{displayValue(data.notes)}</dd></div> : null}
    </dl>;
  }
  if (station.stationType === 'COLOUR_VISION') {
    return <dl className="visual-acuity-result">
      <div><dt>Test kit</dt><dd>{displayValue(data.testKit)}</dd></div>
      <div><dt>Plates presented</dt><dd>{displayValue(data.platesPresented)}</dd></div>
      <div><dt>Right eye (OD)</dt><dd>{displayValue(data.odCorrect)} / {displayValue(data.platesPresented)}</dd></div>
      <div><dt>Left eye (OS)</dt><dd>{displayValue(data.osCorrect)} / {displayValue(data.platesPresented)}</dd></div>
    </dl>;
  }
  return <dl className="result-data-fallback">
    {Object.entries(data).map(([key, value]) => <div key={key}><dt>{prettyKey(key)}</dt><dd>{displayValue(value)}</dd></div>)}
  </dl>;
}

function ParticipantReport({ detail }: { detail: ReviewDetailResponse }) {
  return <section className="participant-report" aria-hidden="true">
    <header className="participant-report-header">
      <div><strong>VSMS</strong><span>De-identified clinical screening summary</span></div>
      <p>Generated {new Date().toLocaleString()}</p>
    </header>

    <section className="participant-report-title">
      <p>{detail.event.name}</p>
      <h1>Registration {detail.participant.registrationId.slice(0, 8)}</h1>
      <span>{detail.event.venue}</span>
    </section>

    <dl className="participant-report-facts">
      <div><dt>Registration ID</dt><dd>{detail.participant.registrationId}</dd></div>
      <div><dt>Queue number</dt><dd>{detail.participant.queueNumber ?? 'Not assigned'}</dd></div>
      <div><dt>Registration status</dt><dd>{detail.participant.registrationStatus.replace(/_/g, ' ')}</dd></div>
    </dl>

    <section className="participant-report-section">
      <header><h2>Screening results</h2><span>{detail.readiness.completedStationCount} of {detail.readiness.totalStationCount} stations completed · Highest flag: {detail.readiness.highestFlag}</span></header>
      {detail.stations.map((station) => <article key={station.stationId}>
        <div className="participant-report-station-heading"><strong>{station.stationOrder}. {station.stationName}</strong><span>{station.result?.overallFlag || 'PENDING'}</span></div>
        <ResultData station={station} />
        {station.result?.flagSummary && <p className="participant-report-summary">{station.result.flagSummary}</p>}
      </article>)}
    </section>

    <section className="participant-report-section">
      <header><h2>Clinical decision</h2></header>
      {detail.existingReview ? <dl className="participant-report-decision">
        <div><dt>Outcome</dt><dd>{detail.existingReview.outcome.replace(/_/g, ' ')}</dd></div>
        <div><dt>Urgency</dt><dd>{detail.existingReview.urgency}</dd></div>
        <div><dt>Reviewed by</dt><dd>{detail.existingReview.reviewedByName}</dd></div>
        <div><dt>Recorded</dt><dd>{new Date(detail.existingReview.reviewedAt).toLocaleString()}</dd></div>
        <div className="wide"><dt>Clinical summary</dt><dd>{detail.existingReview.clinicalSummary}</dd></div>
        {detail.existingReview.recommendations && <div className="wide"><dt>Recommendations</dt><dd>{detail.existingReview.recommendations}</dd></div>}
      </dl> : <p className="participant-report-pending">No clinical decision has been recorded.</p>}
    </section>

    <footer className="participant-report-footer">
      <span>Confidential clinical document</span>
      <span>Generated by VSMS Event Operations</span>
    </footer>
  </section>;
}

function QueueSkeleton() {
  return <div className="review-queue-skeleton" aria-label="Loading review queue">
    {[0, 1, 2, 3].map((item) => <span key={item} />)}
  </div>;
}

function DetailSkeleton() {
  return <div className="review-detail-skeleton" aria-label="Loading participant review">
    <span /><span /><span /><span />
  </div>;
}

type RecordedReferral = NonNullable<NonNullable<ReviewDetailResponse['existingReview']>['referral']>;

const referralIssueStorageKey = (eventId: string, referralId: string) => `vsms.referral-issue:${eventId}:${referralId}`;

const savedReferralIssue = (eventId: string, referralId: string): IssueReferralRequest | null => {
  try {
    const value = window.sessionStorage.getItem(referralIssueStorageKey(eventId, referralId));
    if (!value) return null;
    const parsed = JSON.parse(value) as IssueReferralRequest;
    return typeof parsed.idempotencyKey === 'string' && typeof parsed.destinationEmail === 'string' ? parsed : null;
  } catch {
    return null;
  }
};

function ReferralIssuance({ eventId, referral }: { eventId: string; referral: RecordedReferral }) {
  const [savedIssue, setSavedIssue] = useState<IssueReferralRequest | null>(() => savedReferralIssue(eventId, referral.referralId));
  const [email, setEmail] = useState(() => savedIssue?.destinationEmail || '');
  const [signature, setSignature] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [secretCopied, setSecretCopied] = useState(false);
  const [acknowledging, setAcknowledging] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<IssueReferralResponse | null>(null);
  const documentId = result?.documentId || referral.document?.documentId;
  const delivery = result?.delivery || referral.delivery;
  const storageKey = referralIssueStorageKey(eventId, referral.referralId);

  const saveIssue = (request: IssueReferralRequest) => {
    window.sessionStorage.setItem(storageKey, JSON.stringify(request));
    setSavedIssue(request);
  };

  const recover = async () => {
    if (!savedIssue) return setError('This browser does not have the original issuance request, so the passphrase cannot be recovered here.');
    setIssuing(true);
    setError('');
    try {
      setResult(await reviewApi.issueReferral(eventId, referral.referralId, savedIssue));
    } catch (requestError) {
      setError(apiProblem(requestError)?.title || 'The secure referral recovery request could not be completed.');
    } finally {
      setIssuing(false);
    }
  };

  const copyAndAcknowledge = async () => {
    if (!result?.handoffSecret || !savedIssue) return;
    setAcknowledging(true);
    setError('');
    try {
      await navigator.clipboard.writeText(result.handoffSecret);
      await reviewApi.acknowledgeReferralHandoff(eventId, referral.referralId, { idempotencyKey: savedIssue.idempotencyKey });
      window.sessionStorage.removeItem(storageKey);
      setSavedIssue(null);
      setResult({ ...result, handoffSecret: null, handoffSecretExpiresAt: null });
      setSecretCopied(true);
    } catch (requestError) {
      setError(apiProblem(requestError)?.title || 'The passphrase was not acknowledged. Keep it secure and try again.');
    } finally {
      setAcknowledging(false);
    }
  };

  const download = async () => {
    if (!documentId) return;
    setDownloading(true);
    setError('');
    try {
      const blob = await reviewApi.downloadReferral(eventId, referral.referralId, documentId);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `vision-referral-${referral.referralId.slice(0, 8)}.pdf`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (requestError) {
      setError(apiProblem(requestError)?.title || 'The encrypted referral could not be downloaded.');
    } finally {
      setDownloading(false);
    }
  };

  const issue = async (event: FormEvent) => {
    event.preventDefault();
    if (!savedIssue && !signature) return setError('Add your electronic signature before issuing the referral.');
    if (!savedIssue && !confirmed) return setError('Confirm the passphrase handoff and delivery instructions before issuing.');
    setIssuing(true);
    setError('');
    try {
      let request = savedIssue;
      if (!request) {
        if (!signature) return setError('Add your electronic signature before issuing the referral.');
        const uploaded = await reviewApi.uploadSignature(eventId, referral.referralId, signature);
        request = { destinationEmail: email.trim().toLowerCase(), ...uploaded, idempotencyKey: crypto.randomUUID(), confirmed: true };
        saveIssue(request);
      }
      const issued = await reviewApi.issueReferral(eventId, referral.referralId, request);
      setResult(issued);
    } catch (requestError) {
      setError(apiProblem(requestError)?.title || 'The referral could not be issued. Nothing was marked as sent.');
    } finally {
      setIssuing(false);
    }
  };

  if (referral.status !== 'DRAFT' || result) return <section className="referral-issuance issued" aria-labelledby="issued-referral-title">
    <div><CheckCircleIcon /><span><strong id="issued-referral-title">Encrypted referral ready</strong><small>Version {result?.documentVersion || referral.document?.version || 1} · electronically signed</small></span></div>
    {delivery?.status === 'SENT' || delivery?.status === 'DELIVERED'
      ? <p className="referral-delivery-success">Email accepted for {delivery.recipient}. Delivery status: {delivery.status.toLowerCase()}.</p>
      : delivery?.status === 'SENDING'
        ? <p className="referral-delivery-warning">Delivery confirmation is pending. To prevent a duplicate clinical email, this referral will not be sent again automatically.</p>
        : <p className="referral-delivery-warning">Email not sent{delivery?.failureReason === 'DELIVERY_PROVIDER_NOT_CONFIGURED' ? ': the delivery provider is not configured.' : '.'} The encrypted PDF remains available.</p>}
    {result?.handoffSecret && <div className="referral-handoff" role="status"><strong>Securely hand off this passphrase</strong><p>It can be recovered only in this browser until {result.handoffSecretExpiresAt ? new Date(result.handoffSecretExpiresAt).toLocaleTimeString() : 'expiry'}. Share it by phone or another separate channel—never in the referral email.</p><div><code>{result.handoffSecret}</code><button className="secondary compact" type="button" disabled={acknowledging} onClick={() => void copyAndAcknowledge()}>{acknowledging ? 'Acknowledging…' : secretCopied ? 'Copied and acknowledged' : 'Copy and acknowledge'}</button></div></div>}
    {!result?.handoffSecret && savedIssue && <button className="secondary compact" type="button" disabled={issuing} onClick={() => void recover()}>{issuing ? 'Recovering…' : 'Recover passphrase and delivery status'}</button>}
    {!result?.handoffSecret && !savedIssue && <p>The passphrase is not stored after acknowledgement or expiry and is never included in the email.</p>}
    {error && <div className="review-error-summary" role="alert">{error}</div>}
    <button className="secondary" type="button" onClick={() => void download()} disabled={downloading}>{downloading ? 'Downloading…' : 'Download encrypted PDF'}</button>
  </section>;

  return <form className="referral-issuance" onSubmit={(event) => void issue(event)}>
    <header><h4>Issue encrypted referral</h4><p>Generate the medical referral, sign it, and send the password-protected attachment.</p></header>
    {error && <div className="review-error-summary" role="alert">{error}</div>}
    <label className="review-field"><span>Destination email</span><input type="email" required maxLength={255} value={email} onChange={(event) => { if (savedIssue && event.target.value.trim().toLowerCase() !== savedIssue.destinationEmail) { window.sessionStorage.removeItem(storageKey); setSavedIssue(null); } setEmail(event.target.value); }} placeholder="clinic@example.com" /></label>
    <div className="referral-signature"><span>Reviewer electronic signature</span><SignaturePad onChange={setSignature} /></div>
    <label className="decision-confirm"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /><span><strong>I confirm this referral and delivery</strong><small>A random passphrase is held in encrypted recovery escrow for 15 minutes. I will share it through a separate channel, never in the referral email.</small></span></label>
    <button className="primary" type="submit" disabled={issuing}>{issuing ? 'Signing and issuing…' : 'Sign and issue referral'}</button>
  </form>;
}

function ReviewedDecision({ eventId, review }: { eventId: string; review: NonNullable<ReviewDetailResponse['existingReview']> }) {
  return <section className="reviewed-decision" aria-labelledby="recorded-decision-title">
    <div className="reviewed-heading"><ShieldCheckIcon /><div><h3 id="recorded-decision-title">Decision recorded</h3><p>This clinical review is immutable and read-only.</p></div></div>
    <dl className="reviewed-fields">
      <div><dt>Outcome</dt><dd>{review.outcome.replace(/_/g, ' ')}</dd></div>
      <div><dt>Urgency</dt><dd>{review.urgency}</dd></div>
      <div><dt>Reviewed by</dt><dd>{review.reviewedByName}</dd></div>
      <div><dt>Recorded</dt><dd>{new Date(review.reviewedAt).toLocaleString()}</dd></div>
      <div className="wide"><dt>Clinical summary</dt><dd>{review.clinicalSummary}</dd></div>
      {review.recommendations && <div className="wide"><dt>Recommendations</dt><dd>{review.recommendations}</dd></div>}
    </dl>
    {review.referral && <div className="recorded-referral">
      <strong>Referral · {review.referral.urgency}</strong>
      <span>{review.referral.destinationName}</span>
      <p>{review.referral.reason}</p>
      {review.referral.instructions && <p>{review.referral.instructions}</p>}
    </div>}
    {review.referral && <ReferralIssuance eventId={eventId} referral={review.referral} />}
  </section>;
}

export default function ReviewWorkspacePage() {
  const { eventId = '', registrationId: directRegistrationId } = useParams();
  const navigate = useNavigate();
  const [queueData, setQueueData] = useState<ReviewQueueResponse | null>(null);
  const [selectedId, setSelectedId] = useState(directRegistrationId || '');
  const [detail, setDetail] = useState<ReviewDetailResponse | null>(null);
  const [queueLoading, setQueueLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [detailError, setDetailError] = useState('');
  const [accessState, setAccessState] = useState<'permission' | 'inactive' | ''>('');
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [dirty, setDirty] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formErrors, setFormErrors] = useState<string[]>([]);
  const [announcement, setAnnouncement] = useState('');
  const [mobileDetail, setMobileDetail] = useState(Boolean(directRegistrationId));
  const errorSummaryRef = useRef<HTMLDivElement>(null);
  const detailHeadingRef = useRef<HTMLHeadingElement>(null);
  const pendingDraftActionRef = useRef<(() => void) | null>(null);
  const restoringHistoryRef = useRef(false);
  const [discardDialogOpen, setDiscardDialogOpen] = useState(false);

  const loadQueue = useCallback(async (initial = false) => {
    if (initial) setQueueLoading(true);
    else setRefreshing(true);
    setLoadError('');
    try {
      const data = await reviewApi.list(eventId);
      setQueueData(data);
      setAccessState('');
      setSelectedId((current) => current || directRegistrationId || '');
    } catch (error) {
      const problem = apiProblem(error);
      if (problem?.code === 'REVIEWER_ASSIGNMENT_REQUIRED') setAccessState('permission');
      else if (problem?.code === 'EVENT_NOT_IN_PROGRESS') setAccessState('inactive');
      else setLoadError(problem?.title || 'The clinical review queue could not be loaded.');
    } finally {
      setQueueLoading(false);
      setRefreshing(false);
    }
  }, [directRegistrationId, eventId]);

  const loadDetail = useCallback(async (registrationId: string, preserveForm = false) => {
    if (!registrationId) { setDetail(null); return; }
    setDetailLoading(true);
    setDetailError('');
    try {
      setDetail(await reviewApi.get(eventId, registrationId));
      if (!preserveForm) {
        setForm(EMPTY_FORM);
        setDirty(false);
        setFormErrors([]);
      }
    } catch (error) {
      const problem = apiProblem(error);
      setDetail(null);
      setDetailError(problem?.title || 'This participant could not be loaded.');
    } finally {
      setDetailLoading(false);
    }
  }, [eventId]);

  useEffect(() => { void loadQueue(true); }, [loadQueue]);
  useEffect(() => { void loadDetail(selectedId); }, [loadDetail, selectedId]);

  const requestDraftDiscard = useCallback((action: () => void) => {
    if (!dirty) { action(); return; }
    pendingDraftActionRef.current = action;
    setDiscardDialogOpen(true);
  }, [dirty]);

  const closeDiscardDialog = () => {
    pendingDraftActionRef.current = null;
    setDiscardDialogOpen(false);
  };

  const discardDraft = () => {
    const action = pendingDraftActionRef.current;
    pendingDraftActionRef.current = null;
    setDiscardDialogOpen(false);
    setDirty(false);
    setForm(EMPTY_FORM);
    setFormErrors([]);
    action?.();
  };

  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    const anchorNavigation = (event: MouseEvent) => {
      const anchor = (event.target as Element | null)?.closest('a[href]') as HTMLAnchorElement | null;
      if (!anchor || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || anchor.target || anchor.hasAttribute('download')) return;
      const target = new URL(anchor.href);
      if (target.origin !== window.location.origin || target.href === window.location.href) return;
      event.preventDefault();
      requestDraftDiscard(() => navigate(`${target.pathname}${target.search}${target.hash}`));
    };
    const historyNavigation = () => {
      if (restoringHistoryRef.current) { restoringHistoryRef.current = false; return; }
      restoringHistoryRef.current = true;
      window.history.go(1);
      requestDraftDiscard(() => {
        restoringHistoryRef.current = true;
        window.history.back();
      });
    };
    window.addEventListener('beforeunload', beforeUnload);
    window.addEventListener('popstate', historyNavigation);
    document.addEventListener('click', anchorNavigation, true);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      window.removeEventListener('popstate', historyNavigation);
      document.removeEventListener('click', anchorNavigation, true);
    };
  }, [dirty, navigate, requestDraftDiscard]);

  const chooseParticipant = (item: ReviewQueueItem) => {
    if (item.registrationId === selectedId) { setMobileDetail(true); return; }
    requestDraftDiscard(() => {
      setSelectedId(item.registrationId);
      setMobileDetail(true);
      if (directRegistrationId) navigate(`/events/${eventId}/reviews`, { replace: true });
      window.setTimeout(() => detailHeadingRef.current?.focus(), 0);
    });
  };

  const updateForm = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setDirty(true);
  };

  const validateForm = () => {
    const errors: string[] = [];
    const summaryLength = form.clinicalSummary.trim().length;
    if (summaryLength < 10 || summaryLength > 2000) errors.push('Clinical summary must contain 10 to 2,000 characters.');
    if (form.recommendations.trim().length > 2000) errors.push('Recommendations cannot exceed 2,000 characters.');
    if (form.outcome === 'REFER' || form.outcome === 'URGENT_ESCALATION') {
      if (form.destinationName.trim().length < 2 || form.destinationName.trim().length > 200) errors.push('Referral destination must contain 2 to 200 characters.');
      if (form.reason.trim().length < 10 || form.reason.trim().length > 2000) errors.push('Referral reason must contain 10 to 2,000 characters.');
      if (form.instructions.trim().length > 2000) errors.push('Referral instructions cannot exceed 2,000 characters.');
    }
    if (!form.confirmed) errors.push('Confirm that the screening results and clinical decision were reviewed.');
    setFormErrors(errors);
    if (errors.length) window.setTimeout(() => errorSummaryRef.current?.focus(), 0);
    return errors.length === 0;
  };

  const decisionRequest = (): ReviewDecisionRequest => {
    const common = {
      contextVersion: detail!.contextVersion,
      confirmed: true as const,
      clinicalSummary: form.clinicalSummary.trim(),
      ...(form.recommendations.trim() ? { recommendations: form.recommendations.trim() } : {}),
    };
    if (form.outcome === 'REFER') return {
      ...common,
      outcome: 'REFER',
      urgency: form.urgency,
      referral: {
        destinationName: form.destinationName.trim(),
        reason: form.reason.trim(),
        ...(form.instructions.trim() ? { instructions: form.instructions.trim() } : {}),
      },
    };
    if (form.outcome === 'URGENT_ESCALATION') return {
      ...common,
      outcome: 'URGENT_ESCALATION',
      referral: {
        destinationName: form.destinationName.trim(),
        reason: form.reason.trim(),
        ...(form.instructions.trim() ? { instructions: form.instructions.trim() } : {}),
      },
    };
    return { ...common, outcome: form.outcome } as ReviewDecisionRequest;
  };

  const submitDecision = async (event: FormEvent) => {
    event.preventDefault();
    if (!detail || !validateForm()) return;
    setSubmitting(true);
    setFormErrors([]);
    try {
      const result = await reviewApi.decide(eventId, detail.participant.registrationId, decisionRequest());
      const reviewedRegistrationId = detail.participant.registrationId;
      const queue = queueData?.queue || [];
      const completedIndex = queue.findIndex((item) => item.registrationId === detail.participant.registrationId);
      const remaining = queue.filter((item) => item.registrationId !== detail.participant.registrationId);
      setQueueData((current) => current ? { ...current, queue: remaining } : current);
      setAnnouncement(`${result.review.outcome.replace(/_/g, ' ')} decision recorded for ${detail.participant.participantDisplayName}.`);
      setDirty(false);
      setForm(EMPTY_FORM);
      if (result.referral) {
        setSelectedId(reviewedRegistrationId);
        setMobileDetail(true);
        await loadDetail(reviewedRegistrationId);
        navigate(`/events/${eventId}/reviews/${reviewedRegistrationId}`, { replace: true });
        return;
      }
      const next = remaining[Math.min(Math.max(completedIndex, 0), Math.max(remaining.length - 1, 0))];
      setSelectedId(next?.registrationId || '');
      setDetail(next ? detail : null);
      if (!next) setMobileDetail(false);
      navigate(`/events/${eventId}/reviews`, { replace: true });
    } catch (error) {
      const problem = apiProblem(error);
      if (problem?.code === 'SCREENING_RESULTS_CHANGED') {
        await loadDetail(detail.participant.registrationId, true);
        setFormErrors(['Screening results changed. Reassess the refreshed results before submitting again.']);
      } else if (problem?.code === 'REVIEW_ALREADY_RECORDED') {
        await loadDetail(detail.participant.registrationId, true);
        setAnnouncement('Another reviewer already recorded this immutable decision. The record is now read-only.');
        setDirty(false);
        setFormErrors([]);
      } else if (problem?.errors?.length) {
        setFormErrors(problem.errors.map((item) => item.message));
      } else {
        setFormErrors([problem?.title || 'The decision could not be recorded. Your form has been preserved.']);
      }
      window.setTimeout(() => errorSummaryRef.current?.focus(), 0);
    } finally {
      setSubmitting(false);
    }
  };

  const queueItems = queueData?.queue || [];
  const referralRequired = form.outcome === 'REFER' || form.outcome === 'URGENT_ESCALATION';
  const eventName = queueData?.event.name || detail?.event.name || 'Clinical review';
  const openWithoutQr = () => {
    const participant = queueItems.find((item) => item.registrationId === selectedId) || queueItems[0];
    if (participant) chooseParticipant(participant);
    else setAnnouncement('No participant is currently available to open.');
  };
  const downloadReport = () => {
    if (!detail) return;
    const title = document.title;
    document.title = `${detail.participant.participantDisplayName} - clinical report`;
    window.print();
    document.title = title;
  };
  const exitConsole = () => {
    requestDraftDiscard(() => navigate(`/events/${eventId}`));
  };

  if (accessState) return <div className="review-gate-state">
    <ShieldCheckIcon />
    <h1>{accessState === 'permission' ? 'Reviewer assignment required' : 'Clinical review is unavailable'}</h1>
    <p>{accessState === 'permission' ? 'You need an active REVIEWER assignment on an active shift for this event.' : 'This workspace opens only while the event is in progress.'}</p>
    <button className="secondary" type="button" onClick={() => navigate(`/events/${eventId}`)}>Return to event</button>
  </div>;

  if (loadError && !queueData) return <div className="review-gate-state error-state">
    <ExclamationCircleIcon /><h1>Queue unavailable</h1><p>{loadError}</p>
    <button className="primary" type="button" onClick={() => void loadQueue(true)}>Try again</button>
  </div>;

  return <div className="clinical-console">
    <section className={`review-page ${mobileDetail ? 'show-detail' : ''}`}>
      <header className="review-page-heading">
        <div className="review-heading-copy">
          <button className="review-heading-back" type="button" onClick={exitConsole}><ArrowLeftIcon />Back to event</button>
          <div className="review-heading-title"><h1>Clinical review</h1><span className="clinical-console-status"><i aria-hidden="true" />Event live</span></div>
          <p><strong>{eventName}</strong> · Screening flags are rule recommendations. The reviewer makes the final clinical decision.</p>
        </div>
        <div className="review-heading-actions">
          <button className="secondary" type="button" onClick={openWithoutQr} disabled={queueLoading || queueItems.length === 0}><QrCodeIcon />Open without QR</button>
          <button className="secondary" type="button" onClick={() => void loadQueue()} disabled={refreshing}><ArrowPathIcon className={refreshing ? 'is-spinning' : ''} />{refreshing ? 'Refreshing…' : 'Refresh queue'}</button>
        </div>
      </header>

      <div className="review-announcer" role="status" aria-live="polite">{announcement}</div>

      <div className="review-workspace">
      <aside className="review-queue" aria-label="Actionable participants">
        <div className="review-queue-heading"><div><QueueListIcon /><strong>Ready for review</strong></div><span>{queueItems.length}</span></div>
        {queueLoading ? <QueueSkeleton /> : queueItems.length === 0 ? <div className="review-empty-queue"><ClipboardDocumentCheckIcon /><strong>Queue clear</strong><p>No participants currently meet the review criteria. Refresh after screening progresses.</p></div> : <ol>
          {queueItems.map((item) => <li key={item.registrationId}>
            <button type="button" className={selectedId === item.registrationId ? 'selected' : ''} aria-current={selectedId === item.registrationId ? 'true' : undefined} onClick={() => chooseParticipant(item)}>
              <span className="queue-person"><strong>{item.participantDisplayName}</strong><small>{item.queueNumber == null ? 'No queue number' : `Queue ${item.queueNumber}`}</small></span>
              <FlagBadge flag={item.highestFlag} />
              <span className="queue-progress">{item.completedStationCount}/{item.totalStationCount} stations · {item.readyReason === 'URGENT_FLAG' ? 'urgent early review' : 'screening complete'}</span>
            </button>
          </li>)}
        </ol>}
      </aside>

      <section className="review-detail" aria-label="Participant clinical review">
        <button className="review-mobile-back" type="button" onClick={() => setMobileDetail(false)}><ArrowLeftIcon />Back to queue</button>
        {detailLoading ? <DetailSkeleton /> : detailError ? <div className="review-detail-state" role="alert"><ExclamationCircleIcon /><h2>Participant unavailable</h2><p>{detailError}</p><button className="secondary" type="button" onClick={() => void loadDetail(selectedId)}>Retry</button></div> : !detail ? <div className="review-detail-state"><UserIcon /><h2>Select a participant</h2><p>Choose an actionable participant from the queue to inspect screening results and record a decision.</p></div> : <>
          <header className="review-participant-heading">
            <div><span>{detail.participant.queueNumber == null ? 'Unnumbered registration' : `Queue ${detail.participant.queueNumber}`}</span><h2 ref={detailHeadingRef} tabIndex={-1}>{detail.participant.participantDisplayName}</h2></div>
            <div className="review-participant-actions"><FlagBadge flag={detail.readiness.highestFlag} /><button className="secondary" type="button" onClick={downloadReport}><ArrowDownTrayIcon />Print clinical report</button></div>
          </header>

          <dl className="review-participant-facts">
            <div><IdentificationIcon /><dt>NRIC</dt><dd>{detail.participant.maskedNric}</dd></div>
            <div><ClockIcon /><dt>Date of birth</dt><dd>{new Date(`${detail.participant.dateOfBirth}T00:00:00`).toLocaleDateString()}</dd></div>
            <div><UserIcon /><dt>Gender</dt><dd>{genderLabel(detail.participant.gender)}</dd></div>
          </dl>

          <section className="screening-summary" aria-labelledby="screening-summary-title">
            <div className="review-section-heading"><div><h3 id="screening-summary-title">Screening summary</h3><p>{detail.readiness.completedStationCount} of {detail.readiness.totalStationCount} active stations recorded</p></div><span>{detail.readiness.readyReason === 'URGENT_FLAG' ? 'Early review: urgent flag' : 'Screening complete'}</span></div>
            <div className="screening-results">
              {detail.stations.map((station) => <article key={station.stationId} className={!station.result ? 'missing' : ''}>
                <header><div><span>Station {station.stationOrder}</span><h4>{station.stationName}</h4></div>{station.result ? <FlagBadge flag={station.result.overallFlag} /> : <span className="pending-label">Pending</span>}</header>
                <ResultData station={station} />
                {station.result?.flagSummary && <div className={`rule-recommendation flag-${station.result.overallFlag.toLowerCase()}`}><ExclamationTriangleIcon /><p><strong>Rule recommendation</strong>{station.result.flagSummary}. The reviewer makes the final decision.</p></div>}
              </article>)}
            </div>
          </section>

          {detail.existingReview ? <ReviewedDecision eventId={eventId} review={detail.existingReview} /> : !detail.readiness.ready ? <div className="review-not-ready" role="status"><ClockIcon /><div><strong>Not ready for a decision</strong><p>Complete all active stations or record an urgent station result first.</p></div></div> : <form className="decision-form" noValidate onSubmit={(event) => void submitDecision(event)}>
            <div className="review-section-heading"><div><h3>Reviewer notes and decision</h3><p>One immutable decision completes this registration.</p></div></div>

            {formErrors.length > 0 && <div className="review-error-summary" role="alert" tabIndex={-1} ref={errorSummaryRef}><ExclamationCircleIcon /><div><strong>Review the following</strong><ul>{formErrors.map((error) => <li key={error}>{error}</li>)}</ul></div></div>}

            <label className="review-field"><span>Clinical summary <small>{form.clinicalSummary.length}/2,000</small></span><textarea required minLength={10} maxLength={2000} rows={6} value={form.clinicalSummary} onChange={(event) => updateForm('clinicalSummary', event.target.value)} placeholder="Summarise clinically relevant findings and your assessment." /></label>
            <label className="review-field"><span>Recommendations <em>Optional</em> <small>{form.recommendations.length}/2,000</small></span><textarea maxLength={2000} rows={4} value={form.recommendations} onChange={(event) => updateForm('recommendations', event.target.value)} placeholder="Advice, monitoring guidance, or next steps." /></label>

            <fieldset className="outcome-options"><legend>Final decision</legend><div>{OUTCOMES.map((outcome) => <label className={`outcome-option outcome-${outcome.value.toLowerCase()} ${form.outcome === outcome.value ? 'selected' : ''}`} key={outcome.value}><input type="radio" name="outcome" value={outcome.value} checked={form.outcome === outcome.value} onChange={() => updateForm('outcome', outcome.value)} /><span><strong>{outcome.label}</strong><small>{outcome.description}</small></span></label>)}</div></fieldset>

            {referralRequired && <fieldset className="referral-fields"><legend>Draft referral</legend><p>Document generation and delivery are handled separately.</p>
              {form.outcome === 'REFER' && <label className="review-field"><span>Urgency</span><select value={form.urgency} onChange={(event) => updateForm('urgency', event.target.value as FormState['urgency'])}><option value="ROUTINE">Routine</option><option value="PRIORITY">Priority</option><option value="URGENT">Urgent</option></select></label>}
              {form.outcome === 'URGENT_ESCALATION' && <div className="emergency-urgency"><ExclamationTriangleIcon /><span><strong>Emergency urgency</strong>Assigned automatically for urgent escalation.</span></div>}
              <label className="review-field"><span>Destination name</span><input required minLength={2} maxLength={200} value={form.destinationName} onChange={(event) => updateForm('destinationName', event.target.value)} placeholder="Clinic, hospital, or specialist" /></label>
              <label className="review-field"><span>Referral reason <small>{form.reason.length}/2,000</small></span><textarea required minLength={10} maxLength={2000} rows={4} value={form.reason} onChange={(event) => updateForm('reason', event.target.value)} /></label>
              <label className="review-field"><span>Instructions <em>Optional</em> <small>{form.instructions.length}/2,000</small></span><textarea maxLength={2000} rows={3} value={form.instructions} onChange={(event) => updateForm('instructions', event.target.value)} /></label>
            </fieldset>}

            <label className="decision-confirm"><input type="checkbox" checked={form.confirmed} onChange={(event) => updateForm('confirmed', event.target.checked)} /><span><strong>I confirm this clinical decision</strong><small>I reviewed the current screening results and understand this record cannot be edited.</small></span></label>
            <div className="decision-actions"><button className="primary" type="submit" disabled={submitting}>{submitting ? 'Recording decision…' : `Record ${OUTCOMES.find((item) => item.value === form.outcome)?.label} decision`}</button></div>
          </form>}
        </>}
      </section>
      </div>
    </section>
    <AppDialog
      open={discardDialogOpen}
      onOpenChange={(open) => { if (!open) closeDiscardDialog(); }}
      title="Discard clinical review draft?"
      description="Your notes and unrecorded decision will be removed."
    >
      <div className="app-dialog-actions">
        <button className="secondary" type="button" data-dialog-autofocus onClick={closeDiscardDialog}>Keep editing</button>
        <button className="danger-button" type="button" onClick={discardDraft}>Discard draft</button>
      </div>
    </AppDialog>
    {detail && <ParticipantReport detail={detail} />}
  </div>;
}
