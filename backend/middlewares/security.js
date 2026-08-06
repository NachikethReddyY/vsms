/**
 * Backwards-compatible rate-limit helper used by route files that historically
 * passed `max` / `key`. It delegates to the shared Redis-backed limiter so all
 * application rate limits share one store (with an in-memory fallback).
 */

const { rateLimit } = require("./rateLimiter");

function securityRateLimit({ windowMs = 60_000, max = 60, key, ...rest } = {}) {
  return rateLimit({
    windowMs,
    limit: max,
    keyGenerator: key ? (req) => String(key(req) ?? "unknown") : undefined,
    ...rest,
  });
}

module.exports = {
  rateLimit: securityRateLimit,
};
