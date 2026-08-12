const { test, mock } = require("node:test");
const { expect } = require("expect");
const express = require("express");
const request = require("supertest");

const redisClient = require("../../utils/infra/redisClient");

const checkIdempotency = require("../../middlewares/idempotency");

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.post("/mutation", checkIdempotency, (_req, res) => res.status(200).json({ ok: true }));
  return app;
};

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
  await redis.set("idempotency:k-inflight", JSON.stringify({ status: "PROCESSING" }));

  mock.method(redisClient, "isRedisReady", () => true);
  mock.method(redisClient, "getRedisClient", () => redis);

  const app = buildApp();
  const res = await request(app).post("/mutation").set("Idempotency-Key", "k-inflight");
  expect(res.status).toBe(409);
});

test("replays the cached response for a repeated Idempotency-Key", async () => {
  const redis = fakeRedis();
  await redis.set("idempotency:k-replay", JSON.stringify({ status: 200, body: { ok: true, replayed: true } }));

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
  expect(res.body).toEqual({ ok: true });

  const cached = JSON.parse(await redis.get("idempotency:k-fresh"));
  expect(cached.status).toBe(200);
  expect(cached.body).toEqual({ ok: true });
});
