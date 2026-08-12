const express = require("express");
const { rateLimit, ipKeyGenerator } = require("express-rate-limit");
const authenticate = require("../middlewares/authenticate");
const { requireSystemRole } = require("../middlewares/authorize");
const validate = require("../middlewares/validate");
const asyncHandler = require("../utils/http/asyncHandler");
const locationController = require("../controllers/locationController");
const { locationSearchQuery } = require("../schemas/locationSchemas");

const router = express.Router();
const searchLimiter = rateLimit({
  windowMs: 60_000,
  limit: 30,
  keyGenerator: (req) => `${req.user?.userId || "anonymous"}:${ipKeyGenerator(req.ip)}`,
  standardHeaders: "draft-8",
  legacyHeaders: false,
});
const providerLimiter = rateLimit({
  windowMs: 60_000,
  limit: 280,
  keyGenerator: () => "onemap-search",
  standardHeaders: "draft-8",
  legacyHeaders: false,
});

router.use(authenticate, requireSystemRole("ADMIN", "EVENT_MANAGER"));
router.get("/search", searchLimiter, providerLimiter, validate({ query: locationSearchQuery }), asyncHandler(locationController.search));

module.exports = router;
