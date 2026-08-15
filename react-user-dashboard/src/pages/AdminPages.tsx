import { ArrowPathIcon, ChevronDownIcon, FunnelIcon, ShieldCheckIcon } from "@heroicons/react/24/outline";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { LoadingState } from "../components/ui";
import apiClient from "../utils/apiClient";
import "./AuditLogsPage.css";

type AuditActor = { id: string; fullName?: string | null; email?: string | null };
export type AuditEntry = {
  id: string;
  source: "APPLICATION" | "AUTHENTICATION" | "EVENT";
  occurredAt: string;
  action: string;
  outcome: "SUCCESS" | "FAILED" | "DENIED";
  actor: AuditActor | null;
  eventId: string | null;
  entityName: string | null;
  entityId: string | null;
  requestId: string | null;
  ipAddress?: string | null;
  deviceName?: string | null;
  details: unknown;
  oldValue: unknown;
  newValue: unknown;
};
type AuditListResponse = { items: AuditEntry[]; nextCursor: string | null };
type Filters = { entityName: string; action: string; eventType: string; outcome: string; from: string; to: string };

const EMPTY_FILTERS: Filters = { entityName: "", action: "", eventType: "", outcome: "", from: "", to: "" };
const OUTCOMES = ["SUCCESS", "FAILED", "DENIED"] as const;
const paramsFor = (filters: Filters, cursor?: string | null) => Object.fromEntries(
  Object.entries({ limit: 50, ...filters, cursor }).filter(([, value]) => value !== "" && value != null),
);
const timestamp = (value: string) => new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "medium" });
const actorName = (actor: AuditActor | null) => actor?.fullName || actor?.email || "System process";
const evidenceExists = (entry: AuditEntry) => Boolean(entry.details || entry.oldValue || entry.newValue || entry.requestId || entry.eventId || entry.ipAddress || entry.deviceName);
const requestError = (error: unknown) => {
  const response = (error as { response?: { status?: number; data?: { message?: string } } })?.response;
  return { status: response?.status, message: response?.data?.message || "The audit history could not be loaded." };
};

function Evidence({ label, value }: { label: string; value: unknown }) {
  if (value == null) return null;
  return <div className="audit-evidence-block"><h4>{label}</h4><pre>{JSON.stringify(value, null, 2)}</pre></div>;
}

export function AuditLogsPage() {
  const [items, setItems] = useState<AuditEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [draft, setDraft] = useState<Filters>(EMPTY_FILTERS);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [reloadKey, setReloadKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [restricted, setRestricted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(null); setRestricted(false); setLoadMoreError(null);
    void apiClient.get<AuditListResponse>("/admin/audit-logs", { params: paramsFor(filters), signal: controller.signal })
      .then(({ data }) => { setItems(data.items ?? []); setNextCursor(data.nextCursor ?? null); })
      .catch((cause: unknown) => {
        if ((cause as { code?: string })?.code === "ERR_CANCELED") return;
        const problem = requestError(cause);
        if (problem.status === 403) setRestricted(true); else setError(problem.message);
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [filters, reloadKey]);

  const apply = (event: FormEvent) => { event.preventDefault(); setFilters({ ...draft }); setReloadKey((value) => value + 1); };
  const clear = () => { setDraft(EMPTY_FILTERS); setFilters(EMPTY_FILTERS); setReloadKey((value) => value + 1); };
  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true); setLoadMoreError(null);
    try {
      const { data } = await apiClient.get<AuditListResponse>("/admin/audit-logs", { params: paramsFor(filters, nextCursor) });
      setItems((current) => [...current, ...(data.items ?? [])]); setNextCursor(data.nextCursor ?? null);
    } catch (cause) { setLoadMoreError(requestError(cause).message); }
    finally { setLoadingMore(false); }
  }, [filters, loadingMore, nextCursor]);

  return <div className="audit-page page-frame">
    <header className="audit-page-heading">
      <div><p className="audit-kicker"><ShieldCheckIcon aria-hidden="true" />Security evidence</p><h1>Audit history</h1><p>One chronological, append-only view of application, authentication, and event activity.</p></div>
      <div className="audit-heading-stat" aria-label={`${items.length} audit records loaded`}><strong>{items.length}</strong><span>records loaded</span></div>
    </header>

    <form className="audit-filters" onSubmit={apply}>
      <div className="audit-filter-heading"><span><FunnelIcon aria-hidden="true" />Filter evidence</span><button type="button" onClick={clear}>Clear</button></div>
      <div className="audit-filter-grid">
        <label>Entity<input value={draft.entityName} onChange={(event) => setDraft({ ...draft, entityName: event.target.value })} placeholder="Event, Referral..." maxLength={50} /></label>
        <label>Action<input value={draft.action} onChange={(event) => setDraft({ ...draft, action: event.target.value })} placeholder="QUEUE_JOINED..." maxLength={100} /></label>
        <label>Authentication event<input value={draft.eventType} onChange={(event) => setDraft({ ...draft, eventType: event.target.value })} placeholder="LOGIN_FAILED..." maxLength={50} /></label>
        <label>Outcome<select value={draft.outcome} onChange={(event) => setDraft({ ...draft, outcome: event.target.value })}><option value="">All outcomes</option>{OUTCOMES.map((outcome) => <option key={outcome}>{outcome}</option>)}</select></label>
        <label>From<input type="datetime-local" value={draft.from} onChange={(event) => setDraft({ ...draft, from: event.target.value })} /></label>
        <label>To<input type="datetime-local" value={draft.to} onChange={(event) => setDraft({ ...draft, to: event.target.value })} /></label>
      </div>
      <button className="audit-apply" type="submit">Apply filters</button>
    </form>

    {loading && <LoadingState label="Loading audit history..." />}
    {!loading && restricted && <section className="audit-state audit-state-restricted" role="alert"><ShieldCheckIcon aria-hidden="true" /><div><h2>Administrator access required</h2><p>This system-wide history is limited to accounts with the audit:read permission.</p></div></section>}
    {!loading && error && <section className="audit-state" role="alert"><div><h2>Audit history unavailable</h2><p>{error}</p></div><button type="button" onClick={() => setReloadKey((value) => value + 1)}><ArrowPathIcon aria-hidden="true" />Try again</button></section>}
    {!loading && !error && !restricted && items.length === 0 && <section className="audit-state"><div><h2>No matching evidence</h2><p>No audit records match the current filters. Clear the filters or broaden the time range.</p></div></section>}

    {!loading && !error && !restricted && items.length > 0 && <section className="audit-timeline" aria-label="Audit records">
      <div className="audit-list-heading" aria-hidden="true"><span>Time and source</span><span>Activity</span><span>Actor</span><span>Outcome</span></div>
      <ol>{items.map((entry) => <li key={`${entry.source}-${entry.id}`}><article className="audit-record">
        <div className="audit-time"><time dateTime={entry.occurredAt}>{timestamp(entry.occurredAt)}</time><span className={`audit-source audit-source-${entry.source.toLowerCase()}`}>{entry.source}</span></div>
        <div className="audit-activity"><strong>{entry.action}</strong><span>{entry.entityName || "System"}{entry.entityId ? ` · ${entry.entityId}` : ""}</span></div>
        <div className="audit-actor"><strong>{actorName(entry.actor)}</strong><span>{entry.actor?.email && entry.actor.fullName ? entry.actor.email : entry.deviceName || "Trusted service"}</span></div>
        <span className={`audit-outcome audit-outcome-${entry.outcome.toLowerCase()}`}>{entry.outcome}</span>
        {evidenceExists(entry) && <details className="audit-details"><summary><ChevronDownIcon aria-hidden="true" />Evidence details</summary>
          <dl className="audit-metadata">{entry.requestId && <><dt>Request ID</dt><dd>{entry.requestId}</dd></>}{entry.eventId && <><dt>Event ID</dt><dd>{entry.eventId}</dd></>}{entry.ipAddress && <><dt>IP address</dt><dd>{entry.ipAddress}</dd></>}{entry.deviceName && <><dt>Device</dt><dd>{entry.deviceName}</dd></>}</dl>
          <div className="audit-evidence-grid"><Evidence label="Details" value={entry.details} /><Evidence label="Before" value={entry.oldValue} /><Evidence label="After" value={entry.newValue} /></div>
        </details>}
      </article></li>)}</ol>
      {loadMoreError && <p className="audit-load-error" role="alert">{loadMoreError}</p>}
      {nextCursor && <button className="audit-load-more" type="button" onClick={() => void loadMore()} disabled={loadingMore}>{loadingMore ? "Loading..." : "Load older records"}</button>}
    </section>}
  </div>;
}
