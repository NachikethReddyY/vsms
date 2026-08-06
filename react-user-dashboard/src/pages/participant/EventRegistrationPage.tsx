import {
  ArrowLeftIcon,
  CalendarDaysIcon,
  CheckCircleIcon,
  EnvelopeIcon,
  ExclamationTriangleIcon,
  IdentificationIcon,
  PhoneIcon,
  UserPlusIcon,
} from "@heroicons/react/24/outline";
import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import apiClient, { getApiError } from "../../utils/apiClient";
import "./ParticipantPage.css";
import "./ParticipantCreatePage.css";
import "./EventRegistrationPage.css";

type EventSummary = { id: string; eventName: string; location?: string; eventDate?: string };
type ParticipantForm = { firstName: string; lastName: string; dateOfBirth: string; gender: string; contactNumber: string; email: string; preferredLanguage: string; accessibilityNotes: string };
type CurrentRegistration = { id: string; queueNumber: number | null; status: string; assignedBooth: string | null };
type RegistrationMatch = {
  participant: { id: string; participantReference: string; firstName: string; lastName: string; dateOfBirth: string; maskedContactNumber: string; preferredLanguage: string | null };
  matchReasons: string[];
  previousEvent: { eventName: string } | null;
  currentEventRegistration: CurrentRegistration | null;
};
type MatchResponse = { result: "NO_MATCH" | "POSSIBLE_MATCH" | "ALREADY_REGISTERED"; matches: RegistrationMatch[] };
type DialogView = "match" | "details" | "registered" | null;

const phonePattern = /^\+?[0-9][0-9\s-]{6,19}$/;

function initials(match: RegistrationMatch) {
  return `${match.participant.firstName[0] ?? ""}${match.participant.lastName[0] ?? ""}`.toUpperCase() || "P";
}

function displayDate(value: string) {
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-SG", { day: "numeric", month: "long", year: "numeric" });
}

function displayStatus(value: string) {
  return value.toLowerCase().split("_").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

export default function EventRegistrationPage() {
  const { eventId = "" } = useParams();
  const navigate = useNavigate();
  const [event, setEvent] = useState<EventSummary | null>(null);
  const [eventLoading, setEventLoading] = useState(true);
  const [eventError, setEventError] = useState<string | null>(null);
  const [form, setForm] = useState<ParticipantForm>({ firstName: "", lastName: "", dateOfBirth: "", gender: "U", contactNumber: "", email: "", preferredLanguage: "English", accessibilityNotes: "" });
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [creating, setCreating] = useState(false);
  const [matches, setMatches] = useState<RegistrationMatch[]>([]);
  const [dialogView, setDialogView] = useState<DialogView>(null);
  const [selectedMatch, setSelectedMatch] = useState<RegistrationMatch | null>(null);
  const latestDateOfBirth = new Date().toISOString().slice(0, 10);

  useEffect(() => {
    let active = true;
    setEventLoading(true);
    void apiClient.get(`/events/${eventId}`)
      .then((response) => {
        if (!active) return;
        const source = response.data.event ?? response.data;
        setEvent({ id: source.id ?? source.eventId, eventName: source.eventName ?? source.name ?? "Selected event", location: source.location ?? source.venue, eventDate: source.eventDate ?? source.startsAt });
      })
      .catch((requestError: unknown) => { if (active) setEventError(getApiError(requestError, "Unable to load the selected event.")); })
      .finally(() => { if (active) setEventLoading(false); });
    return () => { active = false; };
  }, [eventId]);

  function update<K extends keyof ParticipantForm>(field: K, value: ParticipantForm[K]) {
    setForm((current) => ({ ...current, [field]: value }));
    setError(null);
  }

  function validateForMatch() {
    if (!form.firstName.trim() || !form.lastName.trim()) return "Enter the participant's full name to check for a match.";
    if (!form.dateOfBirth) return "Date of birth is required to check for a match.";
    if (form.dateOfBirth > latestDateOfBirth) return "Date of birth cannot be in the future.";
    if (!phonePattern.test(form.contactNumber.trim())) return "Enter a valid contact number to check for a match.";
    return null;
  }

  async function checkForExistingParticipant(submitEvent: FormEvent<HTMLFormElement>) {
    submitEvent.preventDefault();
    const validationError = validateForMatch();
    if (validationError) { setError(validationError); return; }
    setChecking(true);
    setError(null);
    try {
      const { data } = await apiClient.post<MatchResponse>("/participants/match", {
        firstName: form.firstName.trim(), lastName: form.lastName.trim(), dateOfBirth: form.dateOfBirth, contactNumber: form.contactNumber.trim(),
      }, { headers: { "X-Event-Id": eventId } });
      setMatches(data.matches);
      if (data.result === "NO_MATCH") {
        await registerNewParticipant();
      } else {
        setSelectedMatch(data.matches[0] ?? null);
        setDialogView("match");
      }
    } catch (requestError: unknown) {
      setError(getApiError(requestError, "Participant match check could not be completed."));
    } finally {
      setChecking(false);
    }
  }

  async function registerNewParticipant() {
    setCreating(true);
    setError(null);
    try {
      const response = await apiClient.post("/participants", { ...form, status: "ACTIVE" }, {
        headers: { "X-Event-Id": eventId },
      });
      navigate(`/participants/${response.data.participant.id}?eventId=${encodeURIComponent(eventId)}`);
    } catch (requestError: unknown) {
      setError(getApiError(requestError, "Unable to create the participant after the match check."));
    } finally {
      setCreating(false);
    }
  }

  function viewDetails(match: RegistrationMatch) {
    setSelectedMatch(match);
    setDialogView("details");
  }

  function useExistingParticipant(match: RegistrationMatch) {
    setSelectedMatch(match);
    if (match.currentEventRegistration) {
      setDialogView("registered");
      return;
    }
    navigate(`/participants/${match.participant.id}/edit?eventId=${encodeURIComponent(eventId)}`, {
      state: { registrationDraft: form },
    });
  }

  if (eventLoading) return <section className="participant-v2-page participant-v2-create"><p className="participant-v2-profile-loading">Loading event...</p></section>;
  if (!event) return <section className="participant-v2-page participant-v2-create"><Link className="participant-v2-back" to="/events"><ArrowLeftIcon /> Back to events</Link><p className="participant-v2-alert" role="alert">{eventError ?? "This event could not be found."}</p></section>;

  const selectedRegistration = selectedMatch?.currentEventRegistration;
  return (
    <section className="participant-v2-page participant-v2-create event-registration-create" aria-labelledby="event-registration-title">
      <Link className="participant-v2-back" to={`/events/${eventId}`}><ArrowLeftIcon /> Back to event</Link>
      <header className="participant-v2-create-heading"><span><UserPlusIcon /></span><div><p>Event registration</p><h1 id="event-registration-title">Register participant</h1><small>Enter the participant's details, then check for an existing participant before continuing.</small></div></header>
      <section className="participant-v2-create-panel">
        <div className="participant-v2-create-context event-registration-context"><span>Registering for</span><strong>{event.eventName}</strong><p>{[event.location, event.eventDate].filter(Boolean).join(" · ") || "Event selected"}</p></div>
        {error ? <p className="participant-v2-alert participant-v2-create-alert" role="alert">{error}</p> : null}
        <form onSubmit={checkForExistingParticipant} noValidate>
          <section className="participant-v2-create-section"><header><h2>Participant details</h2><p>Full name, date of birth, and contact number are used together for the match check.</p></header><div className="participant-v2-create-grid">
            <label><span>First name <b>*</b></span><input value={form.firstName} onChange={(input) => update("firstName", input.target.value)} maxLength={100} autoComplete="given-name" /></label>
            <label><span>Last name <b>*</b></span><input value={form.lastName} onChange={(input) => update("lastName", input.target.value)} maxLength={100} autoComplete="family-name" /></label>
            <label><span>Date of birth <b>*</b></span><span className="participant-v2-create-input-icon"><CalendarDaysIcon /><input type="date" value={form.dateOfBirth} max={latestDateOfBirth} onChange={(input) => update("dateOfBirth", input.target.value)} /></span></label>
            <label><span>Gender <b>*</b></span><select value={form.gender} onChange={(input) => update("gender", input.target.value)}><option value="U">Prefer not to say</option><option value="M">Male</option><option value="F">Female</option><option value="O">Other</option></select></label>
          </div></section>
          <section className="participant-v2-create-section"><header><h2>Contact and support</h2><p>These details are retained if you continue as a new participant.</p></header><div className="participant-v2-create-grid">
            <label><span>Contact number <b>*</b></span><span className="participant-v2-create-input-icon"><PhoneIcon /><input value={form.contactNumber} onChange={(input) => update("contactNumber", input.target.value)} maxLength={30} autoComplete="tel" placeholder="e.g. +65 9123 4567" /></span></label>
            <label><span>Email <small>optional</small></span><span className="participant-v2-create-input-icon"><EnvelopeIcon /><input type="email" value={form.email} onChange={(input) => update("email", input.target.value)} maxLength={255} autoComplete="email" placeholder="name@example.com" /></span></label>
            <label><span>Preferred language</span><input value={form.preferredLanguage} onChange={(input) => update("preferredLanguage", input.target.value)} maxLength={50} /></label>
            <label className="participant-v2-create-notes"><span>Operational notes <small>optional</small></span><textarea value={form.accessibilityNotes} onChange={(input) => update("accessibilityNotes", input.target.value)} maxLength={1000} placeholder="Communication or access needs" /></label>
          </div></section>
          <footer className="participant-v2-create-actions"><p><ExclamationTriangleIcon /> The system checks for possible duplicates before opening the participant profile. A name by itself is never treated as a duplicate.</p><div><Link className="secondary" to={`/events/${eventId}`}>Cancel</Link><button className="primary" type="submit" disabled={checking || creating}>{checking ? "Checking participants..." : creating ? "Creating participant..." : "Register participant"}</button></div></footer>
        </form>
      </section>

      {dialogView ? <div className="participant-existing-backdrop" role="presentation"><section className="participant-existing-dialog" role="dialog" aria-modal="true" aria-labelledby="participant-existing-title">
        {dialogView === "match" ? <>
          <header><span><IdentificationIcon /></span><div><p>Participant match check</p><h2 id="participant-existing-title">Possible participant match found</h2></div></header>
          <p>These results matched at least two identity details. Choose the correct officer decision for each possible participant.</p>
          <div className="participant-existing-list">{matches.map((match) => <article key={match.participant.id}><span className="participant-v2-avatar" aria-hidden="true">{initials(match)}</span><div><strong>{match.participant.firstName} {match.participant.lastName}</strong><p><IdentificationIcon /> {match.participant.participantReference}</p><p><CalendarDaysIcon /> {displayDate(match.participant.dateOfBirth)} <PhoneIcon /> {match.participant.maskedContactNumber}</p><p className="participant-existing-match-reasons"><b>Matched by:</b> {match.matchReasons.join(" + ")}</p><div className="participant-existing-actions"><button className="secondary" type="button" onClick={() => viewDetails(match)}>View details</button><button className="primary" type="button" onClick={() => useExistingParticipant(match)}>{match.currentEventRegistration ? "View current registration" : "Use this participant"}</button></div></div></article>)}</div>
          <section className="participant-existing-decision"><h3>Officer decision</h3><p>If every result is a different person, continue using the details already entered.</p></section>
          <footer className="participant-existing-footer"><button className="secondary" type="button" onClick={() => setDialogView(null)}>Close</button><button className="primary" type="button" disabled={creating} onClick={() => void registerNewParticipant()}>{creating ? "Creating participant..." : "Different person - register new participant"}</button></footer>
        </> : null}
        {dialogView === "details" && selectedMatch ? <>
          <header><span><IdentificationIcon /></span><div><p>Identity verification</p><h2 id="participant-existing-title">Participant details</h2></div></header>
          <dl className="participant-match-details"><div><dt>Full name</dt><dd>{selectedMatch.participant.firstName} {selectedMatch.participant.lastName}</dd></div><div><dt>Date of birth</dt><dd>{displayDate(selectedMatch.participant.dateOfBirth)}</dd></div><div><dt>Masked contact number</dt><dd>{selectedMatch.participant.maskedContactNumber}</dd></div><div><dt>Previous event</dt><dd>{selectedMatch.previousEvent?.eventName ?? "No previous event found"}</dd></div><div><dt>Preferred language</dt><dd>{selectedMatch.participant.preferredLanguage ?? "Not recorded"}</dd></div></dl>
          <footer className="participant-existing-footer"><button className="primary" type="button" onClick={() => setDialogView("match")}>Return to officer decision</button></footer>
        </> : null}
        {dialogView === "registered" && selectedMatch && selectedRegistration ? <>
          <header><span><CheckCircleIcon /></span><div><p>Current event registration</p><h2 id="participant-existing-title">Participant already registered</h2></div></header>
          <p>{selectedMatch.participant.firstName} {selectedMatch.participant.lastName} already has a registration for {event.eventName}. No second registration will be created.</p>
          <dl className="participant-match-details"><div><dt>Queue number</dt><dd>{selectedRegistration.queueNumber == null ? "Not assigned" : `Q-${String(selectedRegistration.queueNumber).padStart(3, "0")}`}</dd></div><div><dt>Status</dt><dd>{displayStatus(selectedRegistration.status)}</dd></div><div><dt>Assigned booth</dt><dd>{selectedRegistration.assignedBooth ?? "Not assigned"}</dd></div></dl>
          <footer className="participant-existing-footer"><button className="secondary" type="button" onClick={() => setDialogView("match")}>Cancel</button><button className="secondary" type="button" disabled title="Replacement requires the audited REPLACED registration workflow.">Replace existing registration</button><Link className="primary" to={`/participants/${selectedMatch.participant.id}/register?eventId=${encodeURIComponent(eventId)}`}>Use existing registration</Link></footer>
        </> : null}
      </section></div> : null}
    </section>
  );
}
