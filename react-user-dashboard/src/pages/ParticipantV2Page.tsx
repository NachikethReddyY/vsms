import {
  ArrowRightIcon,
  CalendarDaysIcon,
  ExclamationTriangleIcon,
  IdentificationIcon,
  MagnifyingGlassIcon,
  PencilSquareIcon,
  PhoneIcon,
  UserGroupIcon,
  UserPlusIcon,
} from "@heroicons/react/24/outline";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { eventApi, formatEventDate, type EventRecord } from "../features/events/eventApi";
import type { ParticipantSummary } from "../types";
import apiClient, { getApiError } from "../utils/apiClient";
import "./ParticipantV2Page.css";

type Pagination = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

type SearchResponse = {
  participants: ParticipantSummary[];
  pagination: Pagination;
};

type SearchCriteria = {
  name: string;
  participantReference: string;
  contactNumber: string;
  dateOfBirth: string;
};

const PAGE_SIZE = 20;
const REGISTRATION_EVENT_STATUSES = new Set(["PUBLISHED", "UPCOMING", "ONGOING", "IN_PROGRESS"]);

function initials(participant: ParticipantSummary) {
  return `${participant.firstName[0] ?? ""}${participant.lastName[0] ?? ""}`.toUpperCase() || "P";
}

export default function ParticipantV2Page() {
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [eventId, setEventId] = useState("");
  const [eventsLoading, setEventsLoading] = useState(true);
  const [eventError, setEventError] = useState<string | null>(null);
  const [criteria, setCriteria] = useState<SearchCriteria>({ name: "", participantReference: "", contactNumber: "", dateOfBirth: "" });
  const [results, setResults] = useState<SearchResponse | null>(null);
  const [searched, setSearched] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void eventApi.list()
      .then((response) => {
        if (!active) return;
        const registrationEvents = response.events.filter((event) => REGISTRATION_EVENT_STATUSES.has(event.status));
        setEvents(registrationEvents);
        setEventId((current) => registrationEvents.some((event) => event.eventId === current) ? current : registrationEvents[0]?.eventId || "");
        setEventError(registrationEvents.length ? null : "No published or in-progress events are available for participant registration.");
      })
      .catch((requestError: unknown) => {
        if (active) setEventError(getApiError(requestError, "Events could not be loaded. Refresh and try again."));
      })
      .finally(() => {
        if (active) setEventsLoading(false);
      });
    return () => { active = false; };
  }, []);

  const selectedEvent = useMemo(() => events.find((event) => event.eventId === eventId), [eventId, events]);

  const search = useCallback(async (page = 1) => {
    const hasTextSearch = [criteria.name, criteria.participantReference, criteria.contactNumber]
      .some((value) => value.trim().length >= 3);
    if (!hasTextSearch && !criteria.dateOfBirth) {
      setError("Enter at least three characters, or provide an exact date of birth.");
      return;
    }
    setError(null);
    setSearching(true);
    try {
      const { data } = await apiClient.get<SearchResponse>("/participants", {
        params: { ...criteria, page, pageSize: PAGE_SIZE },
      });
      setResults(data);
      setSearched(true);
    } catch (requestError: unknown) {
      setResults(null);
      setSearched(true);
      setError(getApiError(requestError, "Participant search could not be completed."));
    } finally {
      setSearching(false);
    }
  }, [criteria]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void search(1);
  }

  function clear() {
    setCriteria({ name: "", participantReference: "", contactNumber: "", dateOfBirth: "" });
    setResults(null);
    setError(null);
    setSearched(false);
  }

  const createParams = new URLSearchParams({ searchConfirmed: "1" });
  if (eventId) createParams.set("eventId", eventId);
  Object.entries(criteria).forEach(([key, value]) => {
    if (value.trim()) createParams.set(key, value.trim());
  });

  return (
    <section className="participant-v2-page" aria-labelledby="participant-v2-title">
      <header className="participant-v2-heading">
        <p>Registration workspace · V2</p>
        <h1 id="participant-v2-title">Find a participant</h1>
        <span>Search before registering someone to reduce duplicate records. Results show only masked identity details.</span>
      </header>

      <section className="participant-v2-panel" aria-labelledby="participant-v2-form-title">
        <header className="participant-v2-panel-heading">
          <span className="participant-v2-heading-icon"><MagnifyingGlassIcon /></span>
          <div><h2 id="participant-v2-form-title">Participant lookup</h2><p>Select an event, then search by one or more details.</p></div>
        </header>

        {eventError ? <p className="participant-v2-alert" role="alert">{eventError}</p> : null}
        <form onSubmit={submit} noValidate>
          <label className="participant-v2-event-field">
            <span>Event</span>
            <select value={eventId} onChange={(event) => setEventId(event.target.value)} disabled={eventsLoading || events.length === 0} required>
              {eventsLoading ? <option>Loading events…</option> : null}
              {!eventsLoading && events.length === 0 ? <option value="">No events open for registration</option> : null}
              {events.map((event) => <option key={event.eventId} value={event.eventId}>{event.name} · {formatEventDate(event.startsAt, event.timezone, false)}</option>)}
            </select>
          </label>

          <div className="participant-v2-fields">
            <label><span>Name</span><span className="participant-v2-input-icon"><MagnifyingGlassIcon /><input value={criteria.name} onChange={(event) => setCriteria((current) => ({ ...current, name: event.target.value }))} placeholder="e.g. Evelyn Tan" maxLength={100} /></span></label>
            <label><span>Participant reference <small>optional</small></span><span className="participant-v2-input-icon"><IdentificationIcon /><input value={criteria.participantReference} onChange={(event) => setCriteria((current) => ({ ...current, participantReference: event.target.value }))} placeholder="e.g. VSMS-2026-123456" maxLength={30} autoComplete="off" /></span></label>
            <label><span>Date of birth <small>optional</small></span><input type="date" value={criteria.dateOfBirth} onChange={(event) => setCriteria((current) => ({ ...current, dateOfBirth: event.target.value }))} /></label>
            <label><span>Contact number <small>optional</small></span><span className="participant-v2-input-icon"><PhoneIcon /><input value={criteria.contactNumber} onChange={(event) => setCriteria((current) => ({ ...current, contactNumber: event.target.value }))} placeholder="e.g. 91234567" maxLength={30} /></span></label>
          </div>

          <footer className="participant-v2-actions">
            <p><ExclamationTriangleIcon /> The current data model does not expose NRIC/FIN. Search uses a reference, name, contact number, or date of birth.</p>
            <div><button className="secondary" type="button" onClick={clear} disabled={searching}>Clear</button><button className="primary" type="submit" disabled={searching || eventsLoading || events.length === 0}>{searching ? "Searching…" : <><MagnifyingGlassIcon />Search participants</>}</button></div>
          </footer>
        </form>
      </section>

      {error ? <p className="participant-v2-alert participant-v2-search-alert" role="alert">{error}</p> : null}
      <section className="participant-v2-results" aria-live="polite" aria-busy={searching}>
        {searching ? <div className="participant-v2-empty"><span className="spinner" /><h2>Searching participant records…</h2></div> : null}
        {!searching && !searched ? <div className="participant-v2-empty"><UserGroupIcon /><h2>Search for an existing participant</h2><p>Use a name, contact number, reference, or date of birth to begin.</p></div> : null}
        {!searching && searched && results?.participants.length === 0 ? <div className="participant-v2-empty"><UserGroupIcon /><h2>No participants found</h2><p>Check the spelling or search with another identifier before creating a new participant.</p><Link className="primary participant-v2-create" to={`/participants/new?${createParams.toString()}`}><UserPlusIcon />Create new participant</Link></div> : null}
        {!searching && results && results.participants.length > 0 ? <>
          <header className="participant-v2-results-heading"><div><h2>{results.pagination.total} {results.pagination.total === 1 ? "match" : "matches"}</h2><p>{selectedEvent ? `Results ready for ${selectedEvent.name}.` : "Select an event before continuing."}</p></div><span>Page {results.pagination.page} of {Math.max(results.pagination.totalPages, 1)}</span></header>
          <div className="participant-v2-result-list">
            {results.participants.map((participant) => <article className="participant-v2-result" key={participant.id}>
              <span className="participant-v2-avatar" aria-hidden="true">{initials(participant)}</span>
              <div><h3>{participant.firstName} {participant.lastName}</h3><p><IdentificationIcon />{participant.participantReference}</p><p><CalendarDaysIcon />{participant.maskedDateOfBirth} <PhoneIcon />{participant.maskedContactNumber}</p></div>
              <div className="participant-v2-result-status"><strong>Ready for registration</strong><span>{selectedEvent ? selectedEvent.name : "Choose an event"}</span></div>
              <div className="participant-v2-result-actions"><Link className="secondary" to={`/participants-v2/${participant.id}${eventId ? `?eventId=${encodeURIComponent(eventId)}` : ""}`}><PencilSquareIcon />View profile</Link>{eventId ? <Link className="primary" to={`/participants-v2/${participant.id}?eventId=${encodeURIComponent(eventId)}`}><ArrowRightIcon />Register</Link> : null}</div>
            </article>)}
          </div>
          {results.pagination.totalPages > 1 ? <nav className="participant-v2-pagination" aria-label="Participant result pages"><button className="secondary" type="button" disabled={results.pagination.page <= 1 || searching} onClick={() => void search(results.pagination.page - 1)}>Previous</button><span>Page {results.pagination.page} of {results.pagination.totalPages}</span><button className="secondary" type="button" disabled={results.pagination.page >= results.pagination.totalPages || searching} onClick={() => void search(results.pagination.page + 1)}>Next</button></nav> : null}
        </> : null}
      </section>
    </section>
  );
}
