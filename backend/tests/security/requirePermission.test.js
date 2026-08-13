const { test, before, after } = require("node:test");
const { expect } = require("expect");
const request = require("supertest");
const express = require("express");
const helpers = require("../helpers");
const app = require("../../app");
const requirePermission = require("../../middlewares/requirePermission");

let adminUser;
let adminToken;
let officerUser;
let officerToken;

before(async () => {
  adminUser = await helpers.ensureTestUser("ADMINISTRATOR", "perm-admin");
  adminToken = helpers.accessTokenFor(adminUser);
  officerUser = await helpers.ensureTestUser("REGISTRATION_OFFICER", "perm-officer");
  officerToken = helpers.accessTokenFor(officerUser);
});

after(async () => helpers.prisma.$disconnect());

function buildMiniApp(auth) {
  const mini = express();
  mini.use((req, _res, next) => {
    req.auth = {
      user: { status: "ACTIVE", approvalState: "APPROVED", accessState: "ENABLED" },
      ...auth,
    };
    next();
  });
  mini.get("/sensitive", requirePermission("registrations:read"), (_req, res) => res.status(200).json({ ok: true }));
  return mini;
}

test("requirePermission allows a caller holding any required permission", async () => {
  const res = await request(buildMiniApp({ userId: "u1", roles: ["REGISTRATION_OFFICER"], permissions: ["participants:read", "registrations:read"] }))
    .get("/sensitive");

  expect(res.statusCode).toBe(200);
  expect(res.body.ok).toBe(true);
});

test("requirePermission denies a caller without any required permission", async () => {
  const res = await request(buildMiniApp({ userId: "u2", roles: ["SCREENER"], permissions: [] }))
    .get("/sensitive");

  expect(res.statusCode).toBe(403);
  expect(res.body.error).toContain("permission");
});

test("requirePermission denies a caller whose roles pass but permissions do not", async () => {
  const res = await request(buildMiniApp({ userId: "u3", roles: ["ADMINISTRATOR"], permissions: ["audit:read"] }))
    .get("/sensitive");

  expect(res.statusCode).toBe(403);
});

test("administrator can read audit logs (real route, seeded audit:read permission)", async () => {
  const res = await request(app)
    .get("/api/v1/admin/audit-logs?limit=5")
    .set("Authorization", `Bearer ${adminToken}`);

  expect(res.statusCode).toBe(200);
  expect(res.body.items).toBeDefined();
});

test("registration officer is denied audit logs (role guard + missing audit:read)", async () => {
  const res = await request(app)
    .get("/api/v1/admin/audit-logs")
    .set("Authorization", `Bearer ${officerToken}`);

  expect(res.statusCode).toBe(403);
});

test("requireAuthentication attaches effective permissions to req.auth", async () => {
  const res = await request(app)
    .get("/api/v1/auth/me")
    .set("Authorization", `Bearer ${officerToken}`);

  expect(res.statusCode).toBe(200);
  expect(res.body.user.roles).toContain("REGISTRATION_OFFICER");
});
