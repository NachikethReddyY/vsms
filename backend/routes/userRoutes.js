const express = require("express");
const router = express.Router();

const userController = require("../controllers/userController");
const requireAuthentication = require("../middlewares/requireAuthentication");
const requireAnyRole = require("../middlewares/requireAnyRole");
const validate = require("../middlewares/validate");
const { createUserBody, updateUserBody, userParams } = require("../schemas/userSchemas");

// Organisation accounts use the application administrator role. `ADMIN` remains
// a derived system role for legacy event capabilities, never the source of truth.
router.use(requireAuthentication, requireAnyRole("ADMINISTRATOR"));
router.get("/", userController.getUsers);

router.post(
  "/",
  validate({ body: createUserBody }),
  userController.createUser
);
router.patch("/:id", validate({ params: userParams, body: updateUserBody }), userController.updateUser);

module.exports = router;
