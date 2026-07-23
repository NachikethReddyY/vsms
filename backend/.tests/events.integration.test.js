const crypto = require("crypto");
const request = require("supertest");

let app;
let helpers;
let managerToken;
let staffToken;

const login = async (identifier) => {
  const response = await request(app).post("/auth/login").set("Origin", "https://localhost:5173").send({ identifier, password: helpers.PASSWORD });
  return response.body.accessToken;
};

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  process.env.LOCAL_HTTPS = "false";
  process.env.JWT_ACCESS_SECRET = "test-only-access-secret-with-at-least-thirty-two-characters";
  const url = new URL(process.env.DATABASE_URL);
  if (!url.pathname.endsWith("_test")) url.pathname = `${url.pathname}_test`;
  process.env.DATABASE_URL = url.toString();
  app = require("../app");
  helpers = require("./helpers");
  await helpers.ensureTestUser("EVENT_MANAGER");
  await helpers.ensureTestUser("STAFF");
  managerToken = await login("event-manager@tests.vsms.local");
  staffToken = await login("staff@tests.vsms.local");
});

afterAll(async () => helpers.prisma.$disconnect());

const newEvent = () => ({
  name: `Integration event ${crypto.randomUUID().slice(0, 8)}`,
  description: "Created by an isolated API integration test.",
  venue: "Integration Hall",
  timezone: "Asia/Singapore",
  startsAt: "2027-02-10T01:00:00.000+00:00",
  endsAt: "2027-02-10T07:00:00.000+00:00",
  capacity: 90,
  shifts: [{ name: "Main shift", startsAt: "2027-02-10T01:00:00.000+00:00", endsAt: "2027-02-10T05:00:00.000+00:00", requiredStaff: 4 }],
});

describe("event lifecycle", () => {
  test("manager creates, updates and publishes an atomically audited event", async () => {
    const created = await request(app).post("/api/events").set("Authorization", `Bearer ${managerToken}`).send(newEvent());
    expect(created.status).toBe(201);
    expect(created.body.status).toBe("DRAFT");
    expect(created.body.bannerKey).toBe("COMMUNITY_SCREENING");
    expect(created.body.shifts).toHaveLength(1);

    const updated = await request(app)
      .patch(`/api/events/${created.body.eventId}`)
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ version: created.body.version, capacity: 100, bannerKey: "LIBRARY_SCREENING" });
    expect(updated.status).toBe(200);
    expect(updated.body.version).toBe(created.body.version + 1);
    expect(updated.body.bannerKey).toBe("LIBRARY_SCREENING");

    const stale = await request(app)
      .patch(`/api/events/${created.body.eventId}`)
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ version: created.body.version, capacity: 110 });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe("STALE_EVENT_VERSION");

    const published = await request(app)
      .post(`/api/events/${created.body.eventId}/publish`)
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ version: updated.body.version });
    expect(published.status).toBe(200);
    expect(published.body.status).toBe("PUBLISHED");

    const audit = await request(app).get(`/api/events/${created.body.eventId}/audit-log`).set("Authorization", `Bearer ${managerToken}`);
    expect(audit.status).toBe(200);
    expect(audit.body.auditLogs.map((row) => row.action)).toEqual(expect.arrayContaining(["CREATED", "UPDATED", "PUBLISHED"]));
  });

  test("staff cannot create events", async () => {
    const response = await request(app).post("/api/events").set("Authorization", `Bearer ${staffToken}`).send(newEvent());
    expect(response.status).toBe(403);
  });

  test("manager can change artwork after an event is complete", async () => {
    const created = await request(app).post("/api/events").set("Authorization", `Bearer ${managerToken}`).send(newEvent());
    const published = await request(app).post(`/api/events/${created.body.eventId}/publish`).set("Authorization", `Bearer ${managerToken}`).send({ version: created.body.version });
    const started = await request(app).post(`/api/events/${created.body.eventId}/start`).set("Authorization", `Bearer ${managerToken}`).send({ version: published.body.version });
    const completed = await request(app).post(`/api/events/${created.body.eventId}/complete`).set("Authorization", `Bearer ${managerToken}`).send({ version: started.body.version });
    const updated = await request(app).patch(`/api/events/${created.body.eventId}`).set("Authorization", `Bearer ${managerToken}`).send({ version: completed.body.version, bannerKey: "EVENT_OPERATIONS" });

    expect(updated.status).toBe(200);
    expect(updated.body.status).toBe("COMPLETED");
    expect(updated.body.bannerKey).toBe("EVENT_OPERATIONS");
  });

  test("server and database reject invalid ranges", async () => {
    const payload = newEvent();
    payload.endsAt = payload.startsAt;
    const response = await request(app).post("/api/events").set("Authorization", `Bearer ${managerToken}`).send(payload);
    expect(response.status).toBe(422);
  });

  test("event audit rows reject direct mutation", async () => {
    const row = await helpers.prisma.eventAuditLog.findFirst();
    await expect(helpers.prisma.eventAuditLog.update({ where: { eventAuditLogId: row.eventAuditLogId }, data: { correlationId: crypto.randomUUID() } })).rejects.toThrow(/append-only/);
  });
});
