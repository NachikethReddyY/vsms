const { test } = require("node:test");
const { expect } = require("expect");
const request = require("supertest");
const express = require("express");

const { rateLimit, SafeRateLimitStore, isRedisAvailable } = require("../../middlewares/rateLimiter");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("SafeRateLimitStore counts hits in memory when Redis is unavailable", async () => {
  const store = new SafeRateLimitStore({ prefix: "test-store:" });
  store.init({ windowMs: 60_000 });

  const first = await store.increment("client-1");
  expect(first.totalHits).toBe(1);
  expect(first.resetTime).toBeInstanceOf(Date);
  expect(first.resetTime.getTime()).toBeGreaterThan(Date.now());

  const second = await store.increment("client-1");
  expect(second.totalHits).toBe(2);

  const other = await store.increment("client-2");
  expect(other.totalHits).toBe(1);
});

test("SafeRateLimitStore resets counters after the window elapses", async () => {
  const store = new SafeRateLimitStore({ prefix: "test-window:" });
  store.init({ windowMs: 20 });

  await store.increment("client-1");
  await store.increment("client-1");
  const third = await store.increment("client-1");
  expect(third.totalHits).toBe(3);

  await sleep(30);
  const afterReset = await store.increment("client-1");
  expect(afterReset.totalHits).toBe(1);
});

test("SafeRateLimitStore decrement and resetKey mutate the memory bucket", async () => {
  const store = new SafeRateLimitStore({ prefix: "test-mutate:" });
  store.init({ windowMs: 60_000 });

  await store.increment("client-1");
  await store.increment("client-1");
  await store.decrement("client-1");
  const afterDecrement = await store.increment("client-1");
  expect(afterDecrement.totalHits).toBe(2);

  await store.resetKey("client-1");
  const afterReset = await store.increment("client-1");
  expect(afterReset.totalHits).toBe(1);
});

test("rateLimit factory enforces the limit and sets draft-8 headers (max alias)", async () => {
  const app = express();
  app.use(rateLimit({ name: "unit-test", windowMs: 60_000, max: 3 }));
  app.get("/", (_req, res) => res.json({ ok: true }));

  for (let i = 0; i < 3; i += 1) {
    const ok = await request(app).get("/");
    expect(ok.statusCode).toBe(200);
  }

  const blocked = await request(app).get("/");
  expect(blocked.statusCode).toBe(429);
  expect(blocked.headers).toHaveProperty("ratelimit");
  expect(blocked.headers.ratelimit).toMatch(/r=0/);
});

test("isRedisAvailable reports false when Redis is not configured", () => {
  expect(typeof isRedisAvailable()).toBe("boolean");
  expect(isRedisAvailable()).toBe(false);
});
