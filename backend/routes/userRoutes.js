const express = require("express");
const router = express.Router();

const userController = require("../controllers/userController");
const requireAuthentication = require("../middlewares/requireAuthentication");
const requireAnyRole = require("../middlewares/requireAnyRole");
const validate = require("../middlewares/validate");
const { createUserBody, updateUserBody, userParams } = require("../schemas/userSchemas");

// Import your production-grade or in-memory idempotency middleware
const checkIdempotency = require("../middlewares/idempotency");

// Organisation accounts use the application administrator role. `ADMIN` remains
// a derived system role for legacy event capabilities, never the source of truth.
router.use(requireAuthentication, requireAnyRole("ADMINISTRATOR"));

// GET requests do not mutate data, so idempotency middleware is skipped here
router.get("/", userController.getUsers);

// Apply `checkIdempotency` right before validation/controller handling on mutations
router.post(
  "/",
  checkIdempotency,
  validate({ body: createUserBody }),
  userController.createUser
);

router.patch(
  "/:id",
  checkIdempotency,
  validate({ params: userParams, body: updateUserBody }),
  userController.updateUser
);

module.exports = router;