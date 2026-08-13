const { test, mock } = require("node:test");
const { expect } = require("expect");
const express = require("express");
const request = require("supertest");

const redisClient = require("../../utils/infra/redisClient");

const checkIdempotency = require("../../middlewares/idempotency");

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.post("/mutation", checkIdempotency, (req, res) => res.status(200).json({ ok: true, value: req.body?.value ?? null }));
  app.post("/other", checkIdempotency, (_req, res) => res.status(201).json({ route: "other" }));
  return app;
};

const requestShape = (path = "/mutation", body) => ({ method: "POST", originalUrl: path, body });

const fakeRedis = () => {
  const store = new Map();
  return {
    get: async (key) => store.get(key) ?? null,
    set: async (key, value, options = {}) => {
      if (options.NX && store.has(key)) return null;
      store.set(key, value);
      return "OK";
    },
  };
};

test("passes through when no Idempotency-Key is supplied", async () => {
  const app = buildApp();
  const res = await request(app).post("/mutation");
  expect(res.status).toBe(200);
});

test("passes through (fail-open) when Redis is not ready", async () => {
  mock.method(redisClient, "isRedisReady", () => false);
  const app = buildApp();
  const res = await request(app).post("/mutation").set("Idempotency-Key", "k-1");
  expect(res.status).toBe(200);
});

test("rejects a duplicate while the first request is still PROCESSING", async () => {
  const redis = fakeRedis();
  const shape = requestShape();
  const key = checkIdempotency.buildRedisKey(shape, "k-inflight");
  await redis.set(key, JSON.stringify({
    state: "PROCESSING",
    fingerprint: checkIdempotency.requestFingerprintFor(shape),
  }));

  mock.method(redisClient, "isRedisReady", () => true);
  mock.method(redisClient, "getRedisClient", () => redis);

  const app = buildApp();
  const res = await request(app).post("/mutation").set("Idempotency-Key", "k-inflight");
  expect(res.status).toBe(409);
});

test("replays the cached response for a repeated Idempotency-Key", async () => {
  const redis = fakeRedis();
  const shape = requestShape();
  const key = checkIdempotency.buildRedisKey(shape, "k-replay");
  await redis.set(key, JSON.stringify({
    state: "COMPLETED",
    responseStatus: 200,
    fingerprint: checkIdempotency.requestFingerprintFor(shape),
    body: { ok: true, replayed: true },
  }));

  mock.method(redisClient, "isRedisReady", () => true);
  mock.method(redisClient, "getRedisClient", () => redis);

  const app = buildApp();
  const res = await request(app).post("/mutation").set("Idempotency-Key", "k-replay");
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ ok: true, replayed: true });
});

test("claims a fresh key, executes the handler, and caches the response", async () => {
  const redis = fakeRedis();

  mock.method(redisClient, "isRedisReady", () => true);
  mock.method(redisClient, "getRedisClient", () => redis);

  const app = buildApp();
  const res = await request(app).post("/mutation").set("Idempotency-Key", "k-fresh");
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ ok: true, value: null });

  const key = checkIdempotency.buildRedisKey(requestShape(), "k-fresh");
  const cached = JSON.parse(await redis.get(key));
  expect(cached.state).toBe("COMPLETED");
  expect(cached.responseStatus).toBe(200);
  expect(cached.body).toEqual({ ok: true, value: null });
});

test("required mutation endpoints reject missing or unsafe idempotency keys", async () => {
  for (const headers of [{}, { "idempotency-key": "short" }, { "idempotency-key": "unsafe key value" }]) {
    const error = await new Promise((resolve) => {
      checkIdempotency.requireKey({ headers }, {}, resolve);
    });
    expect(error.statusCode).toBe(400);
  }

  const req = { headers: { "idempotency-key": "safe-key-123" } };
  const result = await new Promise((resolve) => {
    checkIdempotency.requireKey(req, {}, (error) => resolve(error || null));
  });
  expect(result).toBeNull();
  expect(req.idempotencyKey).toBe("safe-key-123");
});

test("rejects reuse of a key for a different request body", async () => {
  const redis = fakeRedis();
  mock.method(redisClient, "isRedisReady", () => true);
  mock.method(redisClient, "getRedisClient", () => redis);
  const app = buildApp();

  expect((await request(app).post("/mutation").set("Idempotency-Key", "same-body-key").send({ value: 1 })).status).toBe(200);
  const replay = await request(app).post("/mutation").set("Idempotency-Key", "same-body-key").send({ value: 2 });

  expect(replay.status).toBe(409);
  expect(replay.body.code).toBe("IDEMPOTENCY_KEY_REUSED");
});

test("scopes the same key to its HTTP route", async () => {
  const redis = fakeRedis();
  mock.method(redisClient, "isRedisReady", () => true);
  mock.method(redisClient, "getRedisClient", () => redis);
  const app = buildApp();

  const first = await request(app).post("/mutation").set("Idempotency-Key", "route-scope-key");
  const other = await request(app).post("/other").set("Idempotency-Key", "route-scope-key");

  expect(first.status).toBe(200);
  expect(other.status).toBe(201);
  expect(other.body).toEqual({ route: "other" });
});
