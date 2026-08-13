#!/usr/bin/env node

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { performance } = require("perf_hooks");

const ACKNOWLEDGEMENT = "SYNTHETIC_LOAD_TEST";
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
const PROXY_ENVIRONMENT_VARIABLES = ["ALL_PROXY", "HTTP_PROXY", "HTTPS_PROXY", "all_proxy", "http_proxy", "https_proxy"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BACKEND_ROOT = path.resolve(__dirname, "..");

function fail(message) {
  throw new Error(message);
}

function parseArguments(args) {
  let configFile;
  let checkOnly = false;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--check") checkOnly = true;
    else if (args[index] === "--config") configFile = args[++index];
    else fail(`Unknown argument: ${args[index]}`);
  }
  if (!configFile) fail("Usage: node scripts/performance-runner.js [--check] --config <file>");
  return { configFile, checkOnly };
}

function readJson(file, description) {
  let value;
  try {
    value = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    fail(`Cannot read ${description}: ${error.message}`);
  }
  if (!value || Array.isArray(value) || typeof value !== "object") fail(`${description} must be a JSON object`);
  return value;
}

function isWithinBackend(file) {
  const relative = path.relative(BACKEND_ROOT, file);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

function assertConfig(config) {
  if (typeof config.target !== "string" || !/^[a-z0-9][a-z0-9_-]*_test$/i.test(config.target)) {
    fail("config.target must name an isolated target ending in _test");
  }
  let baseUrl;
  try {
    baseUrl = new URL(config.baseUrl);
  } catch {
    fail("config.baseUrl must be an absolute URL");
  }
  if (!/^https?:$/.test(baseUrl.protocol) || baseUrl.username || baseUrl.password || baseUrl.pathname !== "/" || baseUrl.search || baseUrl.hash) {
    fail("config.baseUrl must be a credential-free HTTP(S) origin");
  }
  if (PROXY_ENVIRONMENT_VARIABLES.some((name) => process.env[name])) {
    fail("Forward proxy environment variables are not supported for load tests");
  }
  if (!LOCAL_HOSTS.has(baseUrl.hostname.toLowerCase()) && process.env.VSMS_LOAD_TEST_REMOTE_NONPRODUCTION !== "YES") {
    fail("Remote load tests require VSMS_LOAD_TEST_REMOTE_NONPRODUCTION=YES");
  }
  if (!Number.isInteger(config.participantCount) || config.participantCount < 1 || config.participantCount > 5000) {
    fail("config.participantCount must be an integer between 1 and 5000");
  }
  if (!Number.isInteger(config.concurrency) || config.concurrency < 1 || config.concurrency > 100) {
    fail("config.concurrency must be an integer between 1 and 100");
  }
  if (!Number.isInteger(config.readSampleSize) || config.readSampleSize < 1 || config.readSampleSize > config.participantCount) {
    fail("config.readSampleSize must be between 1 and participantCount");
  }
  if (!Number.isInteger(config.checkInSampleSize) || config.checkInSampleSize < 1 || config.checkInSampleSize > 20) {
    fail("config.checkInSampleSize must be between 1 and 20 so the QR security limiter remains enabled");
  }
  if (!Number.isInteger(config.pollDurationSeconds) || config.pollDurationSeconds < 10 || config.pollDurationSeconds > 300) {
    fail("config.pollDurationSeconds must be between 10 and 300");
  }
  for (const [name, value] of Object.entries({
    participantPollIntervalMs: config.participantPollIntervalMs,
    staffPollIntervalMs: config.staffPollIntervalMs,
  })) {
    if (!Number.isInteger(value) || value < 1000 || value > 60000) fail(`config.${name} must be between 1000 and 60000`);
  }
  if (!Number.isInteger(config.staffPollClientCount) || config.staffPollClientCount < 1 || config.staffPollClientCount > 100) {
    fail("config.staffPollClientCount must be between 1 and 100");
  }
  if (!config.thresholds || config.thresholds.readP95Ms <= 0 || config.thresholds.reportingReadP95Ms <= 0
      || config.thresholds.writeP95Ms <= 0
      || config.thresholds.screeningBatchP95Ms <= 0
      || config.thresholds.errorRatePercent < 0 || config.thresholds.errorRatePercent > 100) {
    fail("config.thresholds must contain positive read/reporting/write/screening-batch p95 limits and an error percentage");
  }
  if (!path.isAbsolute(config.fixtureFile) || isWithinBackend(config.fixtureFile)) {
    fail("config.fixtureFile must be an absolute path outside this repository");
  }
  if (typeof config.authorizationEnv !== "string" || !/^[A-Z][A-Z0-9_]*$/.test(config.authorizationEnv)) {
    fail("config.authorizationEnv must name an environment variable");
  }
  return baseUrl;
}

function assertFixture(fixture, config) {
  if (fixture.target !== config.target || !UUID.test(fixture.eventId) || !UUID.test(fixture.registrationEventId) || !UUID.test(fixture.stationId)) {
    fail("Fixture target, eventId, registrationEventId, or stationId is invalid");
  }
  if (!Array.isArray(fixture.participantIds) || fixture.participantIds.length < config.participantCount || fixture.participantIds.some((id) => !UUID.test(id))) {
    fail("Fixture does not contain enough valid synthetic participant IDs");
  }
  if (!Array.isArray(fixture.pollTokens) || fixture.pollTokens.length < config.participantCount
      || fixture.pollTokens.some((token) => !/^[a-f0-9]{64}$/.test(token))) {
    fail("Fixture does not contain enough valid synthetic secure-pass tokens");
  }
  if (!Array.isArray(fixture.pollRegistrationIds) || fixture.pollRegistrationIds.length < config.participantCount
      || fixture.pollRegistrationIds.some((id) => !UUID.test(id))) {
    fail("Fixture does not contain enough valid checked-in registration IDs");
  }
  return fixture;
}

function authorizationFor(config) {
  const authorization = process.env[config.authorizationEnv];
  if (!/^Bearer [A-Za-z0-9._~-]+$/.test(authorization || "")) {
    fail(`${config.authorizationEnv} must contain a Bearer access token`);
  }
  return authorization;
}

function percentile(values, ratio) {
  if (!values.length) return null;
  return values[Math.max(0, Math.ceil(values.length * ratio) - 1)];
}

function summarize(name, samples, elapsedMs) {
  const durations = samples.map(({ durationMs }) => durationMs).sort((left, right) => left - right);
  const errors = samples.filter(({ ok }) => !ok).length;
  return {
    scenario: name,
    requests: samples.length,
    throughputPerSecond: Number((samples.length / Math.max(elapsedMs / 1000, 0.001)).toFixed(2)),
    p50Ms: percentile(durations, 0.5),
    p95Ms: percentile(durations, 0.95),
    errorRatePercent: Number(((errors / Math.max(samples.length, 1)) * 100).toFixed(2)),
  };
}

async function runPool(items, concurrency, callback) {
  const results = new Array(items.length);
  let cursor = 0;
  const worker = async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await callback(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

async function request(baseUrl, authorization, name, method, pathname, body, acceptedStatuses, isSuccessful = () => true) {
  const startedAt = performance.now();
  try {
    const response = await fetch(new URL(pathname, baseUrl), {
      method,
      headers: {
        ...(authorization ? { Authorization: authorization } : {}),
        "Content-Type": "application/json",
        "X-Request-Id": crypto.randomUUID(),
        ...(body ? { "Idempotency-Key": `${name}-${crypto.randomUUID()}` } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    return {
      ok: acceptedStatuses.includes(response.status) && isSuccessful(data),
      status: response.status,
      durationMs: Number((performance.now() - startedAt).toFixed(2)),
      data,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      durationMs: Number((performance.now() - startedAt).toFixed(2)),
      data: null,
      error: error.message,
    };
  }
}

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function runPollingScenario(name, clients, intervalMs, durationMs, callback) {
  const startedAt = performance.now();
  const samples = (await Promise.all(clients.map(async (client, index) => {
    const clientSamples = [];
    await delay(Math.floor((index * intervalMs) / clients.length));
    while (performance.now() - startedAt < durationMs) {
      clientSamples.push(await callback(client));
      const remaining = durationMs - (performance.now() - startedAt);
      if (remaining <= 0) break;
      await delay(Math.min(intervalMs, remaining));
    }
    return clientSamples;
  }))).flat();
  return { samples, summary: summarize(name, samples, performance.now() - startedAt) };
}

async function runScenario(name, items, concurrency, callback) {
  const startedAt = performance.now();
  const samples = await runPool(items, concurrency, callback);
  return { samples, summary: summarize(name, samples, performance.now() - startedAt) };
}

async function run(config, baseUrl, fixture, authorization) {
  const participantIds = fixture.participantIds.slice(0, config.participantCount);
  const registration = await runScenario("registration.write", participantIds, config.concurrency, (participantId) => request(
    baseUrl,
    authorization,
    "performance-registration",
    "POST",
    "/api/v1/registrations",
    { eventId: fixture.registrationEventId, participantId },
    [200, 201],
    (data) => UUID.test(data?.registrationId),
  ));
  // Response IDs are retained only in memory to drive later route calls; output contains aggregate metrics only.
  const successfulRegistrations = registration.samples.flatMap(({ ok, data }) => ok && UUID.test(data?.registrationId) ? [data.registrationId] : []);

  const registrationRead = await runScenario("registration.read", successfulRegistrations.slice(0, config.readSampleSize), config.concurrency, (registrationId) => request(
    baseUrl, authorization, "performance-registration-read", "GET", `/api/v1/registrations/${registrationId}`, null, [200],
  ));
  const checkIn = await runScenario(
    "registration.check-in.write",
    successfulRegistrations.slice(0, config.checkInSampleSize),
    config.concurrency,
    (registrationId) => request(
      baseUrl,
      authorization,
      "performance-check-in",
      "POST",
      "/api/v1/qr/manual-checkin",
      { registrationId, eventId: fixture.registrationEventId },
      [200],
      (data) => data?.data?.registrationId === registrationId,
    ),
  );
  const queueRead = await runScenario("queue.read", Array.from({ length: config.readSampleSize }), config.concurrency, () => request(
    baseUrl, authorization, "performance-queue-read", "GET", `/api/v1/queues/events/${fixture.registrationEventId}`, null, [200],
  ));

  const screeningBatches = [];
  for (let index = 0; index < config.participantCount; index += 25) {
    const registrations = fixture.pollRegistrationIds.slice(index, index + 25);
    screeningBatches.push({
      clientBatchId: crypto.randomUUID(),
      actions: registrations.map((registrationId) => ({
        clientActionId: crypto.randomUUID(),
        stationId: fixture.stationId,
        stationType: "VISUAL_ACUITY",
        payload: {
          registrationId,
          idempotencyKey: crypto.randomUUID(),
          acknowledged: false,
          resultData: {
            chartDistanceMetres: "6",
            od: { kind: "FRACTION", denominator: 6 },
            os: { kind: "FRACTION", denominator: 6 },
            withUsualDistanceGlasses: "yes",
          },
        },
      })),
    });
  }
  const screening = await runScenario("screening.sync.write", screeningBatches, config.concurrency, (body) => request(
    baseUrl,
    authorization,
    "performance-screening-sync",
    "POST",
    `/api/v1/events/${fixture.eventId}/sync/screening`,
    body,
    [200],
    (data) => data?.actions?.every((action) => action.status === "APPLIED"),
  ));
  const reporting = await runScenario("reporting.read", Array.from({ length: config.readSampleSize }), config.concurrency, () => request(
    baseUrl, authorization, "performance-reporting", "GET", `/api/v1/events/reports/operations?eventId=${fixture.eventId}`, null, [200],
  ));

  const pollingDurationMs = config.pollDurationSeconds * 1000;
  const [participantPolling, staffPolling] = await Promise.all([
    runPollingScenario(
      "participant-status.poll",
      fixture.pollTokens.slice(0, config.participantCount),
      config.participantPollIntervalMs,
      pollingDurationMs,
      (token) => request(baseUrl, null, "participant-poll", "GET", `/api/v1/qr/public-status/${token}`, null, [200], (data) => data?.data?.valid === true),
    ),
    runPollingScenario(
      "staff-queue.poll",
      Array.from({ length: config.staffPollClientCount }),
      config.staffPollIntervalMs,
      pollingDurationMs,
      () => request(baseUrl, authorization, "staff-poll", "GET", `/api/v1/queues/events/${fixture.eventId}`, null, [200]),
    ),
  ]);

  return [registration.summary, registrationRead.summary, checkIn.summary, queueRead.summary, screening.summary, reporting.summary, participantPolling.summary, staffPolling.summary];
}

function thresholdFailures(results, thresholds) {
  return results.flatMap((result) => {
    const failures = [];
    const p95Limit = result.scenario === "screening.sync.write"
      ? thresholds.screeningBatchP95Ms
      : result.scenario === "reporting.read"
        ? thresholds.reportingReadP95Ms
        : result.scenario.includes("write") ? thresholds.writeP95Ms : thresholds.readP95Ms;
    if (result.p95Ms == null || result.p95Ms > p95Limit) failures.push(`${result.scenario} p95 ${result.p95Ms}ms > ${p95Limit}ms`);
    if (result.errorRatePercent > thresholds.errorRatePercent) failures.push(`${result.scenario} errors ${result.errorRatePercent}% > ${thresholds.errorRatePercent}%`);
    return failures;
  });
}

async function main() {
  const { configFile, checkOnly } = parseArguments(process.argv.slice(2));
  const config = readJson(configFile, "load-test config");
  const baseUrl = assertConfig(config);
  if (checkOnly) {
    process.stdout.write(`Load-test configuration is safe: ${config.target} at ${baseUrl.origin}\n`);
    return;
  }
  if (process.env.VSMS_LOAD_TEST_ACKNOWLEDGEMENT !== ACKNOWLEDGEMENT) {
    fail(`Set VSMS_LOAD_TEST_ACKNOWLEDGEMENT=${ACKNOWLEDGEMENT} before writing synthetic load data`);
  }
  const fixture = assertFixture(readJson(config.fixtureFile, "synthetic fixture"), config);
  const authorization = authorizationFor(config);
  const results = await run(config, baseUrl, fixture, authorization);
  const outputFile = process.env.PERF_RESULTS_FILE || path.join(os.tmpdir(), `vsms-performance-${Date.now()}.json`);
  if (!path.isAbsolute(outputFile) || isWithinBackend(outputFile)) {
    fail("PERF_RESULTS_FILE must be an absolute path outside this repository");
  }
  fs.writeFileSync(outputFile, `${JSON.stringify({
    measuredAt: new Date().toISOString(),
    target: config.target,
    participantCount: config.participantCount,
    results,
  }, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ target: config.target, participantCount: config.participantCount, results, outputFile }, null, 2)}\n`);
  const failures = thresholdFailures(results, config.thresholds);
  if (failures.length) {
    process.stderr.write(`Performance thresholds failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}\n`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  process.stderr.write(`Performance runner refused to run: ${error.message}\n`);
  process.exitCode = 1;
});
