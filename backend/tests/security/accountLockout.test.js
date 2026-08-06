const { test, before, after } = require("node:test");
const { expect } = require("expect");
const request = require("supertest");
const crypto = require("node:crypto");
const jwt = require("jsonwebtoken");
const helpers = require("../helpers");
const app = require("../../app");
const {
  ACCOUNT_LOCK_THRESHOLD,
  ACCOUNT_LOCK_DURATION_MS,
  isAccountLocked,
  remainingLockSeconds,
  assertAccountUnlocked,
  recordFailedLogin,
  clearLoginFailures,
} = require("../../utils/accountLockout");

let testUser;

before(async () => {
  testUser = await helpers.ensureTestUser("REGISTRATION_OFFICER", "lockout-test");
});

after(async () => helpers.prisma.$disconnect());

test("isAccountLocked is false for unlocked users", () => {
  expect(isAccountLocked({ lockedUntil: null })).toBe(false);
  expect(isAccountLocked({ lockedUntil: new Date(Date.now() - 1000) })).toBe(false);
  expect(isAccountLocked({})).toBe(false);
});

test("isAccountLocked is true only while lockedUntil is in the future", () => {
  expect(isAccountLocked({ lockedUntil: new Date(Date.now() + 60_000) })).toBe(true);
});

test("assertAccountUnlocked throws 423 ACCOUNT_LOCKED with retry window", () => {
  const locked = { lockedUntil: new Date(Date.now() + 300_000) };
  let caught;
  try {
    assertAccountUnlocked(locked);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeDefined();
  expect(caught.status).toBe(423);
  expect(caught.code).toBe("ACCOUNT_LOCKED");
  expect(remainingLockSeconds(locked)).toBeGreaterThan(0);
});

test("assertAccountUnlocked passes for an unlocked user", () => {
  let caught;
  try {
    assertAccountUnlocked({ lockedUntil: null });
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeUndefined();
});

test("recordFailedLogin increments and locks at the threshold", async () => {
  await clearLoginFailures(helpers.prisma, testUser.id);
  for (let attempt = 1; attempt < ACCOUNT_LOCK_THRESHOLD; attempt += 1) {
    await recordFailedLogin(helpers.prisma, testUser.id);
  }
  let fresh = await helpers.prisma.user.findUnique({ where: { id: testUser.id } });
  expect(fresh.failedLoginAttempts).toBe(ACCOUNT_LOCK_THRESHOLD - 1);
  expect(fresh.lockedUntil).toBeNull();

  await recordFailedLogin(helpers.prisma, testUser.id);
  fresh = await helpers.prisma.user.findUnique({ where: { id: testUser.id } });
  expect(fresh.failedLoginAttempts).toBe(ACCOUNT_LOCK_THRESHOLD);
  expect(isAccountLocked(fresh)).toBe(true);
});

test("clearLoginFailures resets attempts and lock", async () => {
  await clearLoginFailures(helpers.prisma, testUser.id);
  const fresh = await helpers.prisma.user.findUnique({ where: { id: testUser.id } });
  expect(fresh.failedLoginAttempts).toBe(0);
  expect(fresh.lockedUntil).toBeNull();
});

test("refresh refuses a locally locked staff account with 423", async () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: "jwk" }), kid: "lockout-e2e", use: "sig", alg: "RS256" };
  const signOptions = { algorithm: "RS256", issuer: helpers.issuer, keyid: jwk.kid, expiresIn: "5m" };
  const accessToken = jwt.sign(
    {
      token_use: "access",
      client_id: process.env.COGNITO_APP_CLIENT_ID,
      sub: testUser.cognitoSub,
      "cognito:groups": ["RegistrationOfficer"],
    },
    privateKey,
    signOptions,
  );
  const idToken = jwt.sign(
    { token_use: "id", aud: process.env.COGNITO_APP_CLIENT_ID, sub: testUser.cognitoSub, email: testUser.email },
    privateKey,
    signOptions,
  );

  const originalFetch = global.fetch;
  global.fetch = async (input) => {
    if (String(input).includes("/oauth2/token")) {
      return {
        ok: true,
        json: async () => ({
          access_token: accessToken,
          id_token: idToken,
          refresh_token: "refresh-token",
          token_type: "Bearer",
          expires_in: 3600,
        }),
      };
    }
    if (String(input).includes(".well-known/jwks.json")) {
      return { ok: true, json: async () => ({ keys: [jwk] }) };
    }
    throw new Error(`Unexpected test fetch: ${String(input)}`);
  };

  try {
    await helpers.prisma.user.update({
      where: { id: testUser.id },
      data: { lockedUntil: new Date(Date.now() + ACCOUNT_LOCK_DURATION_MS), failedLoginAttempts: ACCOUNT_LOCK_THRESHOLD },
    });
    const res = await request(app)
      .post("/api/v1/auth/refresh")
      .set("Origin", "https://localhost:5173")
      .set("Sec-Fetch-Site", "same-origin")
      .set("X-CSRF-Token", "csrf-value")
      .set("Cookie", "vsms_csrf=csrf-value; vsms_refresh=refresh-token; vsms_username=" + encodeURIComponent(testUser.email));

    expect(res.statusCode).toBe(423);
    expect(res.body.code).toBe("ACCOUNT_LOCKED");
    expect(res.body.errors.retryAfterSeconds).toBeGreaterThan(0);
  } finally {
    await helpers.prisma.user.update({
      where: { id: testUser.id },
      data: { lockedUntil: null, failedLoginAttempts: 0 },
    });
    global.fetch = originalFetch;
  }
});
