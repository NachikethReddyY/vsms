const express = require("express");
const participantController = require("../controllers/participantController");
const authenticate = require("../middlewares/authenticate");
const validate = require("../middlewares/validate");
const asyncHandler = require("../utils/asyncHandler");
const {
  participantParams,
  eventContextQuery,
  participantSearchBody,
  participantUpdateBody,
  registrationHistoryQuery,
} = require("../schemas/participantSchemas");

const router = express.Router();
router.use(authenticate);

// Search is POST so sensitive identifiers do not appear in URLs or proxy logs.
router.post(
  "/search",
  validate({ body: participantSearchBody }),
  asyncHandler(participantController.search),
);

router.get(
  "/:participantId/registrations",
  validate({ params: participantParams, query: registrationHistoryQuery }),
  asyncHandler(participantController.registrationHistory),
);

router.get(
  "/:participantId",
  validate({ params: participantParams, query: eventContextQuery }),
  asyncHandler(participantController.profile),
);

router.patch(
  "/:participantId",
  validate({ params: participantParams, body: participantUpdateBody }),
  asyncHandler(participantController.update),
);

module.exports = router;
