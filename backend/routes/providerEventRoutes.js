const express = require("express");
const asyncHandler = require("../utils/asyncHandler");
const providerEventController = require("../controllers/providerEventController");

const router = express.Router();

router.post(
  "/",
  express.text({ type: ["application/json", "text/plain"], limit: "256kb" }),
  asyncHandler(providerEventController.ingestSesEvent),
);

module.exports = router;
