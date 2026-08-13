import {
  ArrowLeftIcon,
  CheckCircleIcon,
  ClipboardDocumentCheckIcon,
  ExclamationTriangleIcon,
  PhoneIcon,
  TicketIcon,
  UserIcon,
} from "@heroicons/react/24/outline";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import type { ConsentFormVersion, EmergencyContact, EventSummary, Participant, Registration } from "../../types";
import type { components } from "../../generated/api";
import apiClient, { getApiError } from "../../utils/apiClient";
import { AppDialog } from "../../components/AppDialog";
import { RegistrationQrPass } from "../../components/qr/RegistrationQrPass";
import "./ParticipantPage.css";
import "./ParticipantCheckInPage.css";
import "./ParticipantRegistrationPage.css";
import { clearRegistrationEvidence, getRegistrationStartedAt } from "./registrationEvidence";

type ConsentRecord = {
  id: string;
  consentStatus: string;
  consentFormVersion: ConsentFormVersion;
  withdrawals: Array<{ id: string; consentStatus: string }>;
};

type RegistrationReview = {
  participant: Participant;
  event: EventSummary;
  emergencyContact: EmergencyContact | null;
  latestConsent: ConsentRecord | null;
};

type RegistrationOutcome = {
  registrationId: string;
  queueNumber: number | null;
  route: components['schemas']['RegistrationRouteState'];
};

const OPEN_EVENT_STATUSES = new Set(["PUBLISHED", "UPCOMING", "ONGOING", "IN_PROGRESS"]);

function displayStatus(value: string) {
  return value.toLowerCase().split("_").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

function displayDate(value: string) {
  return new Date(value).toLocaleDateString("en-SG", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

export default function ParticipantRegistrationPage() {
  const { participantId = "" } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const eventId = searchParams.get("eventId") ?? "";
  const profileLink = `/participants/${participantId}${eventId ? `?eventId=${encodeURIComponent(eventId)}` : ""}`;
  const [review, setReview] = useState<RegistrationReview | null>(null);
  const [outcome, setOutcome] = useState<RegistrationOutcome | null>(null);
  const [isLoading, setIsLoading] = useState(Boolean(eventId));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [paperFormUsed, setPaperFormUsed] = useState(false);
  const [paperExceptionReason, setPaperExceptionReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const idempotencyKey = useRef(crypto.randomUUID());

  useEffect(() => {
    if (!eventId) return;
    let active = true;
    void Promise.all([
      apiClient.get(`/participants/${participantId}/events/${eventId}/review`),
      apiClient.get(`/participants/${participantId}/registrations`),
    ])
      .then(([reviewResponse, registrationsResponse]) => {
        if (!active) return;
        const existingRegistration = (registrationsResponse.data.registrations ?? [])
          .find((registration: Registration) => registration.eventId === eventId) ?? null;

        setReview(reviewResponse.data);
        if (existingRegistration) {
          navigate(`/participants/registrations/${existingRegistration.id}/qr?eventId=${encodeURIComponent(eventId)}`, { replace: true });
          return;
        }
      })
      .catch((requestError: unknown) => {
        if (active) setError(getApiError(requestError, "Unable to load registration requirements."));
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => { active = false; };
  }, [eventId, navigate, participantId]);

  const requirements = useMemo(() => {
    if (!review) return [];
    const consentAccepted = review.latestConsent?.consentStatus === "ACCEPTED"
      && !review.latestConsent.withdrawals.some((withdrawal) => withdrawal.consentStatus === "WITHDRAWN");
    return [
      { label: "Active participant record", complete: review.participant.status === "ACTIVE" },
      { label: "Open event", complete: OPEN_EVENT_STATUSES.has(review.event.status) },
      { label: "Active emergency contact", complete: Boolean(review.emergencyContact) },
      { label: "Accepted consent", complete: Boolean(consentAccepted) },
    ];
  }, [review]);

  const missingRequirement = requirements.find((item) => !item.complete)?.label;
  const canRegister = Boolean(review && !missingRequirement && !isSubmitting);

  async function createRegistration() {
    if (!canRegister) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const response = await apiClient.post<components['schemas']['RegistrationResponse']>(`/events/${eventId}/registrations`, {
        participantId,
        workflowStartedAt: getRegistrationStartedAt(eventId),
        paperFormUsed,
        paperExceptionReason: paperFormUsed ? paperExceptionReason.trim() : undefined,
      }, {
        headers: { "Idempotency-Key": idempotencyKey.current },
      });
      clearRegistrationEvidence(eventId);
      const registrationId = response.data.registration?.id ?? response.data.registrationId;
      if (review?.event.status !== "IN_PROGRESS" || !response.data.route) {
        navigate(`/participants/registrations/${registrationId}/qr?eventId=${encodeURIComponent(eventId)}`, { replace: true });
        return;
      }
      setOutcome({ registrationId, queueNumber: response.data.queueNumber, route: response.data.route });
      setShowConfirmation(false);
    } catch (requestError: unknown) {
      setError(getApiError(requestError, "Unable to create the event registration."));
    } finally {
      setIsSubmitting(false);
    }
  }

  if (!eventId) {
    return (
      <section className="participant-v2-page participant-v2-checkin participant-v2-registration">
        <Link className="participant-v2-back" to={`/participants/${participantId}`}><ArrowLeftIcon /> Back to participant profile</Link>
        <section className="participant-v2-checkin-empty"><ExclamationTriangleIcon /><h1>Choose an event first</h1><p>Return to Events, choose an open event, then start registration from that event.</p><Link className="primary" to="/events">Choose an event</Link></section>
      </section>
    );
  }

  if (isLoading) return <section className="participant-v2-page participant-v2-checkin participant-v2-registration"><p className="participant-v2-checkin-loading">Loading registration requirements...</p></section>;

  if (!review) {
    return (
      <section className="participant-v2-page participant-v2-checkin participant-v2-registration">
        <Link className="participant-v2-back" to={profileLink}><ArrowLeftIcon /> Back to participant profile</Link>
        <p className="participant-v2-alert participant-v2-checkin-alert" role="alert">{error ?? "Registration details are unavailable."}</p>
      </section>
    );
  }

  if (outcome) {
    return (
      <section className="participant-v2-page participant-v2-checkin participant-v2-registration participant-handoff-complete" aria-labelledby="participant-handoff-title">
        <header className="participant-v2-checkin-heading">
          <span><CheckCircleIcon /></span>
          <div><p>Registration complete</p><h1 id="participant-handoff-title">Route assigned</h1><small>The participant keeps this QR throughout the event.</small></div>
        </header>
        <section className="participant-handoff-summary">
          <div><span>Participant</span><strong>{review.participant.firstName} {review.participant.lastName}</strong></div>
          <div><span>Event</span><strong>{review.event.eventName}</strong></div>
          <div><span>Queue number</span><strong>{outcome.queueNumber != null ? `Q-${String(outcome.queueNumber).padStart(3, "0")}` : "Pending"}</strong></div>
          <div><span>Next step</span><strong>{outcome.route.currentStation?.stationName ?? (outcome.route.status === "NEEDS_STAFF_ACTION" ? "Staff assistance required" : "No screening route")}</strong></div>
        </section>
        <ol className="participant-route-summary" aria-label="Assigned screening route">
          {outcome.route.steps.map((step) => <li key={step.stationId}><span>{step.position}</span><strong>{step.stationName}</strong><small>{displayStatus(step.state)}</small></li>)}
          {outcome.route.steps.length > 0 ? <li><span>{outcome.route.steps.length + 1}</span><strong>Clinical review</strong><small>Final step</small></li> : null}
        </ol>
        <RegistrationQrPass registrationId={outcome.registrationId} />
        <div className="participant-handoff-actions">
          <button className="secondary" type="button" onClick={() => navigate(`/events/${encodeURIComponent(eventId)}/register`)}>Register next participant</button>
          <button className="secondary" type="button" onClick={() => navigate("/events")}>Return to dashboard</button>
        </div>
      </section>
    );
  }

  return (
    <section className="participant-v2-page participant-v2-checkin participant-v2-registration" aria-labelledby="participant-v2-registration-title">
      <Link className="participant-v2-back" to={profileLink}><ArrowLeftIcon /> Back to participant profile</Link>
      <header className="participant-v2-checkin-heading">
        <span><TicketIcon /></span>
        <div><p>Registration workspace</p><h1 id="participant-v2-registration-title">Register participant</h1><small>Confirm the participant is ready before creating their event registration.</small></div>
      </header>
      {error ? <p className="participant-v2-alert participant-v2-checkin-alert" role="alert">{error}</p> : null}
      <section className="participant-v2-checkin-card">
        <div className="participant-v2-checkin-overview">
          <div><span>Event</span><h2>{review.event.eventName}</h2><p>{displayDate(review.event.eventDate)} - {review.event.location}</p></div>
          <div><span>Participant</span><h2>{review.participant.firstName} {review.participant.lastName}</h2><p>{review.participant.participantReference}</p></div>
        </div>
        <section className="participant-v2-checkin-requirements" aria-labelledby="participant-v2-registration-requirements-title">
          <header><span>Readiness check</span><h2 id="participant-v2-registration-requirements-title">Registration requirements</h2></header>
          <div>{requirements.map((requirement) => <article key={requirement.label} className={requirement.complete ? "complete" : "missing"}><span>{requirement.complete ? <CheckCircleIcon /> : <ExclamationTriangleIcon />}</span><p>{requirement.label}</p><strong>{requirement.complete ? "Ready" : "Action needed"}</strong></article>)}</div>
        </section>
        <section className="participant-v2-checkin-records" aria-label="Participant registration records">
          <article><PhoneIcon /><div><span>Emergency contact</span><strong>{review.emergencyContact ? `${review.emergencyContact.contactName} - ${review.emergencyContact.phoneNumber}` : "No active emergency contact"}</strong></div></article>
          <article><ClipboardDocumentCheckIcon /><div><span>Consent</span><strong>{review.latestConsent ? `${displayStatus(review.latestConsent.consentStatus)} - Version ${review.latestConsent.consentFormVersion.versionNumber}` : "No consent recorded"}</strong></div></article>
        </section>
        <footer className="participant-v2-checkin-actions">
          <Link className="secondary" to={profileLink}>Back to profile</Link>
          <button className="primary" type="button" disabled={!canRegister} onClick={() => setShowConfirmation(true)}>Confirm participant</button>
        </footer>
        {!canRegister ? <p className="participant-v2-checkin-feedback" role="status">{missingRequirement ? `${missingRequirement} must be completed before registration.` : "Preparing registration..."}</p> : <p className="participant-v2-checkin-feedback ready"><UserIcon /> Queue number is assigned when the participant enters a station.</p>}
      </section>
      <AppDialog open={showConfirmation} onOpenChange={setShowConfirmation} title="Confirm participant registration" description="Review these details before creating the event registration.">
          <section className="participant-registration-dialog">
            <span><CheckCircleIcon /></span>
            <p>Final confirmation</p>
            <dl>
              <div><dt>Participant</dt><dd>{review.participant.firstName} {review.participant.lastName}</dd></div>
              <div><dt>Event</dt><dd>{review.event.eventName}</dd></div>
              <div><dt>Participant reference</dt><dd>{review.participant.participantReference}</dd></div>
            </dl>
            <label className="participant-registration-paper-exception">
              <input type="checkbox" checked={paperFormUsed} onChange={(event) => {
                setPaperFormUsed(event.target.checked);
                if (!event.target.checked) setPaperExceptionReason("");
              }} />
              <span>A paper form was required for this registration</span>
            </label>
            {paperFormUsed ? <label className="participant-registration-paper-reason"><span>Reason for paper exception</span><input required minLength={3} maxLength={200} value={paperExceptionReason} onChange={(event) => setPaperExceptionReason(event.target.value)} placeholder="For example, participant requested a paper copy" /></label> : null}
            <p className="participant-registration-dialog-note">{review.event.status === "IN_PROGRESS" ? "This creates the secure event QR and assigns a stable route using current station load." : "This creates the secure event QR. The route is assigned at event check-in."}</p>
            {error ? <p className="participant-v2-alert participant-v2-checkin-alert" role="alert">{error}</p> : null}
            <footer><button className="secondary" type="button" disabled={isSubmitting} onClick={() => setShowConfirmation(false)}>Cancel</button><button className="primary" type="button" disabled={isSubmitting || (paperFormUsed && paperExceptionReason.trim().length < 3)} onClick={() => void createRegistration()}>{isSubmitting ? "Creating registration..." : "Confirm registration"}</button></footer>
          </section>
      </AppDialog>
    </section>
  );
}
