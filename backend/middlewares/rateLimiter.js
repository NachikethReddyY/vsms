/**
 * ============================================================================
 * SHARED, REDIS-BACKED RATE LIMITING
 * Visual Screening Management System (VSMS) Backend API
 *
 * Wraps express-rate-limit so every limiter in the application shares a single
 * Redis connection when Redis is enabled. When Redis is not configured,
 * unreachable, or in the middle of a reconnect, each limiter transparently
 * falls back to its own in-process memory store so traffic is never blocked
 * by an infrastructure outage (fail-open).
 *
 * Configuration:
 *   - REDIS_URL          optional connection URL, e.g. redis://localhost:6379
 *   - RATE_LIMIT_STORE   "auto" | "memory" | "redis" (default "auto")
 *                         - "auto"   uses Redis when REDIS_URL is set
 *                         - "memory" always uses the in-process fallback
 *                         - "redis"  requires REDIS_URL (falls back if it fails)
 * ============================================================================
 */

const { RedisStore } = require("rate-limit-redis");
const { rateLimit: buildRateLimiter } = require("express-rate-limit");

const env = require("../config/env");
const logger = require("../utils/logging/logger/logger");
const redisClient = require("../utils/infra/redisClient");

const MEMORY_CLEANUP_INTERVAL_MS = 5 * 60_000;

/**
 * Decides whether the Redis-backed path is active. The "auto" mode enables
 * Redis whenever REDIS_URL is configured; anything else stays in-memory.
 */
const resolveStoreMode = () => {
  if (env.rateLimitStore === "redis") return "redis";
  if (env.rateLimitStore === "auto" && env.redisUrl) return "redis";
  return "memory";
};

const storeMode = resolveStoreMode();
const redisEnabled = storeMode === "redis" && Boolean(env.redisUrl);

/**
 * Stores created while Redis is not yet connected. Once the client becomes
 * ready we load each store's Lua scripts; until then requests use the
 * in-memory fallback (RedisStore.init would otherwise try SCRIPT LOAD on a
 * closed socket).
 */
const redisInitQueue = [];

const runRedisInit = (entry) => {
  const { store, options } = entry;
  Promise.resolve(store.init(options)).catch((err) => {
    logger.warn("rate_limiter.redis.init_failed", { message: err.message });
  });
};

if (redisEnabled) {
  redisClient.onRedisReady(() => {
    while (redisInitQueue.length > 0) runRedisInit(redisInitQueue.shift());
  });
}

/** Registry of live stores so one timer can reap expired memory buckets. */
const activeStores = new Set();

/**
 * express-rate-limit store that prefers Redis but degrades to an in-memory
 * bucket when Redis is unavailable. Each limiter owns its own instance; the
 * unique `prefix` keeps keys namespaced per limiter in both backends.
 */
class SafeRateLimitStore {
  constructor({ prefix = "rl:" } = {}) {
    this.prefix = prefix;
    this.localKeys = true;
    this.windowMs = 60_000;
    this.memory = new Map();
    this.redisStore = redisEnabled
      ? new RedisStore({ sendCommand: (...args) => redisClient.getRedisClient().sendCommand(args), prefix })
      : null;
    activeStores.add(this);
  }

  init(options) {
    if (options?.windowMs) this.windowMs = options.windowMs;
    if (this.redisStore) {
      if (redisClient.isRedisReady()) runRedisInit({ store: this.redisStore, options });
      else redisInitQueue.push({ store: this.redisStore, options });
    }
  }

  async increment(key) {
    if (redisClient.isRedisReady() && this.redisStore) {
      try {
        return await this.redisStore.increment(key);
      } catch (err) {
        logger.warn("rate_limiter.redis.increment_fallback", { message: err.message });
      }
    }
    return this.incrementMemory(key);
  }

  async decrement(key) {
    if (redisClient.isRedisReady() && this.redisStore) {
      try {
        await this.redisStore.decrement(key);
        return;
      } catch (err) {
        logger.warn("rate_limiter.redis.decrement_fallback", { message: err.message });
      }
    }
    this.decrementMemory(key);
  }

  async resetKey(key) {
    if (redisClient.isRedisReady() && this.redisStore) {
      try {
        await this.redisStore.resetKey(key);
        return;
      } catch (err) {
        logger.warn("rate_limiter.redis.reset_fallback", { message: err.message });
      }
    }
    this.memory.delete(key);
  }

  incrementMemory(key) {
    const now = Date.now();
    let entry = this.memory.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { totalHits: 0, resetAt: now + this.windowMs };
      this.memory.set(key, entry);
    }
    entry.totalHits += 1;
    return { totalHits: entry.totalHits, resetTime: new Date(entry.resetAt) };
  }

  decrementMemory(key) {
    const entry = this.memory.get(key);
    if (!entry) return;
    entry.totalHits = Math.max(0, entry.totalHits - 1);
    if (entry.totalHits === 0) this.memory.delete(key);
  }
}

const memoryCleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const store of activeStores) {
    for (const [key, entry] of store.memory) {
      if (entry.resetAt <= now) store.memory.delete(key);
    }
  }
}, MEMORY_CLEANUP_INTERVAL_MS);
memoryCleanupTimer.unref();

/**
 * Factory compatible with express-rate-limit's `rateLimit()`. Accepts the same
 * options (including the legacy `max` alias) and transparently injects a
 * Redis-backed store with an in-memory fallback. The `name` option (if given)
 * is used only to namespace the store keys; it is not an express-rate-limit
 * configuration option.
 */
function rateLimit(options = {}) {
  const { max, name, ...rest } = options;
  return buildRateLimiter({
    ...rest,
    limit: options.limit ?? max,
    store: new SafeRateLimitStore({ prefix: `rl:${name || "limiter"}:` }),
    standardHeaders: options.standardHeaders ?? "draft-8",
    legacyHeaders: options.legacyHeaders ?? false,
  });
}

/** True when the shared Redis client is currently connected and usable. */
const isRedisAvailable = () => redisClient.isRedisReady();

/** Gracefully closes the shared Redis connection (used during shutdown). */
const closeRateLimiterClient = async () => {
  await redisClient.closeRedisClient();
};

module.exports = {
  rateLimit,
  SafeRateLimitStore,
  isRedisAvailable,
  closeRateLimiterClient,
};
