const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const path = require("node:path");
const test = require("node:test");

const backend = path.resolve(__dirname, "../..");
const offlineLeasePrivateKey = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey.export({
  format: "pem",
  type: "pkcs8",
});

function loadConfig(overrides) {
  return spawnSync(process.execPath, ["-e", "require('./config/env')"], {
    cwd: backend,
    env: {
      ...process.env,
      DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/vsms_test",
      ...overrides,
    },
    encoding: "utf8",
  });
}

test("transport configuration rejects HTTP origins and Cognito URLs", () => {
  for (const overrides of [
    { CORS_ORIGINS: "http://localhost:5173" },
    { CORS_ORIGINS: "https://localhost:5173", COGNITO_REDIRECT_URI: "http://localhost:5173/auth/callback" },
  ]) {
    assert.notEqual(loadConfig(overrides).status, 0);
  }

  assert.equal(loadConfig({
    CORS_ORIGINS: "https://localhost:5173",
    COGNITO_REDIRECT_URI: "https://localhost:5173/auth/callback",
  }).status, 0);
});

test("production requires a valid versioned encryption keyring", () => {
  const production = {
    NODE_ENV: "production",
    JWT_ACCESS_SECRET: "x".repeat(48),
    CORS_ORIGINS: "https://app.example.com",
    PUBLIC_APP_ORIGIN: "https://app.example.com",
    ENCRYPTION_KEY: "",
    ENCRYPTION_ACTIVE_KEY_ID: "",
    ENCRYPTION_KEYRING_JSON: "",
    PARTICIPANT_LOOKUP_HMAC_KEY: "",
    OFFLINE_LEASE_PRIVATE_KEY_PEM: offlineLeasePrivateKey,
  };
  assert.notEqual(loadConfig(production).status, 0);
  assert.notEqual(loadConfig({
    ...production,
    ENCRYPTION_ACTIVE_KEY_ID: "current",
    ENCRYPTION_KEYRING_JSON: JSON.stringify({ previous: "1".repeat(64) }),
  }).status, 0);
  assert.notEqual(loadConfig({
    ...production,
    ENCRYPTION_ACTIVE_KEY_ID: "current",
    ENCRYPTION_KEYRING_JSON: "not-json",
  }).status, 0);
  assert.equal(loadConfig({
    ...production,
    ENCRYPTION_ACTIVE_KEY_ID: "current",
    ENCRYPTION_KEYRING_JSON: JSON.stringify({ previous: "1".repeat(64), current: "2".repeat(64) }),
    PARTICIPANT_LOOKUP_HMAC_KEY: "3".repeat(64),
    OFFLINE_LEASE_PRIVATE_KEY_PEM: offlineLeasePrivateKey,
  }).status, 0);
});

test("production QR origins require a non-local HTTPS public origin", () => {
  const production = {
    NODE_ENV: "production",
    JWT_ACCESS_SECRET: "x".repeat(48),
    CORS_ORIGINS: "https://app.example.com",
    ENCRYPTION_ACTIVE_KEY_ID: "current",
    ENCRYPTION_KEYRING_JSON: JSON.stringify({ current: "2".repeat(64) }),
    PARTICIPANT_LOOKUP_HMAC_KEY: "3".repeat(64),
    OFFLINE_LEASE_PRIVATE_KEY_PEM: offlineLeasePrivateKey,
  };

  assert.notEqual(loadConfig({ ...production, PUBLIC_APP_ORIGIN: "http://app.example.com" }).status, 0);
  assert.notEqual(loadConfig({ ...production, PUBLIC_APP_ORIGIN: "https://localhost:5173" }).status, 0);
  assert.equal(loadConfig({ ...production, PUBLIC_APP_ORIGIN: "https://app.example.com" }).status, 0);
});

test("production requires an ECDSA P-256 offline lease key", () => {
  const production = {
    NODE_ENV: "production",
    JWT_ACCESS_SECRET: "x".repeat(48),
    CORS_ORIGINS: "https://app.example.com",
    PUBLIC_APP_ORIGIN: "https://app.example.com",
    ENCRYPTION_ACTIVE_KEY_ID: "current",
    ENCRYPTION_KEYRING_JSON: JSON.stringify({ current: "2".repeat(64) }),
    PARTICIPANT_LOOKUP_HMAC_KEY: "3".repeat(64),
    OFFLINE_LEASE_PRIVATE_KEY_PEM: "",
  };
  assert.match(loadConfig(production).stderr, /OFFLINE_LEASE_PRIVATE_KEY_PEM is required in production/);
  const rsaKey = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ format: "pem", type: "pkcs8" });
  assert.match(loadConfig({ ...production, OFFLINE_LEASE_PRIVATE_KEY_PEM: rsaKey }).stderr, /must contain an ECDSA P-256 private key/);
  assert.equal(loadConfig({ ...production, OFFLINE_LEASE_PRIVATE_KEY_PEM: offlineLeasePrivateKey }).status, 0);
});
