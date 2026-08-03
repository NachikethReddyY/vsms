const buckets = new Map();

function rateLimit({ windowMs = 60_000, max = 60, key = (req) => req.ip }) {
    return (req, res, next) => {
        const now = Date.now();
        const bucketKey = `${req.method}:${req.baseUrl}:${key(req) || "unknown"}`;
        const current = buckets.get(bucketKey);

        if (!current || current.resetAt <= now) {
            buckets.set(bucketKey, { count: 1, resetAt: now + windowMs });
            return next();
        }

        current.count += 1;
        if (current.count > max) {
            res.setHeader("Retry-After", String(Math.ceil((current.resetAt - now) / 1000)));
            return res.status(429).json({
                error: "Too many requests. Please try again later.",
                requestId: req.context?.requestId,
            });
        }

        next();
    };
}

function cleanupRateLimitBuckets() {
    const now = Date.now();
    for (const [key, value] of buckets.entries()) {
        if (value.resetAt <= now) buckets.delete(key);
    }
}

const cleanupTimer = setInterval(cleanupRateLimitBuckets, 5 * 60_000);
cleanupTimer.unref();

module.exports = {
    rateLimit,
    cleanupRateLimitBuckets,
};
