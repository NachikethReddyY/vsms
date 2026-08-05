import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CalendarDaysIcon,
  ClipboardDocumentCheckIcon,
  PhoneIcon,
  UserIcon,
} from "@heroicons/react/24/outline";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import type { ConsentFormVersion, EmergencyContact, EventSummary, Participant, Registration } from "../types";
import apiClient, { getApiError } from "../utils/apiClient";
import "./ParticipantPage.css";
import "./ParticipantProfilePage.css";
import "./ParticipantProfileMarkers.css";

function displayStatus(value: string) {
  return value.toLowerCase().split("_").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

function displayDate(value: string) {
  return new Date(value).toLocaleDateString("en-SG", { day: "numeric", month: "short", year: "numeric" });
}

type ConsentRecord = {
  id: string;
  consentStatus: string;
  createdAt: string;
  consentFormVersion: ConsentFormVersion;
  event: EventSummary;
  withdrawals: Array<{ id: string; consentStatus: string }>;
};

export default function ParticipantProfilePage() {
  const { participantId = "" } = useParams();
  const [searchParams] = useSearchParams();
  const eventId = searchParams.get("eventId") ?? "";
  const [participant, setParticipant] = useState<Participant | null>(null);
  const [contacts, setContacts] = useState<EmergencyContact[]>([]);
  const [consents, setConsents] = useState<ConsentRecord[]>([]);
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.all([
      apiClient.get(`/participants/${participantId}`),
      apiClient.get(`/participants/${participantId}/emergency-contacts`),
      apiClient.get(`/participants/${participantId}/consents`),
      apiClient.get(`/participants/${participantId}/registrations`),
    ])
      .then(([participantResponse, contactsResponse, consentsResponse, registrationsResponse]) => {
        if (!active) return;
        setParticipant(participantResponse.data.participant);
        setContacts(contactsResponse.data.contacts ?? []);
        setConsents(consentsResponse.data.consents ?? []);
        setRegistrations(registrationsResponse.data.registrations ?? []);
      })
      .catch((requestError: unknown) => {
        if (active) setError(getApiError(requestError, "Participant details could not be loaded."));
      });
    return () => { active = false; };
  }, [participantId]);

  const primaryContact = useMemo(
    () => contacts.find((contact) => contact.status === "ACTIVE" && contact.isPrimary) ?? contacts.find((contact) => contact.status === "ACTIVE"),
    [contacts],
  );
  const latestEventConsent = useMemo(
    () => eventId ? consents.find((consent) => consent.event.id === eventId) : undefined,
    [consents, eventId],
  );
  // A withdrawal is stored as the latest consent record, rather than only as
  // a nested item on the original accepted consent.
  const consentWithdrawn = latestEventConsent?.consentStatus === "WITHDRAWN"
    || latestEventConsent?.withdrawals.some((withdrawal) => withdrawal.consentStatus === "WITHDRAWN") === true;
  const consentStatus = !eventId
    ? "Choose an event"
    : consentWithdrawn
      ? "Withdrawn"
      : latestEventConsent
        ? displayStatus(latestEventConsent.consentStatus)
        : "Not recorded";
  const consentStatusClass = consentStatus.toLowerCase().replace(/ /g, "-");
  const consentMissing = Boolean(eventId) && (!latestEventConsent || consentWithdrawn);
  const searchLink = `/participants${eventId ? `?eventId=${encodeURIComponent(eventId)}` : ""}`;
  const registrationForEvent = registrations.find((registration) => registration.eventId === eventId);
  const registrationLink = `/participants/${participantId}/register${eventId ? `?eventId=${encodeURIComponent(eventId)}` : ""}`;
  const checkInLink = `/participants/${participantId}/check-in${eventId ? `?eventId=${encodeURIComponent(eventId)}` : ""}`;

  if (!participant && !error) {
    return <section className="participant-v2-page participant-v2-profile"><p className="participant-v2-profile-loading">Loading participant profile...</p></section>;
  }

  if (!participant) {
    return (
      <section className="participant-v2-page participant-v2-profile">
        <Link className="participant-v2-back" to={searchLink}><ArrowLeftIcon /> Back to participants</Link>
        <p className="participant-v2-alert participant-v2-profile-alert" role="alert">{error}</p>
      </section>
    );
  }

  return (
    <section className="participant-v2-page participant-v2-profile" aria-labelledby="participant-v2-profile-title">
      <Link className="participant-v2-back" to={searchLink}><ArrowLeftIcon /> Back to participants</Link>
      <header className="participant-v2-profile-hero">
        <div className="participant-v2-profile-identity">
          <span className="participant-v2-profile-avatar" aria-hidden="true">{`${participant.firstName[0] ?? ""}${participant.lastName[0] ?? ""}`.toUpperCase() || "P"}</span>
          <div>
            <p>Registration workspace</p>
            <h1 id="participant-v2-profile-title">{participant.firstName} {participant.lastName}</h1>
            <span>{participant.contactNumber}{participant.email ? ` · ${participant.email}` : ""}</span>
          </div>
        </div>
        <span className="participant-v2-profile-status">{displayStatus(participant.status)}</span>
        <dl className="participant-v2-profile-facts">
          <div><dt>Participant reference</dt><dd>{participant.participantReference}</dd></div>
          <div><dt>Registrations</dt><dd>{registrations.length}</dd></div>
          <div><dt>Preferred language</dt><dd>{participant.preferredLanguage ?? "Not recorded"}</dd></div>
        </dl>
      </header>

      <section className="participant-v2-profile-card" aria-label="Participant profile">
        <div className="participant-v2-profile-actions">
          <Link className="secondary" to={`/participants/${participantId}/edit${eventId ? `?eventId=${encodeURIComponent(eventId)}` : ""}`}>Edit participant details</Link>
          {eventId ? <Link className="secondary" to={`/participants/${participantId}/consent?eventId=${encodeURIComponent(eventId)}`}>Record consent</Link> : null}
          <Link className="primary" to={eventId ? (registrationForEvent ? checkInLink : registrationLink) : searchLink}>{eventId ? (registrationForEvent ? "Start event check-in" : "Register for event") : "Choose an event"} <ArrowRightIcon /></Link>
        </div>

        <section className="participant-v2-profile-details" aria-label="Participant details">
          <div><span>Date of birth</span><strong>{displayDate(participant.dateOfBirth)}</strong></div>
          <div><span>Contact number</span><strong>{participant.contactNumber}</strong></div>
          <div><span>Email address</span><strong>{participant.email ?? "Not recorded"}</strong></div>
          <div><span>Accessibility notes</span><strong>{participant.accessibilityNotes ?? "None recorded"}</strong></div>
        </section>

        <div className="participant-v2-profile-summary">
          <article className={primaryContact ? "complete" : "missing"}>
            <PhoneIcon />
            <div>
              <span>Emergency contact</span>
              {!primaryContact ? <em className="participant-v2-profile-required">Required</em> : null}
              <h2>{primaryContact ? primaryContact.contactName : "Not recorded"}</h2>
              <p>{primaryContact ? `${primaryContact.relationship} · ${primaryContact.phoneNumber}` : "Add a primary emergency contact before completing registration."}</p>
              <Link to={`/participants/${participantId}/emergency-contacts${eventId ? `?eventId=${encodeURIComponent(eventId)}` : ""}`}>{primaryContact ? "Manage contacts" : "Add emergency contact"} <ArrowRightIcon /></Link>
            </div>
          </article>
          <article className={consentMissing ? "missing" : "complete"}>
            <ClipboardDocumentCheckIcon />
            <div>
              <span>Consent status</span>
              {consentMissing ? <em className="participant-v2-profile-required">Required</em> : null}
              <h2 className={`participant-v2-consent-status ${consentStatusClass}`}>{consentStatus}</h2>
              <p>{!eventId ? "Select an event to see the consent record for that event." : consentWithdrawn ? "This consent was withdrawn. A new consent record is required before this participant can be registered for the selected event." : latestEventConsent ? `Version ${latestEventConsent.consentFormVersion.versionNumber} recorded ${displayDate(latestEventConsent.createdAt)}.` : "Consent is required before this participant can be registered for the selected event."}</p>
              {eventId
                ? consentMissing
                  ? <Link to={`/participants/${participantId}/consent?eventId=${encodeURIComponent(eventId)}`}>Record consent <ArrowRightIcon /></Link>
                  : <Link to={`/participants/${participantId}/consents?eventId=${encodeURIComponent(eventId)}`}>View consent history <ArrowRightIcon /></Link>
                : <Link to={searchLink}>Choose an event <ArrowRightIcon /></Link>}
            </div>
          </article>
        </div>

        <section className="participant-v2-history" aria-labelledby="participant-v2-history-title">
          <header>
            <div>
              <span>Registration history</span>
              <h2 id="participant-v2-history-title">Past and current event registrations</h2>
            </div>
            <strong>{registrations.length} {registrations.length === 1 ? "registration" : "registrations"}</strong>
          </header>
          {registrations.length === 0 ? (
            <div className="participant-v2-history-empty"><UserIcon /><p>This participant has not been registered for an event yet.</p></div>
          ) : (
            <div className="participant-v2-history-list">
              {registrations.map((registration) => <article key={registration.id}>
                <div>
                  <h3>{registration.event.eventName}</h3>
                  <p><CalendarDaysIcon /> Registered {displayDate(registration.registeredAt)} · Queue {registration.queueNumber}</p>
                </div>
                <div className="participant-v2-history-meta">
                  <strong>{displayStatus(registration.registrationStatus)}</strong>
                  <Link to={`/participants/registrations/${registration.id}/history`}>View history <ArrowRightIcon /></Link>
                </div>
              </article>)}
            </div>
          )}
        </section>
      </section>
    </section>
  );
}
