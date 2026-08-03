const assert = require("node:assert/strict");
const test = require("node:test");

process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/vsms_test";

const db = {
  event: { findFirst: async () => null },
  staffAssignment: { findFirst: async () => null },
  station: { findFirst: async () => ({ stationId: "station-b" }) },
};

require.cache[require.resolve("../prisma/prismaClient")] = { exports: db };
const screeningService = require("../services/screeningService");

test("screening access is scoped to the managed event", async () => {
  await assert.rejects(
    () => screeningService.listStations("event-b", { userId: "manager-a", systemRole: "EVENT_MANAGER" }),
    (error) => error.status === 403,
  );
});

test("screeners cannot read another station queue", async () => {
  let assignmentWhere;
  db.staffAssignment.findFirst = async ({ where }) => { assignmentWhere = where; return null; };

  await assert.rejects(
    () => screeningService.listQueue("event-a", "station-b", { userId: "screener-a", systemRole: "STAFF" }),
    (error) => error.status === 403,
  );
  assert.equal(assignmentWhere.eventId, "event-a");
  assert.equal(assignmentWhere.stationId, "station-b");
  assert.equal(assignmentWhere.assignmentRole, "SCREENER");
});
