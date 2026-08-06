// Simple in-memory cache for demonstration (use Redis or a DB table for production scaling)
const idempotencyStore = new Map();

module.exports = function checkIdempotency(req, res, next) {
    const idempotencyKey = req.headers["idempotency-key"];

    // If no key is provided, let the request pass through normally (or make it mandatory)
    if (!idempotencyKey) {
        return next();
    }

    // If we've already processed this key, return the exact same response
    if (idempotencyStore.has(idempotencyKey)) {
        const cachedResponse = idempotencyStore.get(idempotencyKey);
        return res.status(cachedResponse.status).json(cachedResponse.body);
    }

    // Intercept res.json to capture the response before sending it to the client
    const originalJson = res.json;
    res.json = function (body) {
        // Cache the response status and body against the idempotency key
        idempotencyStore.set(idempotencyKey, {
            status: res.statusCode,
            body: body,
        });

        // Expire the key after 10 minutes to free up memory
        setTimeout(() => {
            idempotencyStore.delete(idempotencyKey);
        }, 10 * 60 * 1000);

        return originalJson.call(this, body);
    };

    next();
};