const test = require("node:test");
const assert = require("node:assert/strict");

process.env.NODE_ENV = "test";
process.env.JWT_ACCESS_SECRET ||= "test-access-secret-that-is-at-least-32-characters";
process.env.JWT_REFRESH_SECRET ||= "test-refresh-secret-that-is-at-least-32-characters";
process.env.ENCRYPTION_KEY ||= "11".repeat(32);
process.env.REPORT_ARTIFACT_EXPIRY_HOURS = "24";

const { queueCompletedEventOverview } = require("../../services/reporting/reportExportService");

test("event completion queues a bounded overview PDF and audit evidence", async () => {
  const now = new Date("2026-08-13T04:00:00.000Z");
  const event = {
    eventId: "11111111-1111-4111-8111-111111111111",
    startsAt: new Date("2026-08-13T00:00:00.000Z"),
    endsAt: new Date("2026-08-13T08:00:00.000Z"),
  };
  const actorId = "22222222-2222-4222-8222-222222222222";
  const writes = [];
  const tx = {
    reportExportJob: {
      create: async ({ data }) => {
        writes.push({ model: "report", data });
        return { id: "33333333-3333-4333-8333-333333333333", ...data };
      },
    },
    device: { findFirst: async () => null },
    auditLog: {
      create: async ({ data }) => {
        writes.push({ model: "audit", data });
        return data;
      },
    },
  };

  const queued = await queueCompletedEventOverview(tx, event, actorId, { requestId: "completion-1" }, now);

  assert.equal(queued.dataset, "OVERVIEW");
  assert.equal(queued.format, "PDF");
  assert.deepEqual(queued.filterSnapshot, {
    from: event.startsAt.toISOString(),
    to: event.endsAt.toISOString(),
  });
  assert.equal(queued.expiresAt.toISOString(), "2026-08-14T04:00:00.000Z");
  assert.equal(writes[1].data.action, "REPORT_EXPORT_QUEUED");
  assert.deepEqual(writes[1].data.newValue, {
    eventId: event.eventId,
    dataset: "OVERVIEW",
    format: "PDF",
    trigger: "EVENT_COMPLETED",
  });
});
