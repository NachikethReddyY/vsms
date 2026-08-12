const prisma = require("../prisma/prismaClient");
const asyncHandler = require("./asyncHandler");
const { assertUuid } = require("../utils/validation/validation");
const { assertRegistrationAssignment } = require("../utils/auth/staff");

module.exports = asyncHandler(async (req, _res, next) => {
    const eventId = assertUuid(req.headers["x-event-id"], "X-Event-Id");
    await assertRegistrationAssignment(prisma, eventId, req.auth);
    req.registrationEventId = eventId;
    next();
});
