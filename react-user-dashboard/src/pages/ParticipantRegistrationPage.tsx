import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckCircleIcon,
  ClipboardDocumentCheckIcon,
  ExclamationTriangleIcon,
  PhoneIcon,
  TicketIcon,
  UserIcon,
} from "@heroicons/react/24/outline";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import type { ConsentFormVersion, EmergencyContact, EventSummary, Participant, Registration } from "../types";
import apiClient, { getApiError } from "../utils/apiClient";
import "./ParticipantPage.css";
import "./ParticipantCheckInPage.css";
import "./ParticipantRegistrationPage.css";

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

const OPEN_EVENT_STATUSES = new Set(["PUBLISHED", "UPCOMING", "ONGOING", "IN_PROGRESS"]);

function displayStatus(value: string) {
  return value.toLowerCase().split("_").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

function displayDate(value: string) {
  return new Date(value).toLocaleDateString("en-SG", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

export default function ParticipantRegistrationPage() {
  const { participantId = "" } = useParams();
  const [searchParams] = useSearchParams();
  const eventId = searchParams.get("eventId") ?? "";
  const profileLink = `/participants/${participantId}${eventId ? `?eventId=${encodeURIComponent(eventId)}` : ""}`;
  const [review, setReview] = useState<RegistrationReview | null>(null);
  const [existingRegistration, setExistingRegistration] = useState<Registration | null>(null);
  const [createdRegistration, setCreatedRegistration] = useState<Registration | null>(null);
  const [isLoading, setIsLoading] = useState(Boolean(eventId));
  const [isSubmitting, setIsSubmitting] = useState(false);
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
        setReview(reviewResponse.data);
        setExistingRegistration((registrationsResponse.data.registrations ?? []).find((registration: Registration) => registration.eventId === eventId) ?? null);
      })
      .catch((requestError: unknown) => {
        if (active) setError(getApiError(requestError, "Unable to load registration requirements."));
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => { active = false; };
  }, [eventId, participantId]);

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
  const canRegister = Boolean(review && !existingRegistration && !createdRegistration && !missingRequirement && !isSubmitting);

  async function createRegistration() {
    if (!canRegister) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const response = await apiClient.post(`/events/${eventId}/registrations`, { participantId }, {
        headers: { "Idempotency-Key": idempotencyKey.current },
      });
      setCreatedRegistration(response.data.registration);
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
        <section className="participant-v2-checkin-empty"><ExclamationTriangleIcon /><h1>Choose an event first</h1><p>Return to Participants, choose an open event, then open this participant to register them.</p><Link className="primary" to="/participants">Choose an event</Link></section>
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

  const registration = createdRegistration ?? existingRegistration;
  if (registration) {
    const wasJustCreated = Boolean(createdRegistration);
    return (
      <section className="participant-v2-page participant-v2-checkin participant-v2-registration" aria-labelledby="participant-v2-registration-title">
        <Link className="participant-v2-back" to={profileLink}><ArrowLeftIcon /> Back to participant profile</Link>
        <section className="participant-v2-checkin-success">
          <span><CheckCircleIcon /></span>
          <p>{wasJustCreated ? "Event registration created" : "Already registered for this event"}</p>
          <h1 id="participant-v2-registration-title">{review.participant.firstName} {review.participant.lastName} is registered</h1>
          <div className="participant-v2-checkin-ticket"><TicketIcon /><div><span>Queue number</span><strong>{registration.queueNumber}</strong></div><div><span>Status</span><strong>{displayStatus(registration.registrationStatus)}</strong></div></div>
          <p className="participant-v2-checkin-success-note">The participant is ready for event check-in when they arrive.</p>
          <div>
            <Link className="primary" to={`/participants/${participantId}/check-in?eventId=${encodeURIComponent(eventId)}`}>Start event check-in <ArrowRightIcon /></Link>
            <Link className="secondary" to={`/participants/registrations/${registration.id}/history`}>View registration history</Link>
          </div>
        </section>
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
          <div><span>Event</span><h2>{review.event.eventName}</h2><p>{displayDate(review.event.eventDate)} Â· {review.event.location}</p></div>
          <div><span>Participant</span><h2>{review.participant.firstName} {review.participant.lastName}</h2><p>{review.participant.participantReference}</p></div>
        </div>
        <section className="participant-v2-checkin-requirements" aria-labelledby="participant-v2-registration-requirements-title">
          <header><span>Readiness check</span><h2 id="participant-v2-registration-requirements-title">Registration requirements</h2></header>
          <div>{requirements.map((requirement) => <article key={requirement.label} className={requirement.complete ? "complete" : "missing"}><span>{requirement.complete ? <CheckCircleIcon /> : <ExclamationTriangleIcon />}</span><p>{requirement.label}</p><strong>{requirement.complete ? "Ready" : "Action needed"}</strong></article>)}</div>
        </section>
        <section className="participant-v2-checkin-records" aria-label="Participant registration records">
          <article><PhoneIcon /><div><span>Emergency contact</span><strong>{review.emergencyContact ? `${review.emergencyContact.contactName} Â· ${review.emergencyContact.phoneNumber}` : "No active emergency contact"}</strong></div></article>
          <article><ClipboardDocumentCheckIcon /><div><span>Consent</span><strong>{review.latestConsent ? `${displayStatus(review.latestConsent.consentStatus)} · Version ${review.latestConsent.consentFormVersion.versionNumber}` : "No consent recorded"}</strong></div></article>
        </section>
        <footer className="participant-v2-checkin-actions">
          <Link className="secondary" to={profileLink}>Back to profile</Link>
          <button className="primary" type="button" disabled={!canRegister} onClick={() => void createRegistration()}>{isSubmitting ? "Creating registration..." : "Confirm event registration"}</button>
        </footer>
        {!canRegister ? <p className="participant-v2-checkin-feedback" role="status">{missingRequirement ? `${missingRequirement} must be completed before registration.` : "Preparing registration..."}</p> : <p className="participant-v2-checkin-feedback ready"><UserIcon /> Queue number will be assigned after confirmation.</p>}
      </section>
    </section>
  );
}
