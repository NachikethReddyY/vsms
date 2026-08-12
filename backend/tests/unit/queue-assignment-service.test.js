const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");

process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/vsms_test";

const {
  completeStationAndAssignNext,
  ensureActiveQueue,
  selectNextStation,
} = require("../../services/screening/queueAssignmentService");

const eventId = crypto.randomUUID();
const registrationId = crypto.randomUUID();
const stationA = crypto.randomUUID();
const stationB = crypto.randomUUID();

const stations = [
  {
    stationId: stationA,
    stationName: "Visual Acuity",
    stationType: "VISUAL_ACUITY",
    stationOrder: 1,
    operationalStatus: "AVAILABLE",
    staffAssignments: [{ id: crypto.randomUUID() }],
  },
  {
    stationId: stationB,
    stationName: "Refraction",
    stationType: "REFRACTION",
    stationOrder: 2,
    operationalStatus: "AVAILABLE",
    staffAssignments: [{ id: crypto.randomUUID() }],
  },
];

const selectionDb = ({ completed = [], active = [] } = {}) => ({
  event: {
    findUnique: async () => ({ eventId, screeningRoute: ["VISUAL_ACUITY", "REFRACTION"] }),
  },
  station: {
    findMany: async (query) => query.include ? structuredClone(stations) : structuredClone(stations),
  },
  screeningResult: {
    findMany: async () => completed.map((stationId) => ({ stationId })),
  },
  queueEntry: {
    findMany: async (query) => query.where.status === "SKIPPED" ? [] : structuredClone(active),
  },
});

test("assignment chooses the least-loaded eligible staffed station", async () => {
  const db = selectionDb({
    active: [
      { stationId: stationA, status: "WAITING" },
      { stationId: stationA, status: "IN_PROGRESS" },
    ],
  });

  const selection = await selectNextStation(db, { eventId, registrationId });
  assert.equal(selection.selected.stationId, stationB);
  assert.equal(selection.selected.waitingCount, 0);
  assert.equal(selection.selected.activeStaffCount, 1);
});

test("assignment excludes completed stations", async () => {
  const db = selectionDb({ completed: [stationB] });
  const selection = await selectNextStation(db, { eventId, registrationId });
  assert.equal(selection.selected.stationId, stationA);
  assert.equal(selection.remainingStationCount, 1);
});

test("an existing active queue is returned without creating a duplicate", async () => {
  let creates = 0;
  const existing = {
    id: crypto.randomUUID(),
    registrationId,
    stationId: stationA,
    queueNumber: 8,
    status: "WAITING",
    enteredAt: new Date(),
    station: stations[0],
  };
  const db = {
    ...selectionDb(),
    queueEntry: {
      findFirst: async () => existing,
      findMany: async (query) => query.where.status === "SKIPPED" ? [] : [],
      create: async () => { creates += 1; },
    },
  };

  const journey = await ensureActiveQueue(db, {
    registration: { registrationId, eventId, queueNumber: 8, registrationStatus: "CHECKED_IN" },
    userId: crypto.randomUUID(),
  });

  assert.equal(journey.created, false);
  assert.equal(journey.activeEntry.id, existing.id);
  assert.equal(creates, 0);
});

// -------------------------------------------------------------
// Computer-driven routing: add the queue-assignment engine here
// so the remaining scenarios cover the full journey contract.
// -------------------------------------------------------------

const route = ["VISUAL_ACUITY", "REFRACTION"];

const routingDb = ({ completed = [], activeEntry = null, audits = [], routeOverride = undefined }) => {
  const history = [];
  const movements = [];
  const created = [];
  return {
    db: {
      event: {
        findUnique: async () => ({ eventId, screeningRoute: routeOverride ?? route }),
      },
      station: {
        findMany: async () => structuredClone(stations),
      },
      screeningResult: {
        findMany: async () => completed.map((stationId) => ({ stationId })),
        update: async () => ({}),
      },
      queueEntry: {
        findFirst: async () => activeEntry,
        findMany: async (query) => (query.where.status === "SKIPPED" ? [] : []),
        update: async ({ data }) => data,
        create: async ({ data }) => {
          const entry = { id: crypto.randomUUID(), ...data, station: stations.find((s) => s.stationId === data.stationId) };
          created.push(entry);
          return entry;
        },
      },
      queueMovement: {
        create: async ({ data }) => {
          movements.push(data);
          return { id: crypto.randomUUID(), ...data };
        },
      },
      eventRegistration: {
        aggregate: async () => ({ _max: { queueNumber: 9 } }),
        update: async ({ data }) => data,
      },
      registrationStatusHistory: {
        create: async ({ data }) => {
          history.push(data);
          return { id: crypto.randomUUID(), ...data };
        },
      },
      auditLog: {
        create: async ({ data }) => {
          audits.push(data);
          return { id: crypto.randomUUID(), ...data };
        },
      },
    },
    history,
    movements,
    created,
    audits,
  };
};

const registrationFor = (state = {}) => ({
  registrationId,
  eventId,
  queueNumber: 7,
  registrationStatus: "CHECKED_IN",
  ...state,
});

test("completing a mid-journey station assigns the next required station and does not complete the registration", async () => {
  const audits = [];
  const { db, history, movements, created } = routingDb({
    completed: [stationA],
    activeEntry: {
      id: crypto.randomUUID(),
      registrationId,
      stationId: stationA,
      queueNumber: 7,
      status: "IN_PROGRESS",
      enteredAt: new Date(),
      station: stations[0],
      isPriority: false,
      priorityNotes: null,
    },
    audits,
  });
  const registration = registrationFor();

  const journey = await completeStationAndAssignNext(db, {
    registration,
    stationId: stationA,
    resultId: crypto.randomUUID(),
    userId: crypto.randomUUID(),
  });

  assert.equal(journey.state, "QUEUED");
  assert.equal(journey.activeEntry.stationId, stationB);
  assert.equal(journey.created, true);
  assert.equal(journey.remainingStationCount, 1);
  assert.equal(created.length, 1);
  assert.equal(created[0].stationId, stationB);
  assert.equal(movements.length, 1);
  assert.equal(movements[0].movementReason, "AUTO_ROUTED");
  assert.equal(history.length, 0);
  assert.ok(audits.some((audit) => audit.action === "QUEUE_AUTO_ADVANCED"));
  assert.equal(registration.registrationStatus, "CHECKED_IN");
});

test("completing the final required station marks the registration COMPLETED and emits QUEUE_JOURNEY_COMPLETED", async () => {
  const audits = [];
  const { db, history, movements, created } = routingDb({
    completed: [stationA, stationB],
    activeEntry: {
      id: crypto.randomUUID(),
      registrationId,
      stationId: stationA,
      queueNumber: 7,
      status: "IN_PROGRESS",
      enteredAt: new Date(),
      station: stations[0],
      isPriority: false,
      priorityNotes: null,
    },
    audits,
  });
  const registration = registrationFor();

  const journey = await completeStationAndAssignNext(db, {
    registration,
    stationId: stationA,
    resultId: crypto.randomUUID(),
    userId: crypto.randomUUID(),
  });

  assert.equal(journey.state, "COMPLETED");
  assert.equal(journey.remainingStationCount, 0);
  assert.equal(journey.activeEntry, null);
  assert.equal(registration.registrationStatus, "COMPLETED");
  assert.equal(history.length, 1);
  assert.equal(history[0].toStatus, "COMPLETED");
  assert.equal(movements.length, 0);
  assert.equal(created.length, 0);
  assert.ok(audits.some((audit) => audit.action === "QUEUE_JOURNEY_COMPLETED"));
});

test("a skipped (waived) station is never re-selected by the routing engine", async () => {
  const audits = [];
  const db = {
    ...routingDb({ audits }).db,
    queueEntry: {
      findMany: async (query) => (
        query.where.status === "SKIPPED"
          ? [{ station: { stationType: "VISUAL_ACUITY" } }]
          : []
      ),
    },
  };

  const selection = await selectNextStation(db, { eventId, registrationId });

  assert.equal(selection.selected.stationId, stationB);
  assert.equal(selection.remainingStationCount, 1);
});

test("the required set is limited to Event.screeningRoute", async () => {
  const db = routingDb({ routeOverride: ["REFRACTION"] }).db;

  const selection = await selectNextStation(db, { eventId, registrationId });

  assert.equal(selection.selected.stationId, stationB);
  assert.equal(selection.remainingStationCount, 1);
});

test("ensureActiveQueue enqueues the participant at the selected station and records QUEUE_AUTO_ASSIGNED", async () => {
  const audits = [];
  const { db, created } = routingDb({ audits });

  const journey = await ensureActiveQueue(db, {
    registration: registrationFor(),
    userId: crypto.randomUUID(),
  });

  assert.equal(journey.state, "QUEUED");
  assert.equal(journey.created, true);
  assert.equal(journey.activeEntry.stationId, stationA);
  assert.equal(journey.activeEntry.status, "WAITING");
  assert.equal(created.length, 1);
  assert.equal(created[0].stationId, stationA);
  assert.ok(audits.some((audit) => audit.action === "QUEUE_AUTO_ASSIGNED"));
});
