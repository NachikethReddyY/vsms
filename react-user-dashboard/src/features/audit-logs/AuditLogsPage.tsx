import { useCallback, useEffect, useMemo, useState } from 'react';
import './AuditLogsPage.css';

/**
 * Audit Logs — Admin dashboard page
 * -----------------------------------------------------------------------
 * Covers OWASP A09 (Security Logging & Monitoring Failures) evidence for
 * the VSMS project: this page is the read-only surface administrators use
 * to review who did what, when, from where, and whether it succeeded.
 *
 * - Route-guarded: only rendered for users with the Administrator role
 *   (see <RequireRole> usage in your router / App.tsx). The page also
 *   defends itself in case that guard is ever bypassed.
 * - All querying (search, filter, sort, paginate) happens server-side via
 *   the backend contract described in auditLogs.routes.js, so the table
 *   scales past the 5,000-row sample volume in the project spec.
 */

type AuditStatus = 'SUCCESS' | 'FAILED' | 'WARNING';

interface AuditLogEntry {
  id: string;
  timestamp: string; // ISO 8601
  actorEmail: string;
  actorRole: string;
  action: string; // e.g. "PARTICIPANT_UPDATE", "LOGIN", "REFERRAL_CREATE"
  targetResource: string; // e.g. "participant", "event", "user"
  targetId: string | null;
  ipAddress: string;
  status: AuditStatus;
  details?: string;
}

interface AuditLogResponse {
  data: AuditLogEntry[];
  page: number;
  pageSize: number;
  totalCount: number;
}

type SortField = 'timestamp' | 'actorEmail' | 'action' | 'status';
type SortDir = 'asc' | 'desc';

const PAGE_SIZE = 25;
const STATUS_FILTERS: Array<AuditStatus | 'ALL'> = ['ALL', 'SUCCESS', 'FAILED', 'WARNING'];

// Adjust to match how the rest of the app resolves its API base URL.
const API_BASE = import.meta.env?.VITE_API_BASE_URL ?? '/api/v1';

interface AuditLogsPageProps {
  /** Current user's role, as decoded from the JWT. Defaults to a safe deny. */
  currentUserRole?: string;
  /** Bearer token to attach to the audit-log request. */
  authToken?: string | null;
}

export default function AuditLogsPage({
  currentUserRole = '',
  authToken = typeof window !== 'undefined' ? window.localStorage.getItem('vsms_access_token') : null,
}: AuditLogsPageProps) {
  const isAdmin = currentUserRole === 'Administrator';

  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<AuditStatus | 'ALL'>('ALL');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sortField, setSortField] = useState<SortField>('timestamp');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const [status, setStatus] = useState<'idle' | 'loading' | 'error' | 'ready'>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  // Debounce free-text search so we don't fire a request per keystroke.
  useEffect(() => {
    const handle = setTimeout(() => setDebouncedSearch(search.trim()), 350);
    return () => clearTimeout(handle);
  }, [search]);

  // Reset to page 1 whenever a filter changes.
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, statusFilter, dateFrom, dateTo, sortField, sortDir]);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('pageSize', String(PAGE_SIZE));
    params.set('sortField', sortField);
    params.set('sortDir', sortDir);
    if (debouncedSearch) params.set('search', debouncedSearch);
    if (statusFilter !== 'ALL') params.set('status', statusFilter);
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo) params.set('dateTo', dateTo);
    return params.toString();
  }, [page, sortField, sortDir, debouncedSearch, statusFilter, dateFrom, dateTo]);

  const fetchLogs = useCallback(async () => {
    if (!isAdmin) return;
    setStatus('loading');
    setErrorMessage('');
    try {
      const res = await fetch(`${API_BASE}/audit-logs?${queryString}`, {
        headers: {
          Authorization: `Bearer ${authToken ?? ''}`,
          Accept: 'application/json',
        },
      });

      if (res.status === 401) {
        setErrorMessage('Your session has expired. Please log in again.');
        setStatus('error');
        return;
      }
      if (res.status === 403) {
        setErrorMessage('You do not have permission to view audit logs.');
        setStatus('error');
        return;
      }
      if (!res.ok) {
        setErrorMessage(`Could not load audit logs (HTTP ${res.status}).`);
        setStatus('error');
        return;
      }

      const body: AuditLogResponse = await res.json();
      setEntries(body.data);
      setTotalCount(body.totalCount);
      setStatus('ready');
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (err) {
      setErrorMessage('Network error while loading audit logs. If you are offline, audit logs are not cached locally by design.');
      setStatus('error');
    }
  }, [isAdmin, queryString, authToken]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const toggleSort = (field: SortField) => {
    if (field === sortField) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  const sortIndicator = (field: SortField) => (field === sortField ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '');

  if (!isAdmin) {
    return (
      <div className="audit">
        <div className="audit-denied">
          <strong>Restricted</strong>
          <p>Audit logs are visible to Administrator accounts only. Contact your event administrator if you need access.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="audit">
      <div className="audit-head">
        <div>
          <p className="audit-eyebrow">Security &amp; compliance</p>
          <h1 className="audit-title">Audit logs</h1>
          <p className="audit-sub">
            Every authentication, registration, screening, review, referral and admin action recorded across VSMS events,
            in one traceable, read-only view.
          </p>
        </div>
        <div className="audit-count">
          <strong>{totalCount.toLocaleString()}</strong>
          <span>events on record</span>
        </div>
      </div>

      <div className="audit-controls">
        <div className="audit-search">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="7" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input
            type="text"
            placeholder="Search by user email, IP address, or resource…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search audit logs"
          />
        </div>

        <input
          className="audit-date"
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          aria-label="From date"
        />
        <input
          className="audit-date"
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          aria-label="To date"
        />

        <div className="audit-chips" role="group" aria-label="Filter by status">
          {STATUS_FILTERS.map((s) => (
            <button
              key={s}
              type="button"
              className="audit-chip"
              data-status={s}
              data-active={statusFilter === s}
              onClick={() => setStatusFilter(s)}
            >
              {s === 'ALL' ? 'All statuses' : s}
            </button>
          ))}
        </div>
      </div>

      <div className="audit-table-wrap">
        <table className="audit-table">
          <thead>
            <tr>
              <th onClick={() => toggleSort('timestamp')}>Timestamp{sortIndicator('timestamp')}</th>
              <th onClick={() => toggleSort('actorEmail')}>User{sortIndicator('actorEmail')}</th>
              <th onClick={() => toggleSort('action')}>Action{sortIndicator('action')}</th>
              <th>Resource</th>
              <th>IP address</th>
              <th onClick={() => toggleSort('status')}>Status{sortIndicator('status')}</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {status === 'loading' &&
              Array.from({ length: 8 }).map((_, i) => (
                <tr className="audit-skeleton-row" key={i}>
                  {Array.from({ length: 7 }).map((__, j) => (
                    <td key={j}>
                      <div className="audit-skeleton-bar" />
                    </td>
                  ))}
                </tr>
              ))}

            {status === 'ready' &&
              entries.map((entry) => (
                <tr key={entry.id}>
                  <td className="audit-mono">{formatTimestamp(entry.timestamp)}</td>
                  <td className="audit-user">
                    <strong>{entry.actorEmail}</strong>
                    <span>{entry.actorRole}</span>
                  </td>
                  <td>{formatAction(entry.action)}</td>
                  <td>
                    {entry.targetResource}
                    {entry.targetId ? <span className="audit-mono"> · {entry.targetId}</span> : null}
                  </td>
                  <td className="audit-mono">{entry.ipAddress}</td>
                  <td>
                    <span className="audit-status" data-status={entry.status}>
                      {entry.status}
                    </span>
                  </td>
                  <td className="wrap">{entry.details ?? '—'}</td>
                </tr>
              ))}
          </tbody>
        </table>

        {status === 'ready' && entries.length === 0 && (
          <div className="audit-state">
            <strong>No matching events</strong>
            <p>Try widening the date range or clearing filters.</p>
          </div>
        )}

        {status === 'error' && (
          <div className="audit-state">
            <strong>Couldn't load audit logs</strong>
            <p>{errorMessage}</p>
          </div>
        )}
      </div>

      {status === 'ready' && totalCount > 0 && (
        <div className="audit-pager">
          <span>
            Page {page} of {totalPages} · {totalCount.toLocaleString()} total events
          </span>
          <div className="audit-pager-btns">
            <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              ← Previous
            </button>
            <button type="button" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return iso;
  }
}

function formatAction(action: string): string {
  return action
    .toLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}