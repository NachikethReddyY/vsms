import {
  ArrowLeftIcon,
  CalendarDaysIcon,
  CheckCircleIcon,
  EnvelopeIcon,
  ExclamationTriangleIcon,
  UserPlusIcon,
} from "@heroicons/react/24/outline";
import { useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import { PhoneInput } from "../../components/PhoneInput";
import { eventApi, type EventRecord } from "../../features/events/eventApi";
import { useOfflineSync } from "../../features/screening/OfflineSyncProvider";
import {
  getOfflineCanonicalRegistration,
  offlineSyncChangeEvent,
  queueOfflineWalkInRegistration,
  type OfflineCanonicalRegistration,
  type OfflineRegistrationSave,
  type OfflineWalkInInput,
} from "../../features/screening/offlineSync";
import { isValidParticipantNric, isValidParticipantPhoneNumber } from "../../utils/phone";
import "./ParticipantPage.css";
import "./ParticipantCreatePage.css";
import "./EventRegistrationPage.css";
import {
  beginRegistrationEvidence,
  clearRegistrationEvidence,
  getRegistrationStartedAt,
} from "./registrationEvidence";

type ParticipantForm = OfflineWalkInInput["participant"];
type EmergencyContactForm = Required<OfflineWalkInInput["emergencyContact"]>;

const emptyParticipant: ParticipantForm = {
  firstName: "",
  lastName: "",
  dateOfBirth: "",
  gender: "U",
  contactNumber: "",
  nric: "",
  email: "",
  race: "",
  nationality: "Singaporean",
  addressStreet: "",
  addressUnit: "",
  addressPostalCode: "",
  preferredLanguage: "English",
  accessibilityNotes: "",
};
const emptyEmergencyContact: EmergencyContactForm = {
  contactName: "",
  relationship: "",
  phoneNumber: "",
  email: "",
};
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function readableError(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function validate(participant: ParticipantForm, emergencyContact: EmergencyContactForm, latestDateOfBirth: string) {
  if (!participant.firstName.trim() || !participant.lastName.trim()) return "Enter the participant's full name.";
  if (!participant.dateOfBirth) return "Date of birth is required.";
  if (participant.dateOfBirth > latestDateOfBirth) return "Date of birth cannot be in the future.";
  if (!isValidParticipantPhoneNumber(participant.contactNumber)) return "Enter a valid participant contact number.";
  if (!isValidParticipantNric(participant.nric)) return "Enter a valid NRIC or FIN.";
  if (!emailPattern.test(participant.email.trim())) return "Enter a valid participant email address.";
  if (!participant.race.trim()) return "Race is required.";
  if (!participant.nationality.trim()) return "Nationality is required.";
  if (!participant.addressStreet.trim()) return "Street address is required.";
  if (!participant.addressUnit.trim()) return "Unit number is required.";
  if (!participant.addressPostalCode.trim()) return "Postal code is required.";
  if (!participant.preferredLanguage.trim()) return "Preferred language is required.";
  if (!emergencyContact.contactName.trim()) return "Emergency contact name is required.";
  if (!emergencyContact.relationship.trim()) return "Emergency contact relationship is required.";
  if (!isValidParticipantPhoneNumber(emergencyContact.phoneNumber)) return "Enter a valid emergency contact number.";
  if (emergencyContact.email.trim() && !emailPattern.test(emergencyContact.email.trim())) return "Enter a valid emergency contact email address.";
  return null;
}

export default function EventRegistrationPage() {
  const { eventId = "" } = useParams();
  const { session } = useAuth();
  const { online, ensureOfflineReady } = useOfflineSync();
  const [event, setEvent] = useState<EventRecord | null>(null);
  const [eventLoading, setEventLoading] = useState(true);
  const [eventError, setEventError] = useState<string | null>(null);
  const [participant, setParticipant] = useState<ParticipantForm>(emptyParticipant);
  const [emergencyContact, setEmergencyContact] = useState<EmergencyContactForm>(emptyEmergencyContact);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<OfflineRegistrationSave | null>(null);
  const [canonicalRegistration, setCanonicalRegistration] = useState<OfflineCanonicalRegistration | null>(null);
  const latestDateOfBirth = new Date().toISOString().slice(0, 10);

  useEffect(() => {
    if (eventId) beginRegistrationEvidence(eventId);
  }, [eventId]);

  useEffect(() => {
    const ownerId = session?.user.id;
    if (!ownerId || !saved) {
      setCanonicalRegistration(null);
      return undefined;
    }
    let active = true;
    const refresh = async () => {
      const canonical = await getOfflineCanonicalRegistration(ownerId, eventId, saved.registrationId).catch(() => null);
      if (active) setCanonicalRegistration(canonical);
    };
    void refresh();
    window.addEventListener(offlineSyncChangeEvent, refresh);
    return () => {
      active = false;
      window.removeEventListener(offlineSyncChangeEvent, refresh);
    };
  }, [eventId, saved, session?.user.id]);

  useEffect(() => {
    let active = true;
    setEventLoading(true);
    setEvent(null);
    setEventError(null);
    void eventApi.get(eventId)
      .then((loadedEvent) => { if (active) setEvent(loadedEvent); })
      .catch((requestError: unknown) => {
        if (active) setEventError(readableError(requestError, "Unable to load the selected event."));
      })
      .finally(() => { if (active) setEventLoading(false); });
    return () => { active = false; };
  }, [eventId]);

  function updateParticipant<K extends keyof ParticipantForm>(field: K, value: ParticipantForm[K]) {
    setParticipant((current) => ({ ...current, [field]: value }));
    setError(null);
  }

  function updateEmergencyContact<K extends keyof EmergencyContactForm>(field: K, value: EmergencyContactForm[K]) {
    setEmergencyContact((current) => ({ ...current, [field]: value }));
    setError(null);
  }

  async function registerParticipant(submitEvent: FormEvent<HTMLFormElement>) {
    submitEvent.preventDefault();
    const validationError = validate(participant, emergencyContact, latestDateOfBirth);
    if (validationError) {
      setError(validationError);
      return;
    }
    const ownerId = session?.user.id;
    if (!ownerId) {
      setError("Your session is unavailable. Sign in again before registering a participant.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      if (online) await ensureOfflineReady(eventId);
      const result = await queueOfflineWalkInRegistration(ownerId, eventId, {
        participant: {
          ...participant,
          firstName: participant.firstName.trim(),
          lastName: participant.lastName.trim(),
          contactNumber: participant.contactNumber.trim(),
          nric: participant.nric.trim().replace(/[\s-]/g, "").toUpperCase(),
          email: participant.email.trim(),
          race: participant.race.trim(),
          nationality: participant.nationality.trim(),
          addressStreet: participant.addressStreet.trim(),
          addressUnit: participant.addressUnit.trim(),
          addressPostalCode: participant.addressPostalCode.trim(),
          preferredLanguage: participant.preferredLanguage.trim(),
          accessibilityNotes: participant.accessibilityNotes.trim(),
        },
        emergencyContact: {
          contactName: emergencyContact.contactName.trim(),
          relationship: emergencyContact.relationship.trim(),
          phoneNumber: emergencyContact.phoneNumber.trim(),
          email: emergencyContact.email.trim() || undefined,
        },
        workflowStartedAt: getRegistrationStartedAt(eventId),
        paperFormUsed: false,
      });
      clearRegistrationEvidence(eventId);
      setParticipant({ ...emptyParticipant });
      setEmergencyContact({ ...emptyEmergencyContact });
      setSaved(result);
    } catch (requestError: unknown) {
      setError(readableError(requestError, "Unable to save this registration on the device."));
    } finally {
      setSaving(false);
    }
  }

  function registerAnother() {
    setParticipant({ ...emptyParticipant });
    setEmergencyContact({ ...emptyEmergencyContact });
    setSaved(null);
    setError(null);
    beginRegistrationEvidence(eventId);
  }

  if (eventLoading) return <section className="participant-v2-page participant-v2-create"><p className="participant-v2-profile-loading" role="status">Loading event...</p></section>;
  if (!event) return <section className="participant-v2-page participant-v2-create"><Link className="participant-v2-back" to="/events"><ArrowLeftIcon /> Back to events</Link><p className="participant-v2-alert" role="alert">{eventError ?? "This event could not be found."}</p></section>;

  return (
    <section className="participant-v2-page participant-v2-create event-registration-create" aria-labelledby="event-registration-title">
      <Link className="participant-v2-back" to={`/events/${eventId}`}><ArrowLeftIcon /> Back to event</Link>
      <header className="participant-v2-create-heading"><span><UserPlusIcon /></span><div><p>Event registration</p><h1 id="event-registration-title">Register participant</h1><small>The registration is encrypted and saved on this device first, whether online or offline.</small></div></header>
      <section className="participant-v2-create-panel">
        <div className="participant-v2-create-context event-registration-context"><span>Registering for</span><strong>{event.name}</strong><p>{[event.venue, event.startsAt ? new Date(event.startsAt).toLocaleString("en-SG") : null].filter(Boolean).join(" · ") || "Event selected"}</p></div>
        {error ? <p className="participant-v2-alert participant-v2-create-alert" role="alert">{error}</p> : null}

        {saved ? (
          <section className="event-registration-confirmation" aria-labelledby="event-registration-confirmation-title">
            <CheckCircleIcon aria-hidden="true" />
            <p>Saved on this device</p>
            <h2 id="event-registration-confirmation-title">Participant registered locally</h2>
            <dl>
              <div><dt>Queue number</dt><dd>Q-{String(saved.queueNumber).padStart(3, "0")}</dd></div>
              <div><dt>Station number</dt><dd>Station {saved.stationNumber}</dd></div>
            </dl>
            {canonicalRegistration ? (
              <p className="event-registration-qr-notice" role="status"><CheckCircleIcon aria-hidden="true" /> Server confirmed. The canonical QR pass is ready on this device.</p>
            ) : (
              <p className="event-registration-qr-notice" role="status"><ExclamationTriangleIcon aria-hidden="true" /> No QR code exists until the server confirms this registration during sync.</p>
            )}
            <footer>
              <Link className="secondary" to={`/events/${eventId}`}>Return to event</Link>
              {canonicalRegistration ? <Link className="secondary" to={`/participants/registrations/${canonicalRegistration.registrationId}/qr?eventId=${encodeURIComponent(eventId)}`}>View canonical QR</Link> : null}
              <button className="primary" type="button" onClick={registerAnother}>Register another participant</button>
            </footer>
          </section>
        ) : (
          <form onSubmit={registerParticipant} noValidate>
            <section className="participant-v2-create-section"><header><h2>Participant details</h2><p>Identity details are checked for duplicates by the server during sync.</p></header><div className="participant-v2-create-grid">
              <label><span>First name <b>*</b></span><input required value={participant.firstName} onChange={(input) => updateParticipant("firstName", input.target.value)} maxLength={100} autoComplete="given-name" /></label>
              <label><span>Last name <b>*</b></span><input required value={participant.lastName} onChange={(input) => updateParticipant("lastName", input.target.value)} maxLength={100} autoComplete="family-name" /></label>
              <label><span>Date of birth <b>*</b></span><span className="participant-v2-create-input-icon"><CalendarDaysIcon /><input required type="date" value={participant.dateOfBirth} max={latestDateOfBirth} onChange={(input) => updateParticipant("dateOfBirth", input.target.value)} /></span></label>
              <label><span>Gender <b>*</b></span><select required value={participant.gender} onChange={(input) => updateParticipant("gender", input.target.value)}><option value="U">Prefer not to say</option><option value="M">Male</option><option value="F">Female</option><option value="O">Other</option></select></label>
              <label><span>NRIC / FIN <b>*</b></span><input required value={participant.nric} onChange={(input) => updateParticipant("nric", input.target.value)} maxLength={16} autoComplete="off" spellCheck={false} placeholder="S1234567D" /></label>
            </div></section>

            <section className="participant-v2-create-section"><header><h2>Contact and support</h2><p>Current contact preferences for the participant.</p></header><div className="participant-v2-create-grid">
              <label><span>Contact number <b>*</b></span><PhoneInput value={participant.contactNumber} onChange={(value) => updateParticipant("contactNumber", value)} /></label>
              <label><span>Email <b>*</b></span><span className="participant-v2-create-input-icon"><EnvelopeIcon /><input required type="email" value={participant.email} onChange={(input) => updateParticipant("email", input.target.value)} maxLength={255} autoComplete="email" placeholder="name@example.com" /></span></label>
              <label><span>Preferred language <b>*</b></span><input required value={participant.preferredLanguage} onChange={(input) => updateParticipant("preferredLanguage", input.target.value)} maxLength={50} /></label>
              <label className="participant-v2-create-notes"><span>Operational notes <small>optional</small></span><textarea value={participant.accessibilityNotes} onChange={(input) => updateParticipant("accessibilityNotes", input.target.value)} maxLength={1000} placeholder="Communication or access needs" /></label>
            </div></section>

            <section className="participant-v2-create-section"><header><h2>Additional details</h2><p>Identity and address information required for the participant profile.</p></header><div className="participant-v2-create-grid">
              <label><span>Race <b>*</b></span><input required value={participant.race} onChange={(input) => updateParticipant("race", input.target.value)} maxLength={50} /></label>
              <label><span>Nationality <b>*</b></span><input required value={participant.nationality} onChange={(input) => updateParticipant("nationality", input.target.value)} maxLength={50} autoComplete="country-name" /></label>
              <label className="participant-v2-create-address"><span>Street address <b>*</b></span><input required value={participant.addressStreet} onChange={(input) => updateParticipant("addressStreet", input.target.value)} maxLength={255} autoComplete="street-address" /></label>
              <label><span>Unit number <b>*</b></span><input required value={participant.addressUnit} onChange={(input) => updateParticipant("addressUnit", input.target.value)} maxLength={20} autoComplete="address-line2" placeholder="#01-01" /></label>
              <label><span>Postal code <b>*</b></span><input required value={participant.addressPostalCode} onChange={(input) => updateParticipant("addressPostalCode", input.target.value)} maxLength={10} autoComplete="postal-code" /></label>
            </div></section>

            <section className="participant-v2-create-section"><header><h2>Primary emergency contact</h2><p>This contact is saved as active and primary when the registration syncs.</p></header><div className="participant-v2-create-grid">
              <label><span>Contact name <b>*</b></span><input required value={emergencyContact.contactName} onChange={(input) => updateEmergencyContact("contactName", input.target.value)} maxLength={100} autoComplete="name" /></label>
              <label><span>Relationship <b>*</b></span><input required value={emergencyContact.relationship} onChange={(input) => updateEmergencyContact("relationship", input.target.value)} maxLength={50} /></label>
              <label><span>Contact phone <b>*</b></span><PhoneInput value={emergencyContact.phoneNumber} onChange={(value) => updateEmergencyContact("phoneNumber", value)} /></label>
              <label><span>Contact email <small>optional</small></span><span className="participant-v2-create-input-icon"><EnvelopeIcon /><input type="email" value={emergencyContact.email} onChange={(input) => updateEmergencyContact("email", input.target.value)} maxLength={255} autoComplete="email" placeholder="contact@example.com" /></span></label>
            </div></section>

            <footer className="participant-v2-create-actions"><p><ExclamationTriangleIcon /> The server resolves duplicate participants and queue conflicts during sync. No provisional QR code is created.</p><div><Link className="secondary" to={`/events/${eventId}`}>Cancel</Link><button className="primary" type="submit" disabled={saving}>{saving ? "Saving on device..." : "Register participant"}</button></div></footer>
          </form>
        )}
      </section>
    </section>
  );
}
