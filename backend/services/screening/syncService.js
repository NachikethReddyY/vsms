const crypto = require("crypto");
const prisma = require("../../prisma/prismaClient");
const screeningService = require("./screeningService");
const { createAuditLog } = require("../../utils/audit");

const HANDLERS = {
  VISUAL_ACUITY: "saveVisualAcuity",
  REFRACTION: "saveRefraction",
  COLOUR_VISION: "saveColourVision",
  EYE_HEALTH: "saveEyeHealth",
  CUSTOM: "saveDynamic",
};

const SAFE_CONFLICT_CODES = new Set([
  "ACKNOWLEDGEMENT_REQUIRED",
  "EVENT_NOT_FOUND",
  "EVENT_NOT_IN_PROGRESS",
  "FORBIDDEN",
  "IDEMPOTENCY_KEY_REUSED",
  "INVALID_FIELD_SCHEMA",
  "INVALID_RESULT_DATA",
  "REGISTRATION_NOT_FOUND",
  "REGISTRATION_NOT_SCREENABLE",
  "SCREENER_ROLE_REQUIRED",
  "SCREENING_WRITE_CONFLICT",
  "SHIFT_NOT_ACTIVE",
  "STATION_NOT_FOUND",
  "STATION_SCHEMA_MISSING",
]);

const canonicalJson = (value) => {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalJson(value[key])]));
  }
  return value;
};

const requestFingerprint = ({ eventId, userId, action }) => crypto
  .createHash("sha256")
  .update(JSON.stringify(canonicalJson({ eventId, userId, action })))
  .digest("hex");

const withTransaction = (db, callback) => db.$transaction(callback);
const TERMINAL_STATUSES = new Set(["APPLIED", "CONFLICT", "FAILED"]);
const PROCESSING_LEASE_MS = 30_000;
const TERMINAL_WAIT_MS = 10_000;
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const safeResultSnapshot = (receipt) => {
  const result = receipt?.result || {};
  return {
    resultId: result.resultId,
    overallFlag: result.overallFlag,
    isFlagged: result.isFlagged,
    ruleVersion: result.ruleVersion || result.evaluation?.ruleVersion,
  };
};

const responseFor = (row) => ({
  clientActionId: row.clientActionId,
  status: row.status,
  retryCount: row.retryCount,
  ...(row.errorCode ? { errorCode: row.errorCode } : {}),
  ...(row.responseSnapshot ? { result: row.responseSnapshot } : {}),
});

const createPendingAction = async (db, eventId, userId, action, fingerprint) => withTransaction(db, async (tx) => {
  const row = await tx.syncAction.create({
    data: {
      userId,
      eventId,
      stationId: action.stationId,
      clientActionId: action.clientActionId,
      requestFingerprint: fingerprint,
      operation: "UPDATE",
      entityType: "ScreeningResult",
      entityId: action.payload.registrationId,
      // Clinical content is deliberately excluded from the durable sync ledger.
      payload: { schemaVersion: 1, stationType: action.stationType },
      status: "PENDING",
      retryCount: 0,
      version: 0,
    },
  });
  await tx.syncActionTransition.create({
    data: { syncActionId: row.id, sequence: 0, status: "PENDING", retryCount: 0 },
  });
  return row;
});

const waitForCommittedTerminal = async (db, userId, clientActionId, timeoutMs = 10_000) => {
  const deadline = Date.now() + timeoutMs;
  let current = null;
  do {
    current = await db.syncAction.findFirst({ where: { userId, clientActionId } });
    if (current && TERMINAL_STATUSES.has(current.status)) return current;
    await wait(10);
  } while (Date.now() < deadline);

  return {
    clientActionId,
    status: "FAILED",
    retryCount: current?.retryCount || 0,
    errorCode: "SYNC_ACTION_IN_PROGRESS",
  };
};

const claimAction = async (db, row) => withTransaction(db, async (tx) => {
  const retryCount = ["FAILED", "PROCESSING"].includes(row.status) ? row.retryCount + 1 : row.retryCount;
  const nextVersion = row.version + 1;
  const claimed = await tx.syncAction.updateMany({
    where: {
      id: row.id,
      status: row.status,
      retryCount: row.retryCount,
      version: row.version,
      requestFingerprint: row.requestFingerprint,
    },
    data: {
      status: "PROCESSING",
      retryCount,
      version: { increment: 1 },
      processingStartedAt: new Date(),
      errorCode: null,
      responseSnapshot: null,
    },
  });
  if (claimed.count !== 1) return null;

  await tx.syncActionTransition.create({
    data: {
      syncActionId: row.id,
      sequence: nextVersion,
      status: "PROCESSING",
      retryCount,
    },
  });
  return tx.syncAction.findUnique({ where: { id: row.id } });
});

const processingIsStale = (row, leaseMs) => (
  !row.processingStartedAt || new Date(row.processingStartedAt).getTime() <= Date.now() - leaseMs
);

const beginAction = async (db, eventId, userId, action, fingerprint, options) => {
  let existing = await db.syncAction.findFirst({
    where: { userId, clientActionId: action.clientActionId },
  });

  if (!existing) {
    try {
      existing = await createPendingAction(db, eventId, userId, action, fingerprint);
    } catch (error) {
      if (error.code !== "P2002") throw error;
      existing = await db.syncAction.findFirst({
        where: { userId, clientActionId: action.clientActionId },
      });
      if (!existing) throw error;
    }
  }

  if (existing.requestFingerprint !== fingerprint) {
    return {
      row: {
        clientActionId: action.clientActionId,
        status: "CONFLICT",
        retryCount: existing.retryCount,
        errorCode: "SYNC_IDEMPOTENCY_REUSED",
      },
      shouldApply: false,
    };
  }

  if (TERMINAL_STATUSES.has(existing.status) && existing.status !== "FAILED") {
    return { row: existing, shouldApply: false };
  }

  if (existing.status === "PROCESSING" && !processingIsStale(existing, options.processingLeaseMs)) {
    return {
      row: await waitForCommittedTerminal(db, userId, action.clientActionId, options.waitTimeoutMs),
      shouldApply: false,
    };
  }

  const claimed = await claimAction(db, existing);
  if (claimed) return { row: claimed, shouldApply: true };
  return {
    row: await waitForCommittedTerminal(db, userId, action.clientActionId, options.waitTimeoutMs),
    shouldApply: false,
  };
};

const finishAction = async (db, row, status, { errorCode = null, responseSnapshot = null, waitTimeoutMs = TERMINAL_WAIT_MS } = {}) => withTransaction(
  db,
  async (tx) => {
    const finished = await tx.syncAction.updateMany({
      where: {
        id: row.id,
        status: "PROCESSING",
        retryCount: row.retryCount,
        version: row.version,
        requestFingerprint: row.requestFingerprint,
      },
      data: {
        status,
        errorCode,
        responseSnapshot,
        processingStartedAt: null,
        version: { increment: 1 },
      },
    });
    if (finished.count !== 1) return null;
    await tx.syncActionTransition.create({
      data: {
        syncActionId: row.id,
        sequence: row.version + 1,
        status,
        retryCount: row.retryCount,
        errorCode,
      },
    });
    return tx.syncAction.findUnique({ where: { id: row.id } });
  },
).then((updated) => updated || waitForCommittedTerminal(db, row.userId, row.clientActionId, waitTimeoutMs));

const safeConflictCode = (error) => (
  SAFE_CONFLICT_CODES.has(error?.code) ? error.code : "SYNC_CONFLICT"
);

const processAction = async ({ eventId, action, user, db, screening, options }) => {
  const fingerprint = requestFingerprint({ eventId, userId: user.userId, action });
  const pending = await beginAction(db, eventId, user.userId, action, fingerprint, options);
  if (!pending.shouldApply) return responseFor(pending.row);

  try {
    const receipt = await screening[HANDLERS[action.stationType]](
      eventId,
      action.stationId,
      action.payload,
      user,
    );
    const applied = await finishAction(db, pending.row, "APPLIED", {
      responseSnapshot: safeResultSnapshot(receipt),
      waitTimeoutMs: options.waitTimeoutMs,
    });
    return responseFor(applied);
  } catch (error) {
    if (error?.status >= 400 && error.status < 500) {
      const conflict = await finishAction(db, pending.row, "CONFLICT", {
        errorCode: safeConflictCode(error),
        waitTimeoutMs: options.waitTimeoutMs,
      });
      return responseFor(conflict);
    }

    const failed = await finishAction(db, pending.row, "FAILED", {
      errorCode: "SYNC_APPLY_FAILED",
      waitTimeoutMs: options.waitTimeoutMs,
    });
    return responseFor(failed);
  }
};

const sanitizeStation = (station) => ({
  stationId: station.stationId,
  eventId: station.eventId,
  stationName: station.stationName,
  stationType: station.stationType,
  stationOrder: station.stationOrder,
  isActive: station.isActive,
  fieldSchemaSnapshot: station.fieldSchemaSnapshot || null,
  schemaVersion: station.schemaVersion ?? null,
  offlineAccessExpiresAt: station.offlineAccessExpiresAt || null,
});

const sanitizeRegistration = (registration) => ({
  registrationId: registration.registrationId,
  participantDisplayName: registration.participantDisplayName,
  queueNumber: registration.queueNumber,
  status: registration.status,
  existingResult: registration.existingResult
    ? {
      resultId: registration.existingResult.resultId,
      overallFlag: registration.existingResult.overallFlag,
      isFlagged: registration.existingResult.isFlagged,
      createdAt: registration.existingResult.createdAt,
    }
    : null,
});

const buildPull = async (eventId, user, accessible, screening) => {
  const stations = [];
  for (const station of accessible.stations) {
    const queue = await screening.listQueue(eventId, station.stationId, user);
    stations.push({
      ...sanitizeStation(station),
      registrations: queue.registrations.map(sanitizeRegistration),
    });
  }
  return {
    event: {
      eventId: accessible.event.eventId,
      name: accessible.event.name,
      status: accessible.event.status,
    },
    stations,
  };
};

const processScreeningSync = async (
  eventId,
  body,
  user,
  context,
  dependencies = {},
) => {
  const db = dependencies.db || prisma;
  const screening = dependencies.screening || screeningService;
  const audit = dependencies.audit || createAuditLog;
  const options = {
    processingLeaseMs: dependencies.processingLeaseMs || PROCESSING_LEASE_MS,
    waitTimeoutMs: dependencies.waitTimeoutMs || TERMINAL_WAIT_MS,
  };

  // This is both the batch-level authorization gate and the source of the scoped pull.
  const accessible = await screening.listStations(eventId, user);
  const actions = [];
  for (const action of body.actions) {
    actions.push(await processAction({ eventId, action, user, db, screening, options }));
  }
  const pull = await buildPull(eventId, user, accessible, screening);
  const serverTime = new Date().toISOString();
  const counts = actions.reduce((acc, action) => {
    acc[action.status] = (acc[action.status] || 0) + 1;
    return acc;
  }, {});

  await audit({
    userId: user.userId,
    action: "SCREENING_SYNC_BATCH",
    entityName: "Event",
    entityId: eventId,
    newValue: {
      clientBatchId: body.clientBatchId,
      actionCount: actions.length,
      statusCounts: counts,
      stationCount: pull.stations.length,
    },
    context,
    client: db,
  });

  return {
    clientBatchId: body.clientBatchId,
    serverTime,
    cursor: serverTime,
    actions,
    pull,
  };
};

module.exports = {
  processScreeningSync,
  requestFingerprint,
};
