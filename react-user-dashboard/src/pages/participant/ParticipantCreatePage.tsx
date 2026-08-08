import { ArrowLeftIcon, CalendarDaysIcon, EnvelopeIcon, ExclamationTriangleIcon, UserPlusIcon } from "@heroicons/react/24/outline";
import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { PhoneInput } from "../../components/PhoneInput";
import apiClient, { getApiError } from "../../utils/apiClient";
import { isValidParticipantNric, isValidParticipantPhoneNumber } from "../../utils/phone";
import "./ParticipantPage.css";
import "./ParticipantCreatePage.css";

type ParticipantForm = {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  gender: string;
  contactNumber: string;
  nric: string;
  email: string;
  race: string;
  nationality: string;
  addressStreet: string;
  addressUnit: string;
  addressPostalCode: string;
  preferredLanguage: string;
  accessibilityNotes: string;
};

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function ParticipantCreatePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const eventId = searchParams.get("eventId") ?? "";
  const latestDateOfBirth = new Date().toISOString().slice(0, 10);
  const searchConfirmed = searchParams.get("searchConfirmed") === "1";
  const searchedName = (searchParams.get("name") ?? "").trim().split(/\s+/).filter(Boolean);
  const [form, setForm] = useState<ParticipantForm>({
    firstName: searchedName[0] ?? "",
    lastName: searchedName.slice(1).join(" "),
    dateOfBirth: searchParams.get("dateOfBirth") ?? "",
    gender: searchParams.get("gender") ?? "U",
    contactNumber: searchParams.get("contactNumber") ?? "",
    nric: "",
    email: searchParams.get("email") ?? "",
    race: "",
    nationality: "Singaporean",
    addressStreet: "",
    addressUnit: "",
    addressPostalCode: "",
    preferredLanguage: searchParams.get("preferredLanguage") ?? "English",
    accessibilityNotes: searchParams.get("accessibilityNotes") ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const searchLink = eventId ? `/events/${encodeURIComponent(eventId)}/register` : "/events";

  function update<K extends keyof ParticipantForm>(field: K, value: ParticipantForm[K]) {
    setForm((current) => ({ ...current, [field]: value }));
    setError(null);
  }

  function validate() {
    if (!eventId) return "Choose an event before creating a participant.";
    if (!form.firstName.trim()) return "First name is required.";
    if (!form.lastName.trim()) return "Last name is required.";
    if (!form.dateOfBirth) return "Date of birth is required.";
    if (form.dateOfBirth > new Date().toISOString().slice(0, 10)) return "Date of birth cannot be in the future.";
    if (!isValidParticipantPhoneNumber(form.contactNumber)) return "Enter a valid contact number.";
    if (!isValidParticipantNric(form.nric)) return "Enter a valid NRIC or FIN.";
    if (form.email.trim() && !emailPattern.test(form.email.trim())) return "Enter a valid email address.";
    return null;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validationMessage = validate();
    if (validationMessage) {
      setError(validationMessage);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const response = await apiClient.post("/participants", { ...form, status: "ACTIVE" }, {
        headers: { "X-Event-Id": eventId },
      });
      navigate(`/participants/${response.data.participant.id}?eventId=${encodeURIComponent(eventId)}`);
    } catch (requestError: unknown) {
      setError(getApiError(requestError, "Unable to create participant."));
    } finally {
      setSubmitting(false);
    }
  }

  if (!searchConfirmed) {
    return (
      <section className="participant-v2-page participant-v2-create">
        <Link className="participant-v2-back" to={searchLink}><ArrowLeftIcon /> {eventId ? "Back to event registration" : "Back to events"}</Link>
        <section className="participant-v2-create-guard">
          <ExclamationTriangleIcon />
          <h1>Search before creating</h1>
          <p>Complete a participant search first. This helps prevent duplicate records and keeps a returning participant’s history together.</p>
          <Link className="primary" to={searchLink}>Search participants</Link>
        </section>
      </section>
    );
  }

  return (
    <section className="participant-v2-page participant-v2-create" aria-labelledby="participant-v2-create-title">
      <Link className="participant-v2-back" to={searchLink}><ArrowLeftIcon /> {eventId ? "Back to event registration" : "Back to events"}</Link>
      <header className="participant-v2-create-heading">
        <span><UserPlusIcon /></span>
        <div><p>Registration workspace · Participant details</p><h1 id="participant-v2-create-title">Register a new participant</h1><small>Enter the participant's details for the selected event. You can add consent and an emergency contact from the profile afterwards.</small></div>
      </header>
      <section className="participant-v2-create-panel">
        <div className="participant-v2-create-context"><span>Selected event</span><strong>{eventId ? "Event selected" : "No event selected"}</strong><p>The participant profile will open after this record is created.</p></div>
        {error ? <p className="participant-v2-alert participant-v2-create-alert" role="alert">{error}</p> : null}
        <form onSubmit={submit} noValidate>
          <section className="participant-v2-create-section">
            <header><h2>Identity details</h2><p>Required fields are marked with an asterisk.</p></header>
            <div className="participant-v2-create-grid">
              <label><span>First name <b>*</b></span><input value={form.firstName} onChange={(event) => update("firstName", event.target.value)} maxLength={100} autoComplete="given-name" /></label>
              <label><span>Last name <b>*</b></span><input value={form.lastName} onChange={(event) => update("lastName", event.target.value)} maxLength={100} autoComplete="family-name" /></label>
              <label><span>Date of birth <b>*</b></span><span className="participant-v2-create-input-icon"><CalendarDaysIcon /><input type="date" value={form.dateOfBirth} max={latestDateOfBirth} onChange={(event) => update("dateOfBirth", event.target.value)} /></span></label>
              <label><span>Gender <b>*</b></span><select value={form.gender} onChange={(event) => update("gender", event.target.value)}><option value="U">Prefer not to say</option><option value="M">Male</option><option value="F">Female</option><option value="O">Other</option></select></label>
              <label><span>NRIC / FIN <b>*</b></span><input value={form.nric} onChange={(event) => update("nric", event.target.value)} maxLength={16} autoComplete="off" spellCheck={false} placeholder="S1234567A" /></label>
            </div>
          </section>
          <section className="participant-v2-create-section">
            <header><h2>Contact and support</h2><p>These details can be updated from the participant profile.</p></header>
            <div className="participant-v2-create-grid">
              <label><span>Contact number <b>*</b></span><PhoneInput value={form.contactNumber} onChange={(value) => update("contactNumber", value)} /></label>
              <label><span>Email <small>optional</small></span><span className="participant-v2-create-input-icon"><EnvelopeIcon /><input type="email" value={form.email} onChange={(event) => update("email", event.target.value)} maxLength={255} autoComplete="email" placeholder="name@example.com" /></span></label>
              <label><span>Preferred language</span><input value={form.preferredLanguage} onChange={(event) => update("preferredLanguage", event.target.value)} maxLength={50} /></label>
              <label className="participant-v2-create-notes"><span>Accessibility notes <small>optional</small></span><textarea value={form.accessibilityNotes} onChange={(event) => update("accessibilityNotes", event.target.value)} maxLength={1000} placeholder="Communication or access needs" /></label>
            </div>
          </section>
          <section className="participant-v2-create-section">
            <header><h2>Additional details</h2><p>Optional identity and address information for the participant profile.</p></header>
            <div className="participant-v2-create-grid">
              <label><span>Race <small>optional</small></span><input value={form.race} onChange={(event) => update("race", event.target.value)} maxLength={50} /></label>
              <label><span>Nationality <small>optional</small></span><input value={form.nationality} onChange={(event) => update("nationality", event.target.value)} maxLength={50} autoComplete="country-name" /></label>
              <label className="participant-v2-create-address"><span>Street address <small>optional</small></span><input value={form.addressStreet} onChange={(event) => update("addressStreet", event.target.value)} maxLength={255} autoComplete="street-address" /></label>
              <label><span>Unit number <small>optional</small></span><input value={form.addressUnit} onChange={(event) => update("addressUnit", event.target.value)} maxLength={20} autoComplete="address-line2" placeholder="#01-01" /></label>
              <label><span>Postal code <small>optional</small></span><input value={form.addressPostalCode} onChange={(event) => update("addressPostalCode", event.target.value)} maxLength={10} autoComplete="postal-code" /></label>
            </div>
          </section>
          <footer className="participant-v2-create-actions"><p><ExclamationTriangleIcon /> Continue only when the match check returned no existing participant.</p><div><Link className="secondary" to={searchLink}>Cancel</Link><button className="primary" type="submit" disabled={submitting}>{submitting ? "Saving participant..." : "Save participant details"}</button></div></footer>
        </form>
      </section>
    </section>
  );
}

