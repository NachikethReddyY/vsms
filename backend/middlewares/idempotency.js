/**
 * Production-Grade Idempotency Middleware using Redis
 * Requires: ioredis (npm install ioredis)
 */
const Redis = require("ioredis");
const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");

const TTL_SECONDS = 600; // Cache responses for 10 minutes (600 seconds)

module.exports = async function checkIdempotency(req, res, next) {
    const idempotencyKey = req.headers["idempotency-key"] || req.headers["x-idempotency-key"];

    // 1. Enforce or bypass if key is missing (change to 400 bad request if mandatory)
    if (!idempotencyKey) {
        return next();
    }

    const redisKey = `idempotency:${idempotencyKey}`;

    try {
        // 2. Atomically check if the key already exists in Redis
        const cachedData = await redis.get(redisKey);

        if (cachedData) {
            const parsedRecord = JSON.parse(cachedData);

            // Handle race condition: request is currently being processed by another worker/thread
            if (parsedRecord.status === "PROCESSING") {
                return res.status(409).json({
                    success: false,
                    message: "A request with this Idempotency-Key is currently being processed.",
                });
            }

            // Return cached response safely
            return res.status(parsedRecord.status).json(parsedRecord.body);
        }

        // 3. Set a lock ("PROCESSING") with a short TTL to prevent race conditions
        // NX option ensures it only sets if the key doesn't already exist
        const lockAcquired = await redis.set(redisKey, JSON.stringify({ status: "PROCESSING" }), "EX", 30, "NX");
        
        if (!lockAcquired) {
            return res.status(409).json({
                success: false,
                message: "Concurrent request with the same Idempotency-Key detected.",
            });
        }

        // 4. Intercept res.json to capture the response before transmission
        const originalJson = res.json.bind(res);

        res.json = async function (body) {
            const responseStatus = res.statusCode;

            const responsePayload = {
                status: responseStatus,
                body: body,
            };

            // Save the finalized response into Redis with a 10-minute expiration window
            await redis.set(redisKey, JSON.stringify(responsePayload), "EX", TTL_SECONDS);

            return originalJson(body);
        };

        next();
    } catch (redisError) {
        // Fail-safe: If Redis goes down, log the error and let the request pass through 
        // rather than completely breaking your user API endpoints.
        console.error("Idempotency Middleware Redis Error:", redisError);
        next();
    }
};