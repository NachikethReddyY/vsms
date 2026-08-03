import { CalendarDaysIcon, ClockIcon, MapPinIcon } from '@heroicons/react/24/outline';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getApiError as getApiMessage } from '../../utils/apiClient';
import { eventApi, formatEventDate, STATUS_LABEL, type PublicEvent } from './eventApi';
import { getEventArtwork } from './eventBanners';
import './EventWorkspace.css';

const formatDay = (value: string) => new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`));
const formatTime = (value: string, timezone: string) => new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZone: timezone }).format(new Date(value));

export default function PublicEventPage() {
  const { eventId = '' } = useParams();
  const [event, setEvent] = useState<PublicEvent | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    setEvent(null); setError('');
    eventApi.publicGet(eventId, controller.signal)
      .then((result) => { if (!controller.signal.aborted) setEvent(result); })
      .catch((cause) => { if (!controller.signal.aborted) setError(getApiMessage(cause, 'This event is unavailable.')); });
    return () => controller.abort();
  }, [eventId]);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = `${event?.name ?? (error ? 'Event unavailable' : 'Event')} · VSMS`;
    return () => { document.title = previousTitle; };
  }, [error, event?.name]);

  if (error) return <main className="public-event-page"><section className="public-event-state" role="alert"><h1>Event unavailable</h1><p>{error}</p><Link to="/">Return to VSMS</Link></section></main>;
  if (!event) return <main className="public-event-page"><section className="public-event-state" aria-live="polite"><h1>Loading event</h1></section></main>;

  return <main className="public-event-page">
    <div className="public-event-shell">
      <Link className="public-event-brand" to="/"><span aria-hidden="true">V</span>VSMS</Link>
      <section className="public-event-hero" aria-labelledby="public-event-title">
        <div className="public-event-copy">
          <span className={`workspace-status status-${event.status.toLowerCase()}`}><i aria-hidden="true" />{STATUS_LABEL[event.status]}</span>
          <h1 id="public-event-title">{event.name}</h1>
          <p>{event.status === 'CANCELLED' ? 'This event has been cancelled.' : event.description || 'Event details are available to registered staff.'}</p>
        </div>
        <div className="public-event-cover"><img src={getEventArtwork(event.bannerKey, event.artworkDataUrl)} alt="" /></div>
      </section>
      <section className="public-event-details" aria-label="Event information">
        <section><CalendarDaysIcon aria-hidden="true" /><h2>When</h2><strong>{formatEventDate(event.startsAt, event.timezone, false)}</strong><p>{formatTime(event.startsAt, event.timezone)}–{formatTime(event.endsAt, event.timezone)} · {event.timezone}</p></section>
        <section><MapPinIcon aria-hidden="true" /><h2>Where</h2><strong>{event.venue}</strong><p>{event.address || 'Address shared by event staff'}{event.postalCode ? ` · ${event.postalCode}` : ''}</p></section>
        <section><ClockIcon aria-hidden="true" /><h2>Event days</h2>{event.eventDays.length ? <ul>{event.eventDays.map((day) => <li key={day.eventDayId}>{formatDay(day.date)} · {formatTime(day.startsAt, event.timezone)}–{formatTime(day.endsAt, event.timezone)}</li>)}</ul> : <p>Single-day event.</p>}</section>
        <section><h2>Registration</h2><strong>{event.status === 'CANCELLED' ? 'Registration closed' : `Capacity ${event.capacity.toLocaleString()}`}</strong><p>{event.status === 'CANCELLED' ? 'This event is no longer accepting attendees.' : 'Registration is managed by the event team.'}</p></section>
      </section>
      <footer className="public-event-footer"><span>Event details may change; confirm with the event organiser before travelling.</span><Link to="/">Staff sign in</Link></footer>
    </div>
  </main>;
}
