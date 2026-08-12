const express = require("express");
const authenticate = require("../middlewares/authenticate");
const validate = require("../middlewares/validate");
const asyncHandler = require("../utils/http/asyncHandler");
const dashboardController = require("../controllers/dashboardController");

const router = express.Router();

router.use(authenticate);

router.get(
  "/overview",
  asyncHandler(dashboardController.getOverview)
);

router.get(
  "/daily-summary",
  asyncHandler(dashboardController.getDailySummary)
);

module.exports = router;