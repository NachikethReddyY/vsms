process.env.NODE_ENV = "test";
process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/vsms_test";

const { Writable } = require("node:stream");
const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const pino = require("pino");
const request = require("supertest");
const AppError = require("../../errors/AppError");
const requestContext = require("../../middlewares/requestContext");
const { errorHandler } = require("../../middlewares/errorHandler");
const { createHttpLogger } = require("../../middlewares/httpLogger");

function logSink(records) {
  let pending = "";
  return new Writable({
    write(chunk, _encoding, callback) {
      pending += chunk.toString();
      for (const line of pending.split("\n").slice(0, -1)) records.push(JSON.parse(line));
      pending = pending.slice(pending.lastIndexOf("\n") + 1);
      callback();
    },
  });
}

function testApp(records) {
  const app = express();
  const testLogger = pino({ level: "info", base: null }, logSink(records));

  app.use(requestContext);
  app.use(createHttpLogger(testLogger));
  app.use(express.json());
  app.get("/api/v1/events/:eventId", (req, res) => res.json({ requestId: req.requestId }));
  app.post("/api/v1/clinical/:participantId", (_req, _res, next) => {
    next(new AppError(422, "VALIDATION_ERROR", "Request validation failed"));
  });
  app.use(errorHandler);
  return app;
}

test("success completion is correlated, normalized, and emitted once", async () => {
  const records = [];
  const requestId = "11111111-1111-4111-8111-111111111111";
  const response = await request(testApp(records))
    .get("/api/v1/events/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa?token=query-secret")
    .set("X-Request-Id", requestId)
    .set("Authorization", "Bearer authorization-secret")
    .set("Cookie", "access_token=cookie-secret");

  assert.equal(response.status, 200);
  assert.equal(response.body.requestId, requestId);
  assert.equal(response.headers["x-request-id"], requestId);

  const completions = records.filter(({ event }) => event === "http.request.completed");
  assert.equal(completions.length, 1);
  assert.deepEqual(
    Object.fromEntries(Object.entries(completions[0]).filter(([key]) => ["event", "requestId", "method", "route", "status"].includes(key))),
    { event: "http.request.completed", requestId, method: "GET", route: "/api/v1/events/:eventId", status: 200 },
  );
  assert.equal(typeof completions[0].durationMs, "number");
  assert.doesNotMatch(JSON.stringify(completions[0]), /query-secret|authorization-secret|cookie-secret/);
});

test("errors preserve the response contract and correlate application/error completion logs", async () => {
  const records = [];
  const requestId = "22222222-2222-4222-8222-222222222222";
  const response = await request(testApp(records))
    .post("/api/v1/clinical/participant-secret?access_token=query-secret")
    .set("X-Request-Id", requestId)
    .send({ dateOfBirth: "identity-secret", result: "clinical-secret" });

  assert.equal(response.status, 422);
  assert.equal(response.body.code, "VALIDATION_ERROR");
  assert.equal(response.body.requestId, requestId);

  const completion = records.filter(({ event }) => event === "http.request.completed");
  assert.equal(completion.length, 1);
  assert.equal(completion[0].requestId, requestId);
  assert.equal(completion[0].route, "/api/v1/clinical/:participantId");
  assert.equal(completion[0].status, 422);
  assert.equal(records.filter(({ event }) => event === "application.error").length, 1);
  assert.doesNotMatch(JSON.stringify(records), /query-secret|identity-secret|clinical-secret/);
});
