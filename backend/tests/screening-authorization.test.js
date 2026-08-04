const assert = require("node:assert/strict");
const test = require("node:test");
const crypto = require("node:crypto");

process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/vsms_test";

const prisma = require("../prisma/prismaClient");
const screeningService = require("../services/screeningService");
const { stationTypeForTemplateKey } = require("../services/stationTemplateMapping");

const eventId = crypto.randomUUID();
const stationA = crypto.randomUUID();
const stationB = crypto.randomUUID();
const user = { userId: crypto.randomUUID(), systemRole: "STAFF" };

function replace(t, target, key, value) {
  const original = target[key];
  target[key] = value;
  t.after(() => { target[key] = original; });
}

test("screening is denied outside an in-progress event", async (t) => {
  let assignmentChecked = false;
  replace(t, prisma.event, "findUnique", async () => ({ eventId, name: "Draft", status: "DRAFT", venue: "Hall" }));
  replace(t, prisma.staffAssignment, "findFirst", async () => { assignmentChecked = true; return { id: "unexpected" }; });

  await assert.rejects(
    screeningService.listStations(eventId, user),
    (error) => error.status === 409 && error.code === "EVENT_NOT_IN_PROGRESS",
  );
  assert.equal(assignmentChecked, false);
});

test("only a screener assigned to the requested station can read its queue", async (t) => {
  let assignmentWhere;
  replace(t, prisma.event, "findUnique", async () => ({ eventId, name: "Live", status: "IN_PROGRESS", venue: "Hall" }));
  replace(t, prisma.staffAssignment, "findFirst", async ({ where }) => {
    assignmentWhere = where;
    return where.stationId === stationA ? { id: crypto.randomUUID() } : null;
  });
  replace(t, prisma.station, "findFirst", async ({ where }) => ({ ...where, stationName: "Station A" }));
  replace(t, prisma.eventRegistration, "findMany", async () => []);

  await assert.rejects(
    screeningService.listQueue(eventId, stationB, user),
    (error) => error.status === 403 && error.code === "FORBIDDEN",
  );
  assert.equal(assignmentWhere.assignmentRole, "SCREENER");
  assert.equal(assignmentWhere.stationId, stationB);
  assert.equal(assignmentWhere.shift.status, "ACTIVE");

  const queue = await screeningService.listQueue(eventId, stationA, user);
  assert.deepEqual(queue.registrations, []);
  assert.equal(stationTypeForTemplateKey("EYE_HEALTH"), null);
});
