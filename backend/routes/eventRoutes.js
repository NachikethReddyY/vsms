const express = require("express");

const router = express.Router();

const eventController = require("../controllers/eventController");
const requireAuthentication = require("../middlewares/requireAuthentication");

router.use(requireAuthentication);
router.get("/active", eventController.getActiveEvents);
router.get("/:eventId", eventController.getEventById);

module.exports = router;
