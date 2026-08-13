"use strict";

const baseUrl = String(process.env.SMOKE_BASE_URL || "").replace(/\/$/, "");
const timeoutMs = Math.min(Math.max(Number(process.env.SMOKE_TIMEOUT_MS || 120000), 5000), 300000);
const intervalMs = Math.min(Math.max(Number(process.env.SMOKE_INTERVAL_MS || 3000), 250), 15000);
const authPath = String(process.env.SMOKE_AUTH_PATH || "").trim();
const bearerToken = String(process.env.SMOKE_BEARER_TOKEN || "").trim();

const fail = (message) => {
  process.stderr.write(`Deployment smoke check failed: ${message}\n`);
  process.exit(1);
};

let origin;
try {
  origin = new URL(baseUrl);
} catch {
  fail("SMOKE_BASE_URL must be an absolute URL");
}
if (origin.protocol !== "https:" && process.env.ALLOW_INSECURE_SMOKE !== "true") fail("SMOKE_BASE_URL must use HTTPS");
if (origin.username || origin.password || origin.search || origin.hash) fail("SMOKE_BASE_URL must not contain credentials, query parameters, or a fragment");
if (authPath && (!authPath.startsWith("/api/") || !bearerToken)) fail("SMOKE_AUTH_PATH requires an API path and SMOKE_BEARER_TOKEN");

const pause = (duration) => new Promise((resolve) => setTimeout(resolve, duration));
const requestJson = async (path, headers = {}) => {
  const response = await fetch(new URL(path, `${baseUrl}/`), {
    headers,
    redirect: "error",
    signal: AbortSignal.timeout(5000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  return body;
};

async function check() {
  const health = await requestJson("/health");
  if (health?.status !== "ok") throw new Error("/health did not report ok");
  const ready = await requestJson("/ready");
  if (ready?.status !== "ready" || ready?.database !== "connected") throw new Error("/ready did not report database readiness");
  if (authPath) await requestJson(authPath, { Authorization: `Bearer ${bearerToken}` });
}

(async () => {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  do {
    try {
      await check();
      process.stdout.write(`${JSON.stringify({ status: "passed", baseUrl: origin.origin, authenticated: Boolean(authPath) })}\n`);
      return;
    } catch (error) {
      lastError = error;
      await pause(intervalMs);
    }
  } while (Date.now() < deadline);
  fail(lastError?.message || "service did not become ready before the timeout");
})();
