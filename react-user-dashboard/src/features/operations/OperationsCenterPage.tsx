import {
  ArrowPathIcon,
  ArrowRightIcon,
  CheckCircleIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  MagnifyingGlassIcon,
  MapPinIcon,
  SignalIcon,
  UserGroupIcon,
} from '@heroicons/react/24/outline';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { getApiError } from '../../utils/apiClient';
import { operationsApi, type OperationsEvent, type OperationsOverview, type OperationsStatusFilter } from './operationsApi';
import './OperationsCenterPage.css';

const POLL_INTERVAL_MS = 15_000;
const FILTERS: Array<{ value: OperationsStatusFilter; label: string }> = [
  { value: 'ACTIVE', label: 'Active' },
  { value: 'UPCOMING', label: 'Upcoming' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'ALL', label: 'All' },
];
const count = new Intl.NumberFormat();

function sentenceCase(value: string) {
  return value.toLowerCase().replace(/_/g, ' ').replace(/^\w/, (letter) => letter.toUpperCase());
}

function eventDate(event: OperationsEvent) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: event.timezone,
  }).format(new Date(event.startsAt));
}

function relativeUpdate(value: string) {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 5) return 'Updated just now';
  if (seconds < 60) return `Updated ${seconds}s ago`;
  return `Updated ${Math.floor(seconds / 60)}m ago`;
}

function progressPercent(event: OperationsEvent) {
  return event.progress.total ? Math.round((event.progress.completed / event.progress.total) * 100) : 0;
}

function metric(value: number | null, suffix = '') {
  return value == null ? 'Not measured' : `${count.format(value)}${suffix}`;
}

function registrationDuration(seconds: number | null) {
  if (seconds == null) return 'Not measured';
  return seconds < 60 ? `${count.format(seconds)} sec` : `${(seconds / 60).toFixed(1)} min`;
}

function EventOperation({ event }: { event: OperationsEvent }) {
  const activeQueue = event.queue.called + event.queue.inProgress;
  const progress = progressPercent(event);
  const canOpenQueue = event.status === 'IN_PROGRESS';

  return (
    <article className={`operations-event severity-${event.attention.severity}`}>
      <header className="operations-event-heading">
        <div className="operations-event-title">
          <div className="operations-status-line">
            <span className={`operations-status status-${event.status.toLowerCase()}`}><i aria-hidden="true" />{event.status === 'IN_PROGRESS' ? 'Live' : sentenceCase(event.status)}</span>
            {event.attention.severity !== 'normal' && <span className={`operations-attention attention-${event.attention.severity}`}><ExclamationTriangleIcon aria-hidden="true" />{event.attention.severity === 'critical' ? 'Action needed' : 'Needs attention'}</span>}
          </div>
          <h2>{event.name}</h2>
          <p><MapPinIcon aria-hidden="true" />{event.venue}<span aria-hidden="true">·</span><ClockIcon aria-hidden="true" />{eventDate(event)}</p>
        </div>
        <div className="operations-event-actions">
          {canOpenQueue && <Link to={`/events/${event.eventId}/queue`}>Live queue</Link>}
          <Link className="operations-primary-link" to={`/events/${event.eventId}/overview`}>Open event<ArrowRightIcon aria-hidden="true" /></Link>
        </div>
      </header>

      <div className="operations-event-grid">
        <section className="operations-progress" aria-label={`${event.name} participant progress`}>
          <div className="operations-section-heading"><h3>Participant progress</h3><strong>{progress}%</strong></div>
          <div className="operations-progress-track" role="progressbar" aria-label={`${progress}% of registrations completed`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><span style={{ width: `${progress}%` }} /></div>
          <dl className="operations-inline-metrics">
            <div><dt>Registered</dt><dd>{count.format(event.progress.total)}</dd></div>
            <div><dt>Checked in</dt><dd>{count.format(event.progress.checkedIn)}</dd></div>
            <div><dt>Screened</dt><dd>{count.format(event.progress.screened)}</dd></div>
            <div><dt>Completed</dt><dd>{count.format(event.progress.completed)}</dd></div>
          </dl>
        </section>

        <section className="operations-queue" aria-label={`${event.name} queue health`}>
          <div className="operations-section-heading"><h3>Queue</h3>{event.queue.longestWaitMinutes > 0 && <span>Longest {event.queue.longestWaitMinutes} min</span>}</div>
          <dl className="operations-inline-metrics compact">
            <div className={event.queue.waiting ? 'has-work' : ''}><dt>Waiting</dt><dd>{count.format(event.queue.waiting)}</dd></div>
            <div><dt>In service</dt><dd>{count.format(activeQueue)}</dd></div>
            <div className={event.queue.priority ? 'has-attention' : ''}><dt>Priority</dt><dd>{count.format(event.queue.priority)}</dd></div>
          </dl>
        </section>

        <section className="operations-stations" aria-label={`${event.name} station status`}>
          <div className="operations-section-heading"><h3>Stations</h3><span>{event.stations.available} available · {event.stations.total} total</span></div>
          {event.stations.items.length ? <ul>
            {event.stations.items.map((station) => (
              <li key={station.stationId}>
                <span className={`station-state station-${station.operationalStatus.toLowerCase()}`} aria-label={sentenceCase(station.operationalStatus)} />
                <strong>{station.name}</strong>
                <span>{station.queue.waiting} waiting · {station.queue.active} active</span>
                <em className={station.staffed ? '' : 'unfilled'}>{station.staffed ? 'Staffed' : 'Unstaffed'}</em>
              </li>
            ))}
          </ul> : <p className="operations-muted">No stations configured.</p>}
        </section>

        <section className="operations-staffing" aria-label={`${event.name} staff coverage`}>
          <div className="operations-section-heading"><h3>Staff coverage</h3><Link to={`/events/${event.eventId}/staff`}>Manage</Link></div>
          <div className="operations-staffing-total"><UserGroupIcon aria-hidden="true" /><strong>{event.staffing.assigned}/{event.staffing.required}</strong><span>{event.staffing.shiftName || 'No active or upcoming shift'}</span></div>
          {event.staffing.unfilled > 0 && <p className="operations-staffing-warning">{event.staffing.unfilled} shift {event.staffing.unfilled === 1 ? 'place' : 'places'} unfilled</p>}
          {event.attention.reasons.length > 0 && <ul className="operations-reasons">
            {event.attention.reasons.map((reason) => <li key={reason.code}>{reason.label}</li>)}
          </ul>}
        </section>

        <section className="operations-evidence" aria-label={`${event.name} business objective evidence`}>
          <div className="operations-section-heading"><h3>Business objective evidence</h3><span>{event.businessMetrics.measuredRegistrations} timed registrations</span></div>
          <dl className="operations-evidence-metrics">
            <div><dt>Median registration</dt><dd>{registrationDuration(event.businessMetrics.registrationDurationP50Seconds)}</dd><small>Workflow start to QR registration</small></div>
            <div><dt>Paperless cases</dt><dd>{metric(event.businessMetrics.paperlessRatePercent, '%')}</dd><small>Registrations without a declared paper exception</small></div>
            <div><dt>Queue wait p90</dt><dd>{metric(event.queue.waitP90Minutes, ' min')}</dd><small>90% of measured waits are at or below this value</small></div>
            <div><dt>Throughput</dt><dd>{metric(event.businessMetrics.completedVisitsPerHour, '/hr')}</dd><small>Completed station visits per event hour</small></div>
            <div><dt>Offline coverage</dt><dd>{metric(event.businessMetrics.offlineCoveragePercent, '%')}</dd><small>{event.stations.offlineCapable} of {event.stations.total} active stations</small></div>
            <div><dt>Sync success</dt><dd>{metric(event.sync.successRatePercent, '%')}</dd><small>{event.sync.pending} pending · {event.sync.issues} requiring attention</small></div>
            <div><dt>Same-day report</dt><dd>{event.businessMetrics.sameDayReportReady == null ? 'Not generated' : event.businessMetrics.sameDayReportReady ? 'Met' : 'Missed'}</dd><small>{event.businessMetrics.reportMinutesFromEventEnd == null ? 'No completed report evidence' : `${event.businessMetrics.reportMinutesFromEventEnd} min after event end`}</small></div>
          </dl>
        </section>
      </div>
    </article>
  );
}

export default function OperationsCenterPage() {
  const [filter, setFilter] = useState<OperationsStatusFilter>('ACTIVE');
  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState('');
  const [overview, setOverview] = useState<OperationsOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [, setClock] = useState(0);

  useEffect(() => {
    const timeout = window.setTimeout(() => setSearch(searchDraft.trim()), 300);
    return () => window.clearTimeout(timeout);
  }, [searchDraft]);

  const load = useCallback(async (signal?: AbortSignal, background = false) => {
    if (background) setRefreshing(true); else setLoading(true);
    try {
      const data = await operationsApi.overview({ status: filter, search }, signal);
      setOverview(data);
      setError('');
    } catch (cause) {
      if (!signal?.aborted) setError(getApiError(cause, 'Operations data could not be loaded.'));
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [filter, search]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    const interval = window.setInterval(() => void load(controller.signal, true), POLL_INTERVAL_MS);
    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, [load]);

  useEffect(() => {
    const interval = window.setInterval(() => setClock((value) => value + 1), 10_000);
    return () => window.clearInterval(interval);
  }, []);

  const summary = overview?.summary;
  const scopeLabel = useMemo(() => FILTERS.find((item) => item.value === filter)?.label ?? 'Active', [filter]);

  return (
    <div className="operations-page">
      <header className="operations-heading">
        <div><h1>Operations center</h1><p>Monitor event flow, queue pressure, station readiness, and staffing across your authorized events.</p></div>
        <button className="operations-refresh" type="button" onClick={() => void load(undefined, true)} disabled={refreshing} aria-label="Refresh operations data" title="Refresh operations data"><ArrowPathIcon className={refreshing ? 'is-spinning' : ''} aria-hidden="true" /></button>
      </header>

      <div className="operations-controls">
        <div className="operations-filters" role="radiogroup" aria-label="Event status">
          {FILTERS.map((item) => <button key={item.value} type="button" role="radio" aria-checked={filter === item.value} onClick={() => setFilter(item.value)}>{item.label}</button>)}
        </div>
        <label className="operations-search"><MagnifyingGlassIcon aria-hidden="true" /><span className="sr-only">Search events or venues</span><input value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder="Search events or venues" /></label>
        {overview && <span className="operations-updated" aria-live="polite"><SignalIcon aria-hidden="true" />{relativeUpdate(overview.generatedAt)}</span>}
      </div>

      {summary && <section className="operations-summary" aria-label={`${scopeLabel} event summary`} aria-busy={refreshing}>
        <dl>
          <div><dt>Events in view</dt><dd>{count.format(summary.events.total)}</dd></div>
          <div><dt>Checked in</dt><dd>{count.format(summary.participants.checkedIn)}</dd></div>
          <div><dt>Waiting now</dt><dd>{count.format(summary.queue.waiting)}</dd></div>
          <div className={summary.events.needsAttention ? 'summary-attention' : ''}><dt>Need attention</dt><dd>{count.format(summary.events.needsAttention)}</dd></div>
        </dl>
      </section>}

      {error && <div className={`operations-notice ${overview ? 'is-stale' : 'is-error'}`} role="alert"><ExclamationTriangleIcon aria-hidden="true" /><div><strong>{overview ? 'Live refresh paused' : 'Operations center unavailable'}</strong><p>{error} {overview ? 'Showing the last successful snapshot.' : 'Check your connection and try again.'}</p></div><button type="button" onClick={() => void load()}>Try again</button></div>}

      {loading && !overview ? <section className="operations-state" aria-live="polite"><span className="spinner" aria-hidden="true" /><div><h2>Building the operations view</h2><p>Collecting authorized aggregate event data.</p></div></section>
        : overview?.events.length ? <section className="operations-events" aria-label="Event operations list">{overview.events.map((event) => <EventOperation key={event.eventId} event={event} />)}</section>
          : overview ? <section className="operations-state"><CheckCircleIcon aria-hidden="true" /><div><h2>No {scopeLabel.toLowerCase()} events found</h2><p>{search ? 'Try a different event or venue search.' : 'Choose another status to review your event portfolio.'}</p></div></section> : null}

      {overview?.truncated && <p className="operations-truncated">Showing the first 50 matching events. Narrow your search to see a complete result.</p>}
      <footer className="operations-privacy"><CheckCircleIcon aria-hidden="true" />This view contains operational counts only. Participant identity and clinical details are excluded.</footer>
    </div>
  );
}
