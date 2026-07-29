import {
  ArrowRightIcon,
  CalendarDaysIcon,
  ExclamationTriangleIcon,
  IdentificationIcon,
  MagnifyingGlassIcon,
  PencilSquareIcon,
  PhoneIcon,
  UserGroupIcon,
} from '@heroicons/react/24/outline';
import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { getApiMessage } from '../../auth/authState';
import { eventApi, formatEventDate, type EventRecord } from '../events/eventApi';
import apiClient from '../../utils/apiClient';

type ParticipantRegistration = {
  registrationId: string;
  registrationStatus: 'SIGNED_UP' | 'CHECKED_IN' | 'COMPLETED' | 'CANCELLED';
  checkedIn: boolean;
  queueNumber?: number | null;
};

type ParticipantSearchResult = {
  participantId: string;
  displayName: string;
  nricMasked: string;
  maskedContactNumber: string | null;
  maskedDateOfBirth: string | null;
  registrationCount: number;
  selectedEventRegistration: ParticipantRegistration | null;
};

type ParticipantSearchResponse = {
  participants: ParticipantSearchResult[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

type ParticipantSearchRequest = {
  eventId: string;
  query?: string;
  nric?: string;
  dateOfBirth?: string;
  page: number;
  limit: number;
};

const PAGE_SIZE = 20;

function registrationSummary(registration: ParticipantRegistration | null) {
  if (!registration) return 'Not registered for selected event';
  if (registration.checkedIn) return `Checked in${registration.queueNumber ? ` · Queue ${registration.queueNumber}` : ''}`;
  return registration.registrationStatus.replace(/_/g, ' ').toLowerCase().replace(/^./, (letter) => letter.toUpperCase());
}

export default function ParticipantSearchPage() {
  const navigate = useNavigate();
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [eventError, setEventError] = useState('');
  const [eventId, setEventId] = useState('');
  const [query, setQuery] = useState('');
  const [nric, setNric] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [results, setResults] = useState<ParticipantSearchResponse | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [hasSearched, setHasSearched] = useState(false);

  useEffect(() => {
    let isCurrent = true;
    const loadEvents = async () => {
      setEventsLoading(true);
      setEventError('');
      try {
        const response = await eventApi.list();
        if (!isCurrent) return;
        setEvents(response.events);
        setEventId((current) => current || response.events[0]?.eventId || '');
      } catch (error) {
        if (isCurrent) setEventError(getApiMessage(error, 'Events could not be loaded. Refresh the page and try again.'));
      } finally {
        if (isCurrent) setEventsLoading(false);
      }
    };
    void loadEvents();
    return () => { isCurrent = false; };
  }, []);

  const runSearch = async (nextPage = 1) => {
    const trimmedQuery = query.trim();
    const normalizedNric = nric.replace(/[\s-]/g, '').toUpperCase();

    setSearchError('');
    if (!eventId) {
      setSearchError('Select an event before searching for a participant.');
      return;
    }
    if (!trimmedQuery && !normalizedNric && !dateOfBirth) {
      setSearchError('Enter a name, contact number, masked identifier, exact NRIC/FIN, or date of birth.');
      return;
    }
    if (trimmedQuery && trimmedQuery.length < 3) {
      setSearchError('Search text must contain at least 3 characters.');
      return;
    }

    const payload: ParticipantSearchRequest = {
      eventId,
      page: nextPage,
      limit: PAGE_SIZE,
      ...(trimmedQuery ? { query: trimmedQuery } : {}),
      ...(normalizedNric ? { nric: normalizedNric } : {}),
      ...(dateOfBirth ? { dateOfBirth } : {}),
    };

    setSearching(true);
    try {
      const { data } = await apiClient.post<ParticipantSearchResponse>('/api/participants/search', payload);
      setResults(data);
      setHasSearched(true);
    } catch (error) {
      setResults(null);
      setHasSearched(true);
      setSearchError(getApiMessage(error, 'Participant search could not be completed. Please try again.'));
    } finally {
      setSearching(false);
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void runSearch();
  };

  const changeEvent = (nextEventId: string) => {
    setEventId(nextEventId);
    setResults(null);
    setSearchError('');
    setHasSearched(false);
  };

  const clearSearch = () => {
    setQuery('');
    setNric('');
    setDateOfBirth('');
    setResults(null);
    setSearchError('');
    setHasSearched(false);
  };

  const selectedEvent = events.find((event) => event.eventId === eventId);
  const pagination = results?.pagination;

  return (
    <div className="page-frame participant-search-page">
      <section className="page-heading participant-search-heading">
        <div>
          <p className="eyebrow">Registration workspace</p>
          <h1>Find a participant</h1>
          <p>Search before registering someone to prevent duplicate records. Results show only masked identity details.</p>
        </div>
      </section>

      <section className="participant-search-panel" aria-labelledby="participant-search-form-title">
        <div className="participant-search-panel-heading">
          <div className="participant-search-icon"><MagnifyingGlassIcon /></div>
          <div><h2 id="participant-search-form-title">Participant lookup</h2><p>Select the event, then search by one or more details.</p></div>
        </div>

        {eventError && <div className="alert error" role="alert"><span>{eventError}</span></div>}

        <form className="participant-search-form" onSubmit={submit} noValidate>
          <label className="participant-event-field">
            <span>Event</span>
            <select value={eventId} onChange={(event) => changeEvent(event.target.value)} disabled={eventsLoading || events.length === 0} required>
              {eventsLoading ? <option>Loading events…</option> : events.length === 0 ? <option value="">No events available</option> : events.map((event) => <option value={event.eventId} key={event.eventId}>{event.name} · {formatEventDate(event.startsAt, event.timezone, false)}</option>)}
            </select>
          </label>

          <div className="participant-search-fields">
            <label className="participant-query-field">
              <span>Name, contact, or masked ID</span>
              <span className="participant-input-icon"><MagnifyingGlassIcon /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="e.g. Evelyn Tan or 9123" maxLength={100} /></span>
            </label>
            <label>
              <span>Exact NRIC / FIN <small>optional</small></span>
              <span className="participant-input-icon"><IdentificationIcon /><input value={nric} onChange={(event) => setNric(event.target.value)} placeholder="e.g. S1234567A" autoComplete="off" autoCapitalize="characters" spellCheck="false" maxLength={12} /></span>
            </label>
            <label>
              <span>Date of birth <small>optional</small></span>
              <input type="date" value={dateOfBirth} onChange={(event) => setDateOfBirth(event.target.value)} />
            </label>
          </div>

          <div className="participant-search-actions">
            <p><ExclamationTriangleIcon /> Exact NRIC/FIN is sent in the request body only and is never shown in results.</p>
            <div><button type="button" className="secondary" onClick={clearSearch} disabled={searching}>Clear</button><button type="submit" className="primary" disabled={searching || eventsLoading || events.length === 0}>{searching ? 'Searching…' : <><MagnifyingGlassIcon />Search participants</>}</button></div>
          </div>
        </form>
      </section>

      {searchError && <div className="alert error participant-search-alert" role="alert"><span>{searchError}</span></div>}

      <section className="participant-results" aria-live="polite" aria-busy={searching}>
        {searching ? <div className="participant-results-loading"><span className="spinner" />Searching participant records…</div> : !hasSearched ? <div className="participant-search-placeholder"><UserGroupIcon /><h2>Search for an existing participant</h2><p>Use a name, contact number, masked ID, exact NRIC/FIN, or date of birth to begin.</p></div> : results && results.participants.length === 0 ? <div className="participant-search-placeholder"><UserGroupIcon /><h2>No participants found</h2><p>Check the spelling or search with another identifier before creating a new participant.</p></div> : results ? <>
          <div className="participant-results-heading"><div><h2>{results.pagination.total} {results.pagination.total === 1 ? 'match' : 'matches'}</h2><p>Showing results for the selected event only.</p></div><span className="participant-result-count">Page {results.pagination.page} of {Math.max(results.pagination.totalPages, 1)}</span></div>
          <div className="participant-results-list">
            {results.participants.map((participant) => {
              const registration = participant.selectedEventRegistration;
              const locationState = { participantName: participant.displayName, eventName: selectedEvent?.name };
              return <article className="participant-result-card" key={participant.participantId}>
                <div className="participant-result-avatar" aria-hidden="true">{participant.displayName.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()}</div>
                <div className="participant-result-main"><h3>{participant.displayName}</h3><div className="participant-identity"><span><IdentificationIcon />{participant.nricMasked}</span>{participant.maskedDateOfBirth && <span><CalendarDaysIcon />{participant.maskedDateOfBirth}</span>}{participant.maskedContactNumber && <span><PhoneIcon />{participant.maskedContactNumber}</span>}</div><p>{participant.registrationCount} {participant.registrationCount === 1 ? 'previous registration' : 'previous registrations'}</p></div>
                <div className={`participant-registration-status ${registration ? 'registered' : ''}`}><strong>{registration ? 'Already registered' : 'New for this event'}</strong><span>{registrationSummary(registration)}</span></div>
                <div className="participant-result-actions"><button type="button" className="secondary" onClick={() => navigate(`/participant-search/${participant.participantId}/edit?eventId=${encodeURIComponent(eventId)}`, { state: locationState })}><PencilSquareIcon />Edit details</button><button type="button" className="primary" onClick={() => navigate(`/participant-search/${participant.participantId}/register?eventId=${encodeURIComponent(eventId)}`, { state: locationState })}><ArrowRightIcon />Register</button></div>
              </article>;
            })}
          </div>
          {pagination && pagination.totalPages > 1 && <nav className="participant-pagination" aria-label="Participant result pages"><button className="secondary" disabled={pagination.page <= 1 || searching} onClick={() => void runSearch(pagination.page - 1)}>Previous</button><span>Page {pagination.page} of {pagination.totalPages}</span><button className="secondary" disabled={pagination.page >= pagination.totalPages || searching} onClick={() => void runSearch(pagination.page + 1)}>Next</button></nav>}
        </> : null}
      </section>
    </div>
  );
}
