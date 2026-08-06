import { ArrowLeftIcon, CheckCircleIcon, DocumentTextIcon, ExclamationTriangleIcon, PencilSquareIcon } from "@heroicons/react/24/outline";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { SignaturePad } from "../../components/SignaturePad";
import type { ConsentFormVersion, Participant } from "../../types";
import apiClient, { getApiError } from "../../utils/apiClient";
import "./ParticipantPage.css";
import "./ParticipantConsentPage.css";
import "./ParticipantConsentRefinement.css";

type ConsentFormState = {
  consentStatus: "ACCEPTED" | "DECLINED";
  signerType: "PARTICIPANT" | "PARENT" | "GUARDIAN" | "AUTHORISED_REPRESENTATIVE";
  signerName: string;
  signerRelationship: string;
  guardianContactName: string;
  guardianContactPhone: string;
  guardianContactEmail: string;
};

const signerLabels = {
  PARTICIPANT: { person: "Participant", name: "Participant name" },
  PARENT: { person: "Parent", name: "Parent name" },
  GUARDIAN: { person: "Guardian", name: "Guardian name" },
  AUTHORISED_REPRESENTATIVE: { person: "Authorised representative", name: "Authorised representative name" },
} as const;

const emptyConsent: ConsentFormState = {
  consentStatus: "ACCEPTED",
  signerType: "PARTICIPANT",
  signerName: "",
  signerRelationship: "",
  guardianContactName: "",
  guardianContactPhone: "",
  guardianContactEmail: "",
};

type EventConsentRecord = {
  id: string;
  consentStatus: string;
  signerName?: string | null;
  createdAt: string;
  eventId?: string;
  consentFormVersion?: ConsentFormVersion;
  event?: { id?: string; eventId?: string };
  withdrawals?: Array<{ consentStatus: string }>;
};

export default function ParticipantConsentPage() {
  const navigate = useNavigate();
  const { participantId = "" } = useParams();
  const [searchParams] = useSearchParams();
  const eventId = searchParams.get("eventId") ?? "";
  const [participant, setParticipant] = useState<Participant | null>(null);
  const [consentForm, setConsentForm] = useState<ConsentFormVersion | null>(null);
  const [existingAcceptedConsent, setExistingAcceptedConsent] = useState<EventConsentRecord | null>(null);
  const [form, setForm] = useState<ConsentFormState>(emptyConsent);
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const profileLink = `/participants/${participantId}${eventId ? `?eventId=${encodeURIComponent(eventId)}` : ""}`;
  const activeSigner = signerLabels[form.signerType];
  const requiresRepresentativeDetails = form.signerType !== "PARTICIPANT";

  const loadConsentPage = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const requestConfig = eventId ? { headers: { "X-Event-Id": eventId } } : undefined;
      const [participantResponse, formResponse, consentsResponse] = await Promise.all([
        apiClient.get(`/participants/${participantId}`, requestConfig),
        apiClient.get("/participants/active-consent-form", requestConfig),
        apiClient.get(`/participants/${participantId}/consents`, requestConfig),
      ]);
      setParticipant(participantResponse.data.participant);
      setConsentForm(formResponse.data.consentForm);
      const signedConsent = (consentsResponse.data.consents ?? []).find((consent: EventConsentRecord) => {
        const consentEventId = consent.eventId ?? consent.event?.id ?? consent.event?.eventId;
        const withdrawn = consent.withdrawals?.some((withdrawal) => withdrawal.consentStatus === "WITHDRAWN");
        return consentEventId === eventId && consent.consentStatus === "ACCEPTED" && !withdrawn;
      }) ?? null;
      setExistingAcceptedConsent(signedConsent);
    } catch (requestError: unknown) {
      setParticipant(null);
      setConsentForm(null);
      setExistingAcceptedConsent(null);
      setError(getApiError(requestError, "Unable to load the consent form."));
    } finally {
      setIsLoading(false);
    }
  }, [participantId]);

  useEffect(() => { void loadConsentPage(); }, [loadConsentPage]);

  const missingRequirement = useMemo(() => {
    if (!eventId) return "Choose an event in Participants before recording consent.";
    if (!form.signerName.trim()) return `${activeSigner.name} is required.`;
    if (requiresRepresentativeDetails && !form.signerRelationship.trim()) return "Relationship to participant is required.";
    if (requiresRepresentativeDetails && !form.guardianContactName.trim()) return `${activeSigner.person} contact name is required.`;
    if (requiresRepresentativeDetails && !form.guardianContactPhone.trim()) return `${activeSigner.person} contact phone is required.`;
    if (form.consentStatus === "ACCEPTED" && !signatureDataUrl) return "Capture an electronic signature before recording accepted consent.";
    return null;
  }, [activeSigner.name, activeSigner.person, eventId, form, requiresRepresentativeDetails, signatureDataUrl]);

  const canRecord = Boolean(consentForm && !missingRequirement && !submitting);

  function updateForm(updates: Partial<ConsentFormState>) {
    setForm((current) => ({ ...current, ...updates }));
    setError(null);
  }

  function chooseSigner(signerType: ConsentFormState["signerType"]) {
    setForm({ ...emptyConsent, signerType, consentStatus: form.consentStatus });
    setSignatureDataUrl(null);
    setError(null);
  }

  function chooseDecision(consentStatus: ConsentFormState["consentStatus"]) {
    updateForm({ consentStatus });
    setSignatureDataUrl(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!consentForm || missingRequirement) return;

    setSubmitting(true);
    setError(null);
    try {
      const signature = form.consentStatus === "ACCEPTED"
        ? (await apiClient.post("/signatures", { dataUrl: signatureDataUrl, eventId, purpose: "CONSENT", targetId: participantId })).data
        : {};
      await apiClient.post(`/participants/${participantId}/consents`, {
        ...form,
        ...signature,
        eventId,
        consentFormVersionId: consentForm.id,
      });
      navigate(form.consentStatus === "ACCEPTED"
        ? `/participants/${participantId}/register?eventId=${encodeURIComponent(eventId)}`
        : profileLink);
    } catch (requestError: unknown) {
      setError(getApiError(requestError, "Unable to record consent."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="participant-v2-page participant-v2-consent" aria-labelledby="participant-v2-consent-title">
      <Link className="participant-v2-back" to={profileLink}><ArrowLeftIcon /> Back to participant profile</Link>
      <header className="participant-v2-consent-heading">
        <span className="participant-v2-consent-icon"><DocumentTextIcon /></span>
        <div>
          <p>Registration workspace</p>
          <h1 id="participant-v2-consent-title">Consent and signature</h1>
          <span>{participant ? `Record consent for ${participant.firstName} ${participant.lastName}.` : "Review the approved form and record the signer’s decision."}</span>
        </div>
        <span className="participant-v2-consent-security">Secure record</span>
      </header>

      {!eventId ? <div className="participant-v2-consent-notice" role="alert"><ExclamationTriangleIcon /><div><strong>Event required</strong><p>Return to Participants, select an event, and open this participant again before recording consent.</p></div></div> : null}
      {error ? <p className="participant-v2-alert participant-v2-consent-alert" role="alert">{error}</p> : null}
      {isLoading ? <div className="participant-v2-consent-loading">Loading the approved consent form...</div> : null}
      {!isLoading && !consentForm ? (
        <section className="participant-v2-consent-unavailable">
          <h2>Consent form unavailable</h2>
          <p>The active consent form could not be displayed. Retry, or return to the participant profile.</p>
          <div><button className="primary" type="button" onClick={() => void loadConsentPage()}>Retry</button><Link className="secondary" to={profileLink}>Return to profile</Link></div>
        </section>
      ) : null}

      {!isLoading && consentForm && existingAcceptedConsent ? (
        <section className="participant-v2-consent-signed" aria-label="Recorded consent">
          <span><CheckCircleIcon /></span>
          <div>
            <p>Consent already signed</p>
            <h2>This participant has accepted the current consent requirement for this event.</h2>
            <dl>
              <div><dt>Signed by</dt><dd>{existingAcceptedConsent.signerName || "Recorded signer"}</dd></div>
              <div><dt>Recorded</dt><dd>{new Date(existingAcceptedConsent.createdAt).toLocaleString("en-SG")}</dd></div>
              <div><dt>Form version</dt><dd>{existingAcceptedConsent.consentFormVersion?.versionNumber ?? consentForm.versionNumber}</dd></div>
            </dl>
            <div><Link className="secondary" to={profileLink}>Back to profile</Link><Link className="primary" to={`/participants/${participantId}/register?eventId=${encodeURIComponent(eventId)}`}>Continue to QR pass</Link></div>
          </div>
        </section>
      ) : null}

      {!isLoading && consentForm && !existingAcceptedConsent ? (
        <form className="participant-v2-consent-layout" onSubmit={submit} noValidate>
          <section className="participant-v2-consent-document" aria-labelledby="consent-document-title">
            <div className="participant-v2-consent-document-title"><div><span>01 · Approved form</span><h2 id="consent-document-title">{consentForm.title}</h2><p>Read the current approved version before recording a decision.</p></div><strong>Version {consentForm.versionNumber}</strong></div>
            <p className="participant-v2-consent-code">{consentForm.formCode}</p>
            <div className="participant-v2-consent-content">{consentForm.contentText ?? "The approved consent document is stored securely for this version."}</div>
          </section>

          <section className="participant-v2-consent-record" aria-labelledby="consent-record-title">
            <header><div><span>02 · Record decision</span><h2 id="consent-record-title">Signer and approval</h2><p>Confirm who is signing and capture the decision.</p></div><strong>Required</strong></header>

            <div className="participant-v2-consent-choice-group" aria-label="Consent decision">
              <button className={form.consentStatus === "ACCEPTED" ? "selected" : ""} type="button" onClick={() => chooseDecision("ACCEPTED")}><CheckCircleIcon />Accept consent</button>
              <button className={form.consentStatus === "DECLINED" ? "selected declined" : ""} type="button" onClick={() => chooseDecision("DECLINED")}><ExclamationTriangleIcon />Decline</button>
            </div>

            <label className="participant-v2-consent-field">Consent given by
              <select value={form.signerType} onChange={(event) => chooseSigner(event.target.value as ConsentFormState["signerType"])}>
                <option value="PARTICIPANT">Participant</option>
                <option value="PARENT">Parent</option>
                <option value="GUARDIAN">Guardian</option>
                <option value="AUTHORISED_REPRESENTATIVE">Authorised representative</option>
              </select>
            </label>
            <label className="participant-v2-consent-field">{activeSigner.name}
              <input value={form.signerName} onChange={(event) => updateForm({ signerName: event.target.value })} placeholder={`Enter ${activeSigner.name.toLowerCase()}`} maxLength={150} />
            </label>

            {requiresRepresentativeDetails ? <div className="participant-v2-consent-representative-fields">
              <label className="participant-v2-consent-field">Relationship to participant<input value={form.signerRelationship} onChange={(event) => updateForm({ signerRelationship: event.target.value })} maxLength={60} /></label>
              <label className="participant-v2-consent-field">{activeSigner.person} contact name<input value={form.guardianContactName} onChange={(event) => updateForm({ guardianContactName: event.target.value })} maxLength={150} /></label>
              <label className="participant-v2-consent-field">{activeSigner.person} contact phone<input type="tel" value={form.guardianContactPhone} onChange={(event) => updateForm({ guardianContactPhone: event.target.value })} maxLength={30} /></label>
              <label className="participant-v2-consent-field">{activeSigner.person} contact email <small>optional</small><input type="email" value={form.guardianContactEmail} onChange={(event) => updateForm({ guardianContactEmail: event.target.value })} maxLength={255} /></label>
            </div> : null}

            {form.consentStatus === "ACCEPTED" ? <div className="participant-v2-consent-signature">
              <div><span>Electronic signature</span><p>{activeSigner.person} signs the approved form above.</p></div>
              <SignaturePad key={`${form.signerType}-${form.consentStatus}`} onChange={setSignatureDataUrl} />
            </div> : <div className="participant-v2-consent-decline"><ExclamationTriangleIcon /><p>Declining consent records the decision but does not create a registration.</p></div>}

            <div className="participant-v2-consent-review"><PencilSquareIcon /><p><strong>Review:</strong> {form.signerName || `${activeSigner.name} is required`} will {form.consentStatus.toLowerCase()} version {consentForm.versionNumber} as the {activeSigner.person.toLowerCase()} signer.</p></div>
            <footer className="participant-v2-consent-actions">
              <Link className="secondary" to={profileLink}>Cancel</Link>
              <button className="primary participant-v2-consent-submit" type="submit" disabled={!canRecord}>{submitting ? "Recording..." : form.consentStatus === "ACCEPTED" ? "Record consent" : "Record decline"}</button>
            </footer>
            {!canRecord ? <p className="participant-v2-consent-feedback" role="status">{missingRequirement ?? "The consent form is still loading."}</p> : null}
          </section>
        </form>
      ) : null}
    </section>
  );
}

