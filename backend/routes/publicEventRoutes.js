const express = require("express");
const { rateLimit } = require("express-rate-limit");
const eventController = require("../controllers/eventController");
const validate = require("../middlewares/validate");
const asyncHandler = require("../utils/asyncHandler");
const { eventParams } = require("../schemas/eventSchemas");

const router = express.Router();
router.use(rateLimit({ windowMs: 60000, limit: 120, standardHeaders: "draft-8", legacyHeaders: false }));
router.get("/:eventId", validate({ params: eventParams }), asyncHandler(eventController.publicGet));

module.exports = router;
