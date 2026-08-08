const asyncHandler = require("./asyncHandler");
const authorization = require("../services/eventAuthorizationService");

const eventIdFrom = (req) => req.params.eventId || req.body?.eventId || req.query?.eventId;

const requireEventRoles = (...roles) => asyncHandler(async (req, _res, next) => {
  req.eventAuthorization = await authorization.requireEventRoles(eventIdFrom(req), req.user || req.auth?.user, roles);
  next();
});

const requireEventManager = asyncHandler(async (req, _res, next) => {
  req.eventAuthorization = await authorization.requireEventManager(eventIdFrom(req), req.user || req.auth?.user);
  next();
});

const requireEventRoleAndDuty = (role, { stationParam } = {}) => asyncHandler(async (req, _res, next) => {
  req.eventAuthorization = await authorization.requireEventRoleAndDuty(
    eventIdFrom(req),
    req.user || req.auth?.user,
    role,
    { stationId: stationParam ? req.params[stationParam] : undefined },
  );
  next();
});

module.exports = { requireEventManager, requireEventRoleAndDuty, requireEventRoles };
