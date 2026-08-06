const { test, before, after } = require("node:test");
const { expect } = require("expect");
const request = require("supertest");
const helpers = require("../helpers");
const app = require("../../app");

let staffUser;
let staffToken;
let managerUser;
let managerToken;
let publicEventId;

before(async () => {
  staffUser = await helpers.ensureTestUser("REGISTRATION_OFFICER", "rbac-staff");
  staffToken = helpers.accessTokenFor(staffUser);
  managerUser = await helpers.ensureTestUser("EVENT_MANAGER", "rbac-manager");
  managerToken = helpers.accessTokenFor(managerUser);
  const event = await helpers.prisma.event.create({
    data: {
      name: "RBAC Public Event",
      venue: "Test Hall",
      capacity: 10,
      startsAt: new Date(Date.now() + 86_400_000),
      endsAt: new Date(Date.now() + 90_000_000),
      status: "PUBLISHED",
      createdByUserId: managerUser.id,
    },
    select: { eventId: true },
  });
  publicEventId = event.eventId;
});

after(async () => helpers.prisma.$disconnect());

test("REGISTRATION_OFFICER token works on public endpoint", async () => {
  const res = await request(app)
    .get(`/api/v1/public/events/${publicEventId}`)
    .set("Authorization", `Bearer ${staffToken}`);

  expect(res.statusCode).toBe(200);
});

test("EVENT_MANAGER token works on protected endpoint", async () => {
  const res = await request(app)
    .get("/api/v1/auth/me")
    .set("Authorization", `Bearer ${managerToken}`);

  expect(res.statusCode).toBe(200);
  expect(res.body.user).toBeDefined();
  expect(res.body.user.roles).toContain("EVENT_MANAGER");
});

test("invalid token is rejected", async () => {
  const res = await request(app)
    .get("/api/v1/auth/me")
    .set("Authorization", "Bearer invalid.token.here");

  expect(res.statusCode).toBe(401);
  expect(res.body.code).toBe("INVALID_SESSION");
});