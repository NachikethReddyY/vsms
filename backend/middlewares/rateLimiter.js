// ==========================================
// middlewares/rateLimiter.js
// ==========================================
const rateLimit = require("express-rate-limit");

const verifyLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per window
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
    message: {
        success: false,
        error: "TOO_MANY_REQUESTS",
        message: "Too many verification attempts from this IP, please try again later.",
    },
});

module.exports = { verifyLimiter };