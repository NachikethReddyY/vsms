const rateLimit = require("express-rate-limit");
const { RedisStore } = require("rate-limit-redis");
const { createClient } = require("redis");

// 1. Initialize and connect the centralized Redis client for multi-instance scaling
const redisClient = createClient({
  url: process.env.REDIS_URL || "redis://localhost:6379",
});

redisClient.connect().catch((err) => {
  console.error("Rate Limiter Redis Connection Error:", err);
});

// 2. Configure the enterprise-grade rate limiter
const verifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // Strict threshold for verification attempts (lowered for security)
  standardHeaders: true, // Return standard RateLimit-* headers
  legacyHeaders: false, // Disable X-RateLimit-* headers
  
  // Use Redis as a shared store across cluster/cloud instances
  store: new RedisStore({
    sendCommand: (...args) => redisClient.sendCommand(args),
    prefix: "rl:verify:", // Namespace keys in Redis
  }),

  // Optional: Custom key generator if you want to track by User ID when authenticated, 
  // falling back to IP address if anonymous.
  keyGenerator: (req) => {
    return req.user?.userId || req.ip;
  },

  // Optional: Skip rate limiting for trusted internal IPs or monitoring tools
  skip: (req) => {
    const trustedIps = (process.env.TRUSTED_IPS || "").split(",");
    return trustedIps.includes(req.ip);
  },

  message: {
    success: false,
    error: "TOO_MANY_REQUESTS",
    message: "Too many verification attempts from this network, please try again later.",
  },
});

module.exports = { verifyLimiter };