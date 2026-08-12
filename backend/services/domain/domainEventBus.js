/**
 * Domain Event Bus (transactional outbox + in-process handler registry)
 * ---------------------------------------------------------------------
 * Producers call `emit` inside the same database transaction that commits a
 * state change, so the event row commits atomically with the change. The
 * dedicated domain-event worker (`scripts/domain-event-worker.js`) claims
 * pending rows and dispatches them to every registered handler for that event
 * type with retry/backoff and dead-letter semantics (at-least-once delivery).
 *
 * Handlers receive `{ event, context }` where context exposes the database
 * client, logger, and an `emit` helper so handlers can publish follow-up
 * (chained) events. Handlers must be idempotent: a handler that throws will
 * cause the whole event to be retried.
 */

const crypto = require("node:crypto");
const prisma = require("../../prisma/prismaClient");
const AppError = require("../../errors/AppError");
const logger = require("../../utils/logging/logger/logger");

const MAX_ATTEMPTS = 5;
const LEASE_MS = 5 * 60 * 1000;
const MAX_PAYLOAD_BYTES = 8192;
const CLAIMABLE_STATUSES = ["PENDING", "FAILED"];
const RECLAIMABLE_STATUSES = ["PROCESSING"];

// type -> [{ id, handler }]
const handlers = new Map();

const safeErrorCode = (error) => String(error?.code || error?.name || "DOMAIN_EVENT_HANDLER_FAILED")
  .replace(/[^A-Z0-9_-]/gi, "_")
  .slice(0, 80);

const backoffMs = (attemptCount) => Math.min(5 * 60 * 1000, 1000 * (2 ** Math.max(0, attemptCount - 1)));

const sanitizePayload = (value) => {
  let serialized;
  try {
    serialized = JSON.stringify(value ?? {});
  } catch {
    throw new AppError(422, "DOMAIN_EVENT_PAYLOAD_INVALID", "Domain event payload must be JSON-serializable");
  }
  if (serialized === undefined) throw new AppError(422, "DOMAIN_EVENT_PAYLOAD_INVALID", "Domain event payload must be an object");
  const parsed = JSON.parse(serialized);
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new AppError(422, "DOMAIN_EVENT_PAYLOAD_INVALID", "Domain event payload must be a JSON object");
  }
  if (Buffer.byteLength(serialized) > MAX_PAYLOAD_BYTES) {
    throw new AppError(422, "DOMAIN_EVENT_PAYLOAD_TOO_LARGE", `Domain event payload exceeds the ${MAX_PAYLOAD_BYTES}-byte limit`);
  }
  return parsed;
};

/**
 * Register a handler for an event type. Handlers run in registration order.
 * Returns a handle used by `unregisterHandler`.
 */
function registerHandler(type, handler) {
  if (!Array.isArray(type) && (typeof type !== "string" || !type.trim())) {
    throw new TypeError("Domain event handler must be registered for a non-empty event type");
  }
  if (typeof handler !== "function") throw new TypeError("Domain event handler must be a function");
  const ids = [];
  for (const eventType of Array.isArray(type) ? type : [type]) {
    if (!handlers.has(eventType)) handlers.set(eventType, []);
    const id = `${eventType}:${handlers.get(eventType).length}`;
    handlers.get(eventType).push({ id, handler });
    ids.push(id);
  }
  return Array.isArray(type) ? ids : ids[0];
}

function unregisterHandler(handle) {
  const handles = Array.isArray(handle) ? handle : [handle];
  let removed = 0;
  for (const [eventType, entries] of handlers) {
    const before = entries.length;
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      if (handles.includes(entries[index].id)) entries.splice(index, 1);
    }
    if (!entries.length) handlers.delete(eventType);
    removed += before - entries.length;
  }
  return removed > 0;
}

function resetHandlers() {
  handlers.clear();
}

function handlersFor(type) {
  return handlers.get(type) || [];
}

const clockNow = (overrides) => (overrides?.now ? overrides.now() : new Date());

/**
 * Emit a domain event. Pass the transaction (`tx`) from the calling service so
 * the event row commits atomically with the state change. Returns the row.
 */
async function emit({
  client = prisma,
  type,
  aggregateType,
  aggregateId,
  context,
  correlationId,
  actorUserId = null,
  payload = {},
}) {
  if (typeof type !== "string" || !type.trim()) throw new AppError(422, "DOMAIN_EVENT_TYPE_REQUIRED", "Domain event type is required");
  if (typeof aggregateType !== "string" || !aggregateType.trim()) throw new AppError(422, "DOMAIN_EVENT_AGGREGATE_REQUIRED", "Domain event aggregate is required");
  if (!aggregateId || typeof aggregateId !== "string") throw new AppError(422, "DOMAIN_EVENT_AGGREGATE_ID_REQUIRED", "Domain event aggregate identifier is required");
  return client.domainEvent.create({
    data: {
      type,
      aggregateType,
      aggregateId,
      correlationId: correlationId || context?.requestId || crypto.randomUUID(),
      actorUserId,
      payload: sanitizePayload(payload),
    },
  });
}

async function claimEvent(client, row, overrides) {
  const now = clockNow(overrides);
  const staleBefore = new Date(now.getTime() - (overrides?.leaseMs ?? LEASE_MS));
  const claimToken = crypto.randomUUID();
  const claimed = await client.domainEvent.updateMany({
    where: {
      id: row.id,
      attemptCount: { lt: row.maxAttempts },
      OR: [
        { status: { in: CLAIMABLE_STATUSES }, nextAttemptAt: { lte: now } },
        { status: { in: RECLAIMABLE_STATUSES }, claimedAt: { lte: staleBefore } },
      ],
    },
    data: {
      status: "PROCESSING",
      claimToken,
      claimedAt: now,
      attemptCount: { increment: 1 },
      lastErrorCode: null,
    },
  });
  if (claimed.count !== 1) return { event: row, accepted: false, pending: false, reason: "NOT_CLAIMABLE" };
  return {
    event: await client.domainEvent.findUniqueOrThrow({ where: { id: row.id } }),
    claimToken,
    accepted: true,
    pending: false,
  };
}

async function markDispatched(client, claim, overrides, reason) {
  await client.domainEvent.updateMany({
    where: { id: claim.event.id, claimToken: claim.claimToken, status: "PROCESSING" },
    data: { status: "DISPATCHED", claimToken: null, claimedAt: null, lastErrorCode: reason || null, dispatchedAt: clockNow(overrides) },
  });
}

async function markFailed(client, claim, overrides, errorCode) {
  const now = clockNow(overrides);
  const exhausted = claim.event.attemptCount >= claim.event.maxAttempts;
  await client.domainEvent.updateMany({
    where: { id: claim.event.id, claimToken: claim.claimToken, status: "PROCESSING" },
    data: exhausted
      ? { status: "DEAD_LETTER", claimToken: null, claimedAt: null, lastErrorCode: errorCode, dispatchedAt: now }
      : {
        status: "FAILED",
        claimToken: null,
        claimedAt: null,
        lastErrorCode: errorCode,
        nextAttemptAt: new Date(now.getTime() + backoffMs(claim.event.attemptCount)),
      },
  });
}

async function freshEvent(client, claim) {
  return client.domainEvent.findUniqueOrThrow({ where: { id: claim.event.id } });
}

/**
 * Dispatch a single pending event to its registered handlers. Used by the
 * worker's poll cycle and available for admin/dev draining and tests.
 */
async function dispatchEvent(row, overrides = {}) {
  const client = overrides.prisma || prisma;
  const eventLogger = overrides.logger || logger;
  const claim = await claimEvent(client, row, overrides);
  if (!claim.claimToken) return claim;

  const matches = handlersFor(row.type);
  if (matches.length === 0) {
    await markDispatched(client, claim, overrides, "NO_HANDLERS");
    const updated = await freshEvent(client, claim);
    eventLogger.info("domain_event.dispatched", {
      eventId: updated.id,
      type: updated.type,
      requestId: updated.correlationId,
      status: updated.status,
      reason: "NO_HANDLERS",
    });
    return { event: updated, accepted: true, pending: false, reason: "NO_HANDLERS" };
  }

  let failureCode = null;
  let failureHandler = null;
  for (const entry of matches) {
    try {
      await entry.handler({
        event: claim.event,
        context: {
          db: client,
          logger: eventLogger,
          emit: (input) => emit({ client: overrides.prisma || prisma, ...input }),
        },
      });
    } catch (error) {
      failureCode = safeErrorCode(error);
      failureHandler = entry.id;
      break;
    }
  }

  if (failureCode) {
    await markFailed(client, claim, overrides, failureCode);
    const updated = await freshEvent(client, claim);
    eventLogger.warn("domain_event.handler_failed", {
      eventId: updated.id,
      type: updated.type,
      requestId: updated.correlationId,
      handler: failureHandler,
      code: failureCode,
      status: updated.status,
    });
    return {
      event: updated,
      accepted: true,
      pending: updated.status === "FAILED",
      reason: updated.status === "DEAD_LETTER" ? "DEAD_LETTER" : "RETRY_QUEUED",
    };
  }

  await markDispatched(client, claim, overrides);
  const updated = await freshEvent(client, claim);
  eventLogger.info("domain_event.dispatched", {
    eventId: updated.id,
    type: updated.type,
    requestId: updated.correlationId,
    status: updated.status,
  });
  return { event: updated, accepted: true, pending: false };
}

/**
 * One poll cycle: claim a batch of due events and dispatch each. Mirrors the
 * artifact-cleanup / report worker claim semantics (lease + CAS).
 */
async function processNextDomainEvents({ limit = 25 } = {}, overrides = {}) {
  const client = overrides.prisma || prisma;
  const now = clockNow(overrides);
  const staleBefore = new Date(now.getTime() - (overrides?.leaseMs ?? LEASE_MS));
  const candidates = await client.domainEvent.findMany({
    where: {
      OR: [
        { status: { in: CLAIMABLE_STATUSES }, nextAttemptAt: { lte: now } },
        { status: { in: RECLAIMABLE_STATUSES }, claimedAt: { lte: staleBefore } },
      ],
    },
    orderBy: [{ nextAttemptAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    take: Math.min(100, Math.max(1, limit)),
  });

  const summary = {
    attempted: candidates.length,
    dispatched: 0,
    retried: 0,
    deadLettered: 0,
    skipped: 0,
    events: [],
  };
  for (const candidate of candidates) {
    const result = await dispatchEvent(candidate, overrides);
    const status = result.event?.status;
    if (result.reason === "RETRY_QUEUED") summary.retried += 1;
    else if (result.reason === "DEAD_LETTER") summary.deadLettered += 1;
    else if (status === "DISPATCHED") summary.dispatched += 1;
    else summary.skipped += 1;
    summary.events.push({
      id: candidate.id,
      type: candidate.type,
      correlationId: result.event?.correlationId || candidate.correlationId,
      status: status || "PROCESSING",
      reason: result.reason || null,
    });
  }
  return summary;
}

module.exports = {
  MAX_ATTEMPTS,
  LEASE_MS,
  MAX_PAYLOAD_BYTES,
  emit,
  registerHandler,
  unregisterHandler,
  resetHandlers,
  handlersFor,
  dispatchEvent,
  processNextDomainEvents,
};
