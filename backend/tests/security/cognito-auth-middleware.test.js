const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");
const cookieParser = require("cookie-parser");
const express = require("express");
const jwt = require("jsonwebtoken");
const request = require("supertest");

process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/vsms_test";
process.env.COGNITO_REGION = "ap-southeast-1";
process.env.COGNITO_USER_POOL_ID = "ap-southeast-1_test";
process.env.COGNITO_APP_CLIENT_ID = "test-client";

test("protected routes accept the Cognito access cookie", async (t) => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: "jwk" }), kid: "test-key", use: "sig", alg: "RS256" };
  const issuer = "https://cognito-idp.ap-southeast-1.amazonaws.com/ap-southeast-1_test";
  const token = jwt.sign(
    { token_use: "access", client_id: "test-client", "cognito:groups": ["EventManager"] },
    privateKey,
    { algorithm: "RS256", keyid: "test-key", issuer, subject: "cognito-user", expiresIn: "5m" },
  );

  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: true, json: async () => ({ keys: [jwk] }) });
  t.after(() => { global.fetch = originalFetch; });
  const prisma = require("../../prisma/prismaClient");
  const originalFindUnique = prisma.user.findUnique;
  prisma.user.findUnique = async ({ where }) => {
    assert.deepEqual(where, { cognitoSub: "cognito-user" });
    return {
      id: "local-user",
      email: "manager@example.com",
      status: "ACTIVE",
      userRoles: [{ role: { roleName: "EVENT_MANAGER" } }],
    };
  };
  t.after(() => { prisma.user.findUnique = originalFindUnique; });

  const app = express();
  app.use(cookieParser());
  app.get("/protected", require("../../middlewares/requireAuthentication"), (req, res) => {
    res.json({ userId: req.auth.userId, roles: req.auth.roles });
  });
  app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ error: error.message }));

  const response = await request(app).get("/protected").set("Cookie", `vsms_access=${token}`);
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { userId: "local-user", roles: ["EVENT_MANAGER"] });
});
