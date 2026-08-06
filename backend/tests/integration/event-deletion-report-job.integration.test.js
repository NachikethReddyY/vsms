const { after, before, test } = require("node:test");
const { expect } = require("expect");
const crypto = require("node:crypto");
const request = require("supertest");
const helpers = require("../helpers");
const app = require("../../app");

const prisma = helpers.prisma;
let administrator;
let token;

before(async () => {
  administrator = await helpers.ensureTestUser("ADMINISTRATOR", "report-job-deletion-administrator");
  token = helpers.accessTokenFor(administrator);
});

after(async () => prisma.$disconnect());

test("queued and generating report exports block permanent event deletion", async () => {
  const event = await prisma.event.create({
    data: {
      name: `Report blocker ${crypto.randomUUID()}`,
      venue: "Reporting Hall",
      startsAt: new Date("2163-01-01T00:00:00.000Z"),
      endsAt: new Date("2163-01-01T06:00:00.000Z"),
      capacity: 10,
      status: "CANCELLED",
      cancelledByUserId: administrator.id,
      cancelledAt: new Date(),
      cancellationReason: "Report blocker integration fixture",
      createdByUserId: administrator.id,
    },
  });
  const jobs = await Promise.all(["QUEUED", "GENERATING"].map((status) => prisma.reportExportJob.create({
    data: { eventId: event.eventId, status },
  })));
  const blockedPreview = await request(app)
    .get(`/api/events/${event.eventId}/deletion-preview`)
    .set("Authorization", `Bearer ${token}`);

  expect(blockedPreview.status).toBe(200);
  expect(blockedPreview.body.counts.reports).toBe(2);
  expect(blockedPreview.body.blockers).toContainEqual(expect.objectContaining({ code: "ACTIVE_REPORT_JOBS", count: 2 }));
  const blockedDelete = await request(app)
    .delete(`/api/events/${event.eventId}`)
    .set("Authorization", `Bearer ${token}`)
    .send({
      version: event.version,
      confirmationName: event.name,
      acknowledgePermanentDeletion: true,
      previewToken: blockedPreview.body.previewToken,
    });
  expect(blockedDelete.status).toBe(409);
  expect(blockedDelete.body.code).toBe("EVENT_DELETE_BLOCKED");

  await prisma.reportExportJob.update({ where: { id: jobs[0].id }, data: { status: "COMPLETED" } });
  await prisma.reportExportJob.update({ where: { id: jobs[1].id }, data: { status: "FAILED" } });
  const unblockedPreview = await request(app)
    .get(`/api/events/${event.eventId}/deletion-preview`)
    .set("Authorization", `Bearer ${token}`);
  expect(unblockedPreview.body.counts.reports).toBe(2);
  expect(unblockedPreview.body.blockers).toEqual([]);
});
