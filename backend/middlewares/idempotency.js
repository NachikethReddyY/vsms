/**
 * Production-Grade Idempotency Middleware using Redis.
 *
 * Uses the shared node-redis client (backend/utils/infra/redisClient.js) so the
 * rate limiter and the idempotency middleware reuse a single connection. Fails
 * open: while Redis is not ready, requests pass through so traffic is never
 * blocked by an infrastructure outage.
 */
const crypto = require("crypto");
const logger = require("../utils/logging/logger/logger");
const redisClient = require("../utils/infra/redisClient");
const { validateIdempotencyKey } = require("../utils/validation/validation");

const TTL_SECONDS = 600; // Cache responses for 10 minutes (600 seconds)

const canonicalize = (value) => {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (value && typeof value === "object") {
        return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
    }
    return value;
};

const digest = (value) => crypto.createHash("sha256").update(value).digest("hex");
const actorId = (req) => req.auth?.userId || req.user?.userId || req.user?.id || "anonymous";
const requestPath = (req) => req.originalUrl || `${req.baseUrl || ""}${req.path || req.url || ""}`;
const buildRedisKey = (req, key) => `idempotency:${digest(`${actorId(req)}\n${req.method}\n${requestPath(req)}\n${key}`)}`;
const requestFingerprintFor = (req) => digest(JSON.stringify(canonicalize({
    body: req.body ?? null,
    method: req.method,
    path: requestPath(req),
})));

function requireIdempotencyKey(req, _res, next) {
    try {
        req.idempotencyKey = validateIdempotencyKey(
            req.headers["idempotency-key"] || req.headers["x-idempotency-key"],
        );
        next();
    } catch (error) {
        next(error);
    }
}

async function checkIdempotency(req, res, next) {
    const idempotencyKey = req.headers["idempotency-key"] || req.headers["x-idempotency-key"];

    // 1. Enforce or bypass if key is missing (change to 400 bad request if mandatory)
    if (!idempotencyKey) {
        return next();
    }

    // 2. Fail-open when Redis is unavailable so the endpoint keeps working
    if (!redisClient.isRedisReady()) {
        return next();
    }

    const redis = redisClient.getRedisClient();
    const redisKey = buildRedisKey(req, idempotencyKey);
    const requestFingerprint = requestFingerprintFor(req);

    try {
        // 3. Atomically check if the key already exists in Redis
        const cachedData = await redis.get(redisKey);

        if (cachedData) {
            const parsedRecord = JSON.parse(cachedData);

            // Handle race condition: request is currently being processed by another worker/thread
            if (parsedRecord.fingerprint && parsedRecord.fingerprint !== requestFingerprint) {
                return res.status(409).json({
                    success: false,
                    code: "IDEMPOTENCY_KEY_REUSED",
                    message: "This Idempotency-Key was already used for a different request.",
                });
            }

            if (parsedRecord.state === "PROCESSING" || parsedRecord.status === "PROCESSING") {
                return res.status(409).json({
                    success: false,
                    message: "A request with this Idempotency-Key is currently being processed.",
                });
            }

            // Return cached response safely
            return res.status(parsedRecord.responseStatus ?? parsedRecord.status).json(parsedRecord.body);
        }

        // 4. Set a lock ("PROCESSING") with a short TTL to prevent race conditions
        // NX option ensures it only sets if the key doesn't already exist
        const lockAcquired = await redis.set(redisKey, JSON.stringify({ state: "PROCESSING", fingerprint: requestFingerprint }), {
            EX: 30,
            NX: true,
        });

        if (!lockAcquired) {
            return res.status(409).json({
                success: false,
                message: "Concurrent request with the same Idempotency-Key detected.",
            });
        }

        // 5. Intercept res.json to capture the response before transmission
        const originalJson = res.json.bind(res);

        res.json = async function (body) {
            const responseStatus = res.statusCode;

            const responsePayload = {
                state: "COMPLETED",
                responseStatus,
                fingerprint: requestFingerprint,
                body: body,
            };

            // Save the finalized response into Redis with a 10-minute expiration window
            try {
                await redis.set(redisKey, JSON.stringify(responsePayload), { EX: TTL_SECONDS });
            } catch (cacheError) {
                // Response already sent; a cache failure must not fail the request
            }

            return originalJson(body);
        };

        next();
    } catch {
        // Fail-safe: If Redis goes down, log the error and let the request pass through
        // rather than completely breaking your user API endpoints.
        logger.warn("idempotency.redis_error", {
            event: "idempotency.redis_error",
            code: "IDEMPOTENCY_REDIS_UNAVAILABLE",
        });
        next();
    }
}

checkIdempotency.requireKey = requireIdempotencyKey;
checkIdempotency.buildRedisKey = buildRedisKey;
checkIdempotency.requestFingerprintFor = requestFingerprintFor;

module.exports = checkIdempotency;
