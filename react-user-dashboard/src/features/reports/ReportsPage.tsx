import {
  ArrowPathIcon,
  CalendarDaysIcon,
  CheckCircleIcon,
  ClockIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/button';
import { getApiError as getApiMessage } from '../../utils/apiClient';
import { reportApi, type OperationalReport, type ReportFilters } from './reportApi';
import './ReportsPage.css';

const localDate = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const defaultFilters = (): ReportFilters => {
  const from = new Date();
  from.setDate(from.getDate() - 30);
  const to = new Date();
  to.setDate(to.getDate() + 30);
  return { from: localDate(from), to: localDate(to) };
};

const count = new Intl.NumberFormat();
const formatDate = (value: string, timezone: string) => new Intl.DateTimeFormat(undefined, {
  day: 'numeric', month: 'short', year: 'numeric', timeZone: timezone,
}).format(new Date(value));

const eventStatus = (status: string) => status.toLowerCase().replace(/_/g, ' ').replace(/^\w/, (letter) => letter.toUpperCase());

export default function ReportsPage() {
  const [draft, setDraft] = useState<ReportFilters>(() => defaultFilters());
  const [filters, setFilters] = useState<ReportFilters>(() => defaultFilters());
  const [report, setReport] = useState<OperationalReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [validationError, setValidationError] = useState('');

  const loadReport = useCallback(async (nextFilters: ReportFilters, signal?: AbortSignal) => {
    setLoading(true);
    setError('');
    try {
      setReport(await reportApi.operations(nextFilters, signal));
    } catch (cause) {
      if (signal?.aborted) return;
      setError(getApiMessage(cause, 'Operational reports could not be loaded.'));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadReport(filters, controller.signal);
    return () => controller.abort();
  }, [filters, loadReport]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const from = new Date(`${draft.from}T00:00:00`);
    const to = new Date(`${draft.to}T00:00:00`);
    if (to < from) {
      setValidationError('End date must be on or after the start date.');
      return;
    }
    if (to.getTime() - from.getTime() > 366 * 86400000) {
      setValidationError('Choose a date range of 366 days or less.');
      return;
    }
    setValidationError('');
    setReport(null);
    setFilters(draft);
  };

  const summary = report?.summary;
  const selectedLabel = useMemo(() => report?.eventOptions.find((event) => event.eventId === filters.eventId)?.name, [filters.eventId, report]);
  const syncHasData = Boolean(summary?.sync.total);

  return (
    <div className="reports-page">
      <header className="reports-heading">
        <div>
          <h1>Operational reports</h1>
          <p>Aggregate event health for planning and follow-up. Participant identity and clinical detail are never included.</p>
        </div>
        <Button className="reports-refresh" variant="ghost" disabled={loading} onClick={() => void loadReport(filters)}>
          <ArrowPathIcon aria-hidden="true" />{loading ? 'Refreshing' : 'Refresh'}
        </Button>
      </header>

      <form className="reports-filters" onSubmit={submit} aria-describedby={validationError ? 'report-filter-error' : undefined}>
        <label>
          <span>Event</span>
          <select value={draft.eventId || ''} onChange={(event) => setDraft((current) => ({ ...current, eventId: event.target.value || undefined }))}>
            <option value="">All authorized events</option>
            {(report?.eventOptions || []).map((event) => (
              <option key={event.eventId} value={event.eventId}>{event.name} · {eventStatus(event.status)}</option>
            ))}
          </select>
        </label>
        <label>
          <span>From</span>
          <input type="date" required value={draft.from} onChange={(event) => setDraft((current) => ({ ...current, from: event.target.value }))} />
        </label>
        <label>
          <span>To</span>
          <input type="date" required min={draft.from} value={draft.to} onChange={(event) => setDraft((current) => ({ ...current, to: event.target.value }))} />
        </label>
        <Button type="submit" disabled={loading}>Apply filters</Button>
        {validationError && <p id="report-filter-error" className="reports-filter-error" role="alert">{validationError}</p>}
      </form>

      <p className="reports-scope">
        <CalendarDaysIcon aria-hidden="true" />
        {selectedLabel ? `${selectedLabel}, ` : 'Authorized events, '}{filters.from} to {filters.to}
      </p>

      {error ? (
        <section className="reports-state reports-error" role="alert">
          <ExclamationTriangleIcon aria-hidden="true" />
          <div><h2>Reports could not be loaded</h2><p>{error}</p></div>
          <Button variant="ghost" onClick={() => void loadReport(filters)}>Try again</Button>
        </section>
      ) : loading && !report ? (
        <section className="reports-state" aria-live="polite">
          <span className="spinner" aria-hidden="true" />
          <div><h2>Loading operational totals</h2><p>Counting authorized event records without loading participant details.</p></div>
        </section>
      ) : report && summary ? (
        <>
          <section className="reports-snapshot" aria-label="Operational summary" aria-busy={loading}>
            <article>
              <strong>{summary.registrations.completionRate}%</strong>
              <h2>Registration completion</h2>
              <p>{count.format(summary.registrations.completed)} of {count.format(summary.registrations.total)} completed</p>
            </article>
            <article>
              <strong>{count.format(summary.queue.waiting + summary.queue.active)}</strong>
              <h2>Queue workload</h2>
              <p>{count.format(summary.queue.waiting)} waiting · {count.format(summary.queue.active)} active</p>
            </article>
            <article className={summary.referrals.actionRequired ? 'attention' : ''}>
              <strong>{count.format(summary.referrals.actionRequired)}</strong>
              <h2>Referrals requiring action</h2>
              <p>{count.format(summary.referrals.sentOrAcknowledged)} sent or acknowledged</p>
            </article>
            <article className={summary.sync.issues ? 'attention' : ''}>
              <strong>{syncHasData ? count.format(summary.sync.issues) : '—'}</strong>
              <h2>Sync issues</h2>
              <p>{syncHasData ? `${count.format(summary.sync.applied)} applied · ${count.format(summary.sync.pending)} pending` : 'No sync activity recorded'}</p>
            </article>
          </section>

          {(summary.deliveries.issues > 0 || report.truncated || report.eventOptionsTruncated) && (
            <div className="reports-notices" aria-live="polite">
              {summary.deliveries.issues > 0 && <p><ExclamationTriangleIcon aria-hidden="true" />{count.format(summary.deliveries.issues)} referral {summary.deliveries.issues === 1 ? 'delivery needs' : 'deliveries need'} attention.</p>}
              {report.truncated && <p>Showing the first 100 matching events. Narrow the date or event filter to see a complete result.</p>}
              {report.eventOptionsTruncated && <p>The event selector shows the 100 most recent authorized events.</p>}
            </div>
          )}

          {report.events.length ? (
            <section className="reports-table-section" aria-labelledby="event-report-title">
              <div className="reports-table-heading">
                <div><h2 id="event-report-title">Event breakdown</h2><p>{count.format(summary.events)} matching {summary.events === 1 ? 'event' : 'events'}</p></div>
                {loading && <span aria-live="polite">Updating…</span>}
              </div>
              <div className="reports-table-scroll" tabIndex={0} aria-label="Scrollable event report table">
                <table>
                  <caption className="sr-only">Aggregate operational metrics by event</caption>
                  <thead><tr><th scope="col">Event</th><th scope="col">Registrations</th><th scope="col">Queue</th><th scope="col">Referrals</th><th scope="col">Sync</th></tr></thead>
                  <tbody>{report.events.map((event) => (
                    <tr key={event.eventId}>
                      <th scope="row"><strong>{event.name}</strong><span>{formatDate(event.startsAt, event.timezone)} · {eventStatus(event.status)}</span></th>
                      <td><strong>{event.registrations.completionRate}% complete</strong><span>{count.format(event.registrations.completed)} of {count.format(event.registrations.total)}</span></td>
                      <td><strong>{count.format(event.queue.waiting)} waiting</strong><span>{count.format(event.queue.active)} active · {count.format(event.queue.completed)} complete</span></td>
                      <td><strong>{count.format(event.referrals.actionRequired)} need action</strong><span>{count.format(event.referrals.sentOrAcknowledged)} sent or acknowledged</span></td>
                      <td className={event.sync.issues ? 'has-issue' : ''}><strong>{event.sync.total ? `${count.format(event.sync.issues)} issues` : 'No activity'}</strong><span>{event.sync.total ? `${count.format(event.sync.applied)} applied · ${count.format(event.sync.pending)} pending` : 'No sync actions recorded'}</span></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </section>
          ) : (
            <section className="reports-state reports-empty" aria-live="polite">
              <ClockIcon aria-hidden="true" />
              <div><h2>No events match these filters</h2><p>Choose another event or widen the event-date range. Only events you are authorized to manage are included.</p></div>
            </section>
          )}

          <footer className="reports-footnote">
            <CheckCircleIcon aria-hidden="true" />
            <p>Counts are operational aggregates. Referral delivery and sync health show status only; sensitive content is excluded.</p>
          </footer>
        </>
      ) : null}
    </div>
  );
}
