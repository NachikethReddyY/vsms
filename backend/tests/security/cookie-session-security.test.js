const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");
const jwt = require("jsonwebtoken");

process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/vsms_test";
process.env.CORS_ORIGINS = "https://localhost:5173";
process.env.COGNITO_REGION = "ap-southeast-1";
process.env.COGNITO_USER_POOL_ID = "ap-southeast-1_test";
process.env.COGNITO_APP_CLIENT_ID = "test-client";

const csrf = require("../middlewares/csrf");
const requireAuthentication = require("../middlewares/requireAuthentication");
const requestContext = require("../middlewares/requestContext");
const prisma = require("../prisma/prismaClient");
const { parseCookies, setAuthCookies } = require("../utils/httpCookies");

const response = () => ({
  headers: {},
  getHeader(name) { return this.headers[name]; },
  setHeader(name, value) { this.headers[name] = value; },
});

test("auth cookies include a readable, rotating CSRF token", () => {
  const res = response();
  const token = setAuthCookies(res, {
    AccessToken: "access-secret",
    RefreshToken: "refresh-secret",
    ExpiresIn: 3600,
  }, "staff@example.com");
  const cookies = res.headers["Set-Cookie"];
  const csrfCookie = cookies.find((value) => value.startsWith("vsms_csrf="));

  assert.equal(cookies.length, 4);
  assert.ok(csrfCookie.includes(`vsms_csrf=${encodeURIComponent(token)}`));
  assert.doesNotMatch(csrfCookie, /HttpOnly/);
  assert.ok(cookies.filter((value) => !value.startsWith("vsms_csrf=")).every((value) => value.includes("HttpOnly")));
});

test("malformed cookie encoding is ignored instead of crashing authentication", () => {
  assert.deepEqual(parseCookies("valid=one; broken=%E0%A4%A; other=two%20words"), {
    valid: "one",
    other: "two words",
  });
});

test("malformed request and device IDs cannot reach UUID database columns", () => {
  const req = {
    ip: "203.0.113.7",
    get(name) {
      return {
        "x-request-id": "------------------------------------",
        "x-device-id": "ffffffffffffffffffffffffffffffffffff",
        "x-device-name": "Event laptop",
      }[name];
    },
  };
  const res = response();
  let continued = false;

  requestContext(req, res, () => { continued = true; });

  assert.match(req.requestId, /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i);
  assert.equal(req.context.deviceId, null);
  assert.equal(res.headers["x-request-id"], req.requestId);
  assert.equal(continued, true);
});

test("cookie-authenticated mutations require a matching same-origin CSRF token", () => {
  const token = "a".repeat(43);
  const request = (headerToken = token) => ({
    cookies: { vsms_access: "access", vsms_csrf: token },
    get(name) {
      return {
        origin: "https://localhost:5173",
        "sec-fetch-site": "same-origin",
        "x-csrf-token": headerToken,
      }[name];
    },
  });

  let accepted = false;
  csrf(request(), {}, (error) => { assert.equal(error, undefined); accepted = true; });
  assert.equal(accepted, true);
  csrf(request("wrong"), {}, (error) => assert.equal(error.code, "CSRF_VALIDATION_FAILED"));
});

test("HttpOnly Cognito access cookies authenticate approved local staff", async () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const key = publicKey.export({ format: "jwk" });
  key.kid = "test-key";
  key.use = "sig";
  key.alg = "RS256";
  const issuer = "https://cognito-idp.ap-southeast-1.amazonaws.com/ap-southeast-1_test";
  const token = jwt.sign({
    sub: "11111111-1111-4111-8111-111111111111",
    token_use: "access",
    client_id: "test-client",
    "cognito:groups": ["EventManager"],
  }, privateKey, { algorithm: "RS256", issuer, expiresIn: "5m", keyid: key.kid });
  const rotatedPair = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const rotatedKey = rotatedPair.publicKey.export({ format: "jwk" });
  rotatedKey.kid = "rotated-key";
  rotatedKey.use = "sig";
  rotatedKey.alg = "RS256";
  const rotatedToken = jwt.sign({
    sub: "11111111-1111-4111-8111-111111111111",
    token_use: "access",
    client_id: "test-client",
    "cognito:groups": ["EventManager"],
  }, rotatedPair.privateKey, { algorithm: "RS256", issuer, expiresIn: "5m", keyid: rotatedKey.kid });
  const originalFetch = global.fetch;
  const originalFindUnique = prisma.user.findUnique;
  let jwksRequests = 0;
  global.fetch = async () => ({ ok: true, json: async () => ({ keys: [jwksRequests++ ? rotatedKey : key] }) });
  prisma.user.findUnique = async () => ({
    id: "22222222-2222-4222-8222-222222222222",
    email: "manager@example.com",
    status: "ACTIVE",
    userRoles: [{ role: { roleName: "EVENT_MANAGER" } }],
  });
  const req = { cookies: { vsms_access: token }, get: () => "" };

  try {
    await new Promise((resolve, reject) => requireAuthentication(req, {}, (error) => error ? reject(error) : resolve()));
    assert.equal(req.auth.userId, "22222222-2222-4222-8222-222222222222");
    assert.deepEqual(req.auth.roles, ["EVENT_MANAGER"]);
    const rotatedRequest = { cookies: { vsms_access: rotatedToken }, get: () => "" };
    await new Promise((resolve, reject) => requireAuthentication(rotatedRequest, {}, (error) => error ? reject(error) : resolve()));
    assert.equal(jwksRequests, 2);
  } finally {
    global.fetch = originalFetch;
    prisma.user.findUnique = originalFindUnique;
  }
});
