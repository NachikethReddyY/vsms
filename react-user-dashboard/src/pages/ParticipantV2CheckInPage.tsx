import { ArrowLeftIcon, ArrowRightIcon, CheckCircleIcon, ClipboardDocumentCheckIcon, ExclamationTriangleIcon, PhoneIcon, TicketIcon, UserIcon } from "@heroicons/react/24/outline";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import type { ConsentFormVersion, EmergencyContact, EventSummary, Participant, Registration } from "../types";
import apiClient, { getApiError } from "../utils/apiClient";
import "./ParticipantV2Page.css";
import "./ParticipantV2CheckInPage.css";

type ConsentRecord = {
  id: string;
  consentStatus: string;
  consentFormVersion: ConsentFormVersion;
  withdrawals: Array<{ id: string; consentStatus: string }>;
};

type CheckInReview = {
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

export default function ParticipantV2CheckInPage() {
  const { participantId = "" } = useParams();
  const [searchParams] = useSearchParams();
  const eventId = searchParams.get("eventId") ?? "";
  const profileLink = `/participants-v2/${participantId}${eventId ? `?eventId=${encodeURIComponent(eventId)}` : ""}`;
  const [review, setReview] = useState<CheckInReview | null>(null);
  const [existingRegistration, setExistingRegistration] = useState<Registration | null>(null);
  const [createdRegistration, setCreatedRegistration] = useState<Registration | null>(null);
  const [checkedInRegistration, setCheckedInRegistration] = useState<Registration | null>(null);
  const [isLoading, setIsLoading] = useState(Boolean(eventId));
  const [submitting, setSubmitting] = useState(false);
  const [isCheckingIn, setIsCheckingIn] = useState(false);
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
        if (active) setError(getApiError(requestError, "Unable to load event check-in details."));
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => { active = false; };
  }, [eventId, participantId]);

  const requirements = useMemo(() => {
    if (!review) return [];
    const consentAccepted = review.latestConsent?.consentStatus === "ACCEPTED"
      && !review.latestConsent.withdrawals.some((item) => item.consentStatus === "WITHDRAWN");
    return [
      { label: "Active participant record", complete: review.participant.status === "ACTIVE" },
      { label: "Open event", complete: OPEN_EVENT_STATUSES.has(review.event.status) },
      { label: "Active emergency contact", complete: Boolean(review.emergencyContact) },
      { label: "Accepted consent", complete: Boolean(consentAccepted) },
    ];
  }, [review]);

  const missingRequirement = requirements.find((item) => !item.complete)?.label;
  const canCreateRegistration = Boolean(review && !existingRegistration && !createdRegistration && !missingRequirement && !submitting);

  async function createRegistration() {
    if (!canCreateRegistration) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await apiClient.post(`/events/${eventId}/registrations`, { participantId }, {
        headers: { "Idempotency-Key": idempotencyKey.current },
      });
      setCreatedRegistration(response.data.registration);
    } catch (requestError: unknown) {
      setError(getApiError(requestError, "Unable to create the event registration."));
    } finally {
      setSubmitting(false);
    }
  }

  async function markAsCheckedIn(registration: Registration) {
    if (registration.registrationStatus === "CHECKED_IN" || isCheckingIn) return;
    setIsCheckingIn(true);
    setError(null);
    try {
      const response = await apiClient.post("/qr/manual-checkin", {
        registrationId: registration.id,
        eventId,
      });
      setCheckedInRegistration(response.data.data);
    } catch (requestError: unknown) {
      setError(getApiError(requestError, "Unable to check in this participant."));
    } finally {
      setIsCheckingIn(false);
    }
  }

  if (!eventId) {
    return (
      <section className="participant-v2-page participant-v2-checkin">
        <Link className="participant-v2-back" to={`/participants-v2/${participantId}`}><ArrowLeftIcon /> Back to participant profile</Link>
        <section className="participant-v2-checkin-empty"><ExclamationTriangleIcon /><h1>Choose an event first</h1><p>Return to Participants V2, choose an open event, then open this participant to start an event check-in.</p><Link className="primary" to="/participants-v2">Choose an event</Link></section>
      </section>
    );
  }

  if (isLoading) {
    return <section className="participant-v2-page participant-v2-checkin"><p className="participant-v2-checkin-loading">Loading event check-in...</p></section>;
  }

  if (!review) {
    return (
      <section className="participant-v2-page participant-v2-checkin">
        <Link className="participant-v2-back" to={profileLink}><ArrowLeftIcon /> Back to participant profile</Link>
        <p className="participant-v2-alert participant-v2-checkin-alert" role="alert">{error ?? "Event check-in details are unavailable."}</p>
      </section>
    );
  }

  const registration = checkedInRegistration ?? createdRegistration ?? existingRegistration;
  if (registration) {
    const wasJustCreated = Boolean(createdRegistration);
    const isCheckedIn = registration.registrationStatus === "CHECKED_IN";
    return (
      <section className="participant-v2-page participant-v2-checkin" aria-labelledby="participant-v2-checkin-title">
        <Link className="participant-v2-back" to={profileLink}><ArrowLeftIcon /> Back to participant profile</Link>
        <section className="participant-v2-checkin-success">
          <span><CheckCircleIcon /></span>
          <p>{isCheckedIn ? "Participant checked in" : wasJustCreated ? "Event registration created" : "Already registered for this event"}</p>
          <h1 id="participant-v2-checkin-title">{review.participant.firstName} {review.participant.lastName} {isCheckedIn ? "is checked in" : "is ready for check-in"}</h1>
          <div className="participant-v2-checkin-ticket"><TicketIcon /><div><span>Queue number</span><strong>{registration.queueNumber}</strong></div><div><span>Status</span><strong>{displayStatus(registration.registrationStatus)}</strong></div></div>
          <p className="participant-v2-checkin-success-note">{isCheckedIn ? "Attendance was recorded securely. The QR pass remains available for the participant's event record." : "A duplicate registration was not created. Confirm their arrival below, or continue to the QR handoff."}</p>
          <div>
            {!isCheckedIn ? <button className="primary" type="button" disabled={isCheckingIn} onClick={() => void markAsCheckedIn(registration)}>{isCheckingIn ? "Checking in..." : "Mark participant as checked in"}</button> : null}
            <Link className={isCheckedIn ? "primary" : "secondary"} to={`/registrations/${registration.id}/qr`}>View QR pass <ArrowRightIcon /></Link>
            <Link className="secondary" to={`/registrations/${registration.id}/history`}>View registration history</Link>
          </div>
          {error ? <p className="participant-v2-alert participant-v2-checkin-alert" role="alert">{error}</p> : null}
        </section>
      </section>
    );
  }

  return (
    <section className="participant-v2-page participant-v2-checkin" aria-labelledby="participant-v2-checkin-title">
      <Link className="participant-v2-back" to={profileLink}><ArrowLeftIcon /> Back to participant profile</Link>
      <header className="participant-v2-checkin-heading">
        <span><TicketIcon /></span>
        <div><p>Registration workspace · V2</p><h1 id="participant-v2-checkin-title">Event check-in</h1><small>Confirm this returning participant’s event registration.</small></div>
      </header>

      {error ? <p className="participant-v2-alert participant-v2-checkin-alert" role="alert">{error}</p> : null}
      <section className="participant-v2-checkin-card">
        <div className="participant-v2-checkin-overview">
          <div><span>Event</span><h2>{review.event.eventName}</h2><p>{displayDate(review.event.eventDate)} · {review.event.location}</p></div>
          <div><span>Participant</span><h2>{review.participant.firstName} {review.participant.lastName}</h2><p>{review.participant.participantReference}</p></div>
        </div>

        <section className="participant-v2-checkin-requirements" aria-labelledby="participant-v2-checkin-requirements-title">
          <header><span>Readiness check</span><h2 id="participant-v2-checkin-requirements-title">Registration requirements</h2></header>
          <div>{requirements.map((requirement) => <article key={requirement.label} className={requirement.complete ? "complete" : "missing"}><span>{requirement.complete ? <CheckCircleIcon /> : <ExclamationTriangleIcon />}</span><p>{requirement.label}</p><strong>{requirement.complete ? "Ready" : "Action needed"}</strong></article>)}</div>
        </section>

        <section className="participant-v2-checkin-records" aria-label="Participant registration records">
          <article><PhoneIcon /><div><span>Emergency contact</span><strong>{review.emergencyContact ? `${review.emergencyContact.contactName} · ${review.emergencyContact.phoneNumber}` : "No active emergency contact"}</strong></div></article>
          <article><ClipboardDocumentCheckIcon /><div><span>Consent</span><strong>{review.latestConsent ? `${displayStatus(review.latestConsent.consentStatus)} · Version ${review.latestConsent.consentFormVersion.versionNumber}` : "No consent recorded"}</strong></div></article>
        </section>

        <footer className="participant-v2-checkin-actions">
          <Link className="secondary" to={profileLink}>Back to profile</Link>
          <button className="primary" type="button" disabled={!canCreateRegistration} onClick={() => void createRegistration()}>{submitting ? "Creating registration..." : "Confirm event registration"}</button>
        </footer>
        {!canCreateRegistration ? <p className="participant-v2-checkin-feedback" role="status">{missingRequirement ? `${missingRequirement} must be completed before registration.` : "Preparing registration..."}</p> : <p className="participant-v2-checkin-feedback ready"><UserIcon /> Queue number will be assigned after confirmation.</p>}
      </section>
    </section>
  );
}
