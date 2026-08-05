const { test, before, after } = require("node:test");
const { expect } = require("expect");
const request = require("supertest");
const helpers = require("../helpers");
const app = require("../../app");

let staffUser;
let staffToken;

before(async () => {
  staffUser = await helpers.ensureTestUser("REGISTRATION_OFFICER", "ratelimit-staff");
  staffToken = helpers.accessTokenFor(staffUser);
});

after(async () => helpers.prisma.$disconnect());

test("mutationLimiter applies rate limit headers to /api/v1/qr/verify", async () => {
  const res = await request(app)
    .post("/api/v1/qr/verify")
    .set("Authorization", `Bearer ${staffToken}`)
    .send({ token: "invalid-token-for-test" });

  // mutationLimiter sets standard ratelimit header
  expect(res.headers).toHaveProperty("ratelimit");
  expect(res.headers.ratelimit).toMatch(/r=59/);
});