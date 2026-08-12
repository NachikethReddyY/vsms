import {
  ArrowLeftIcon,
  BuildingOffice2Icon,
  CheckCircleIcon,
  ClipboardDocumentCheckIcon,
  ExclamationTriangleIcon,
  PhoneIcon,
  TicketIcon,
  UserIcon,
} from "@heroicons/react/24/outline";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import type { ConsentFormVersion, EmergencyContact, EventSummary, Participant, Registration } from "../../types";
import apiClient, { getApiError } from "../../utils/apiClient";
import { LiveStationHandoffPicker, type LiveStationHandoffStation } from "../../components/qr/LiveStationHandoffPicker";
import { RegistrationQrPass } from "../../components/qr/RegistrationQrPass";
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

type RegistrationStation = LiveStationHandoffStation;

type QueueHandoff = {
  registrationId: string;
  queueNumber: number;
  nextStation: string;
  assignedStation: { id: string; name: string; status: string };
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
  const [registrationId, setRegistrationId] = useState<string | null>(null);
  const [stations, setStations] = useState<RegistrationStation[]>([]);
  const [isLoadingStations, setIsLoadingStations] = useState(false);
  const [selectedStationId, setSelectedStationId] = useState<string | null>(null);
  const [handoff, setHandoff] = useState<QueueHandoff | null>(null);
  const [isLoading, setIsLoading] = useState(Boolean(eventId));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const idempotencyKey = useRef(crypto.randomUUID());

  const loadStations = useCallback(async () => {
    setIsLoadingStations(true);
    setError(null);
    try {
      const response = await apiClient.get(`/queues/events/${eventId}/stations`);
      setStations(response.data.stations ?? []);
    } catch (requestError: unknown) {
      setError(getApiError(requestError, "Unable to load the available stations."));
    } finally {
      setIsLoadingStations(false);
    }
  }, [eventId]);

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
          if (existingRegistration.queueNumber != null || reviewResponse.data.event.status !== "IN_PROGRESS") {
            navigate(`/participants/registrations/${existingRegistration.id}/qr?eventId=${encodeURIComponent(eventId)}`, { replace: true });
            return;
          }
          setRegistrationId(existingRegistration.id);
          void loadStations();
        }
      })
      .catch((requestError: unknown) => {
        if (active) setError(getApiError(requestError, "Unable to load registration requirements."));
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => { active = false; };
  }, [eventId, loadStations, navigate, participantId]);

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
      const response = await apiClient.post(`/events/${eventId}/registrations`, { participantId }, {
        headers: { "Idempotency-Key": idempotencyKey.current },
      });
      const registrationId = response.data.registration?.id ?? response.data.registrationId;
      if (review?.event.status !== "IN_PROGRESS") {
        navigate(`/participants/registrations/${registrationId}/qr?eventId=${encodeURIComponent(eventId)}`, { replace: true });
        return;
      }
      setRegistrationId(registrationId);
      setShowConfirmation(false);
      await loadStations();
    } catch (requestError: unknown) {
      setError(getApiError(requestError, "Unable to create the event registration."));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function createQueueHandoff(station: RegistrationStation) {
    if (!registrationId || !station.selectable || selectedStationId) return;
    setSelectedStationId(station.stationId);
    setError(null);
    try {
      const response = await apiClient.post(
        `/queues/events/${eventId}/stations/${station.stationId}/handoff`,
        { registrationId },
        { headers: { "Idempotency-Key": crypto.randomUUID() } },
      );
      setHandoff(response.data);
    } catch (requestError: unknown) {
      setError(getApiError(requestError, "Unable to create the queue handoff. Please select a station again."));
    } finally {
      setSelectedStationId(null);
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

  if (handoff) {
    return (
      <section className="participant-v2-page participant-v2-checkin participant-v2-registration participant-handoff-complete" aria-labelledby="participant-handoff-title">
        <header className="participant-v2-checkin-heading">
          <span><CheckCircleIcon /></span>
          <div><p>Registration complete</p><h1 id="participant-handoff-title">Registration and handoff completed</h1><small>The participant is assigned to their next station.</small></div>
        </header>
        <section className="participant-handoff-summary">
          <div><span>Participant</span><strong>{review.participant.firstName} {review.participant.lastName}</strong></div>
          <div><span>Event</span><strong>{review.event.eventName}</strong></div>
          <div><span>Queue number</span><strong>Q-{String(handoff.queueNumber).padStart(3, "0")}</strong></div>
          <div><span>Assigned station</span><strong>{handoff.assignedStation.name}</strong></div>
        </section>
        <RegistrationQrPass registrationId={handoff.registrationId} />
        <div className="participant-handoff-actions">
          <button className="secondary" type="button" onClick={() => navigate(`/events/${encodeURIComponent(eventId)}/register`)}>Register next participant</button>
          <button className="secondary" type="button" onClick={() => navigate("/events")}>Return to dashboard</button>
        </div>
      </section>
    );
  }

  if (registrationId) {
    return (
      <section className="participant-v2-page participant-v2-checkin participant-v2-registration participant-station-selection" aria-labelledby="station-selection-title">
        <Link className="participant-v2-back" to={profileLink}><ArrowLeftIcon /> Back to participant profile</Link>
        <header className="participant-v2-checkin-heading">
          <span><BuildingOffice2Icon /></span>
          <div><p>Registration complete</p><h1 id="station-selection-title">Select a station</h1><small>Choose where {review.participant.firstName} {review.participant.lastName} should go next.</small></div>
        </header>
        {error ? <p className="participant-v2-alert participant-v2-checkin-alert" role="alert">{error}</p> : null}
        {isLoadingStations ? <p className="participant-v2-checkin-loading">Loading station availability...</p> : null}
        {!isLoadingStations ? <LiveStationHandoffPicker
          stations={stations}
          pendingStationId={selectedStationId}
          onSelect={(station) => void createQueueHandoff(station)}
          actionLabel="Assign participant"
        /> : null}
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
      {showConfirmation ? (
        <div className="participant-registration-backdrop" role="presentation">
          <section className="participant-registration-dialog" role="dialog" aria-modal="true" aria-labelledby="registration-confirm-title">
            <span><CheckCircleIcon /></span>
            <p>Final confirmation</p>
            <h2 id="registration-confirm-title">Confirm participant registration</h2>
            <dl>
              <div><dt>Participant</dt><dd>{review.participant.firstName} {review.participant.lastName}</dd></div>
              <div><dt>Event</dt><dd>{review.event.eventName}</dd></div>
              <div><dt>Participant reference</dt><dd>{review.participant.participantReference}</dd></div>
            </dl>
            <p className="participant-registration-dialog-note">{review.event.status === "IN_PROGRESS" ? "This creates the event registration, then lets you select the participant's next station." : "This creates the event registration and secure QR pass. A station is assigned when the event is in progress."}</p>
            {error ? <p className="participant-v2-alert participant-v2-checkin-alert" role="alert">{error}</p> : null}
            <footer><button className="secondary" type="button" disabled={isSubmitting} onClick={() => setShowConfirmation(false)}>Cancel</button><button className="primary" type="button" disabled={isSubmitting} onClick={() => void createRegistration()}>{isSubmitting ? "Creating registration..." : review.event.status === "IN_PROGRESS" ? "Confirm and select station" : "Confirm registration"}</button></footer>
          </section>
        </div>
      ) : null}
    </section>
  );
}
