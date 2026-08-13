const express = require("express");
const authenticate = require("../middlewares/authenticate");
const validate = require("../middlewares/validate");
const asyncHandler = require("../utils/http/asyncHandler");
const { rateLimit } = require("../middlewares/rateLimiter");
const operationsController = require("../controllers/operationsController");
const { operationsOverviewQuery } = require("../schemas/operationsSchemas");

const router = express.Router();
const operationsLimiter = rateLimit({
  name: "operations-overview",
  windowMs: 60_000,
  limit: 120,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: (req) => req.user.userId,
});

router.use(authenticate);
router.get(
  "/",
  operationsLimiter,
  validate({ query: operationsOverviewQuery }),
  asyncHandler(operationsController.getOverview),
);

module.exports = router;
