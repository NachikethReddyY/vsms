/**
 * ============================================================================
 * SHARED REDIS CLIENT
 * Visual Screening Management System (VSMS) Backend API
 *
 * Single node-redis connection shared by the rate limiter and the idempotency
 * middleware. Created lazily on first use and only when Redis is actually
 * configured (RATE_LIMIT_STORE is not "memory"). Fail-open: while the
 * connection is down or not yet established, callers degrade to their local
 * in-process behavior so traffic is never blocked by an infrastructure outage.
 *
 * Configuration:
 *   - REDIS_URL          connection URL, e.g. redis://localhost:6379
 *   - RATE_LIMIT_STORE   "auto" | "memory" | "redis" (default "auto")
 * ============================================================================
 */

const { createClient } = require("redis");
const env = require("../../config/env");
const logger = require("../logging/logger/logger");

/**
 * True when the application should open a Redis connection. "auto" enables
 * Redis whenever REDIS_URL is configured; "memory" disables it entirely.
 */
const redisEnabled =
  env.rateLimitStore !== "memory" && Boolean(env.redisUrl);

let redisClient = null;
let redisReady = false;

/** Callbacks invoked once the connection becomes ready. */
const readyWaiters = [];

const drainReadyWaiters = () => {
  while (readyWaiters.length > 0) readyWaiters.shift()();
};

/** Creates (once) and returns the shared node-redis client, or null. */
const getRedisClient = () => {
  if (!redisEnabled) return null;
  if (redisClient) return redisClient;

  redisClient = createClient({
    url: env.redisUrl,
    // Fail commands fast while the connection is down instead of buffering
    // them forever; callers catch the rejection and fall back locally.
    disableOfflineQueue: true,
    socket: {
      reconnectStrategy: (retries) => Math.min(retries * 200, 5000),
    },
  });

  redisClient.on("ready", () => {
    redisReady = true;
    logger.info("redis.client.ready");
    drainReadyWaiters();
  });

  redisClient.on("error", (err) => {
    if (redisReady) logger.warn("redis.client.error", { message: err.message });
    redisReady = false;
  });

  redisClient.on("end", () => {
    redisReady = false;
  });

  if (env.NODE_ENV !== "test") {
    redisClient.connect().catch((err) => {
      logger.warn("redis.client.connect_failed_fail_open", { message: err.message });
      redisReady = false;
    });
  }

  return redisClient;
};

/** True when the shared client is currently connected and usable. */
const isRedisReady = () => redisEnabled && redisReady && Boolean(redisClient);

/** Runs `callback` immediately if ready, otherwise once the client connects. */
const onRedisReady = (callback) => {
  if (isRedisReady()) {
    callback();
    return;
  }
  if (!redisEnabled) return;
  getRedisClient();
  readyWaiters.push(callback);
};

/** Gracefully closes the shared Redis connection (used during shutdown). */
const closeRedisClient = async () => {
  if (!redisClient) return;
  redisReady = false;
  await redisClient.quit().catch(() => redisClient.destroy());
};

module.exports = {
  getRedisClient,
  isRedisReady,
  onRedisReady,
  closeRedisClient,
  redisEnabled,
};
