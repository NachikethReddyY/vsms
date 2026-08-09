const prisma = require("../../prisma/prismaClient");
const AppError = require("../../errors/AppError");
const { isApprovedAccount } = require("../../middlewares/requireApprovedAccount");

const ACTIVE_ASSIGNMENT_STATUSES = ["ASSIGNED", "CONFIRMED"];

const actorId = (user) => user?.userId || user?.id;

const assertOperationalAccount = (user) => {
  if (!isApprovedAccount(user)) {
    throw new AppError(403, "ACCOUNT_NOT_OPERATIONAL", "Account approval and enabled access are required");
  }
  if (!actorId(user)) throw new AppError(401, "AUTHENTICATION_REQUIRED", "Authentication required");
};

const membershipInclude = {
  roles: { select: { id: true, role: true, assignedAt: true } },
  user: {
    select: {
      id: true,
      fullName: true,
      email: true,
      approvalState: true,
      accessState: true,
      status: true,
      professionalCategory: true,
    },
  },
};

const getActiveMembership = (db, eventId, userId) => db.eventMembership.findFirst({
  where: { eventId, userId, status: "ACTIVE" },
  include: membershipInclude,
});

const requireEventRoles = async (eventId, user, roles, options = {}) => {
  const db = options.db || prisma;
  assertOperationalAccount(user);
  const event = await db.event.findUnique({
    where: { eventId },
    select: { eventId: true, name: true, status: true, version: true, startsAt: true, endsAt: true, timezone: true },
  });
  if (!event) throw new AppError(404, "EVENT_NOT_FOUND", "Event was not found");

  const membership = await getActiveMembership(db, eventId, actorId(user));
  const granted = new Set(membership?.roles.map(({ role }) => role) || []);
  if (!membership || !roles.some((role) => granted.has(role))) {
    throw new AppError(403, "EVENT_ROLE_REQUIRED", `One of these event roles is required: ${roles.join(", ")}`);
  }
  return { event, membership, roles: granted };
};

const requireCurrentDuty = async (eventId, user, role, options = {}) => {
  const db = options.db || prisma;
  const now = options.now || new Date();
  const duty = await db.staffAssignment.findFirst({
    where: {
      eventId,
      userId: actorId(user),
      assignmentRole: role,
      OR: [
        { status: { in: ACTIVE_ASSIGNMENT_STATUSES } },
        { assignmentStatus: { in: ACTIVE_ASSIGNMENT_STATUSES } },
      ],
      ...(options.stationId ? { stationId: options.stationId } : {}),
      shift: { eventId, status: "ACTIVE", startsAt: { lte: now }, endsAt: { gt: now } },
    },
    select: { id: true, stationId: true, shiftId: true, assignmentRole: true },
  });
  if (!duty) {
    throw new AppError(403, "CURRENT_DUTY_REQUIRED", `A current ${role} duty${options.stationId ? " at this station" : ""} is required`);
  }
  return duty;
};

const requireEventRoleAndDuty = async (eventId, user, role, options = {}) => {
  const authorization = await requireEventRoles(eventId, user, [role], options);
  const duty = await requireCurrentDuty(eventId, user, role, options);
  return { ...authorization, duty };
};

const requireEventManager = (eventId, user, options = {}) => requireEventRoles(
  eventId,
  user,
  ["EVENT_MANAGER"],
  options,
);

const requireQueueAccess = async (eventId, user, options = {}) => {
  const authorization = await requireEventRoles(
    eventId,
    user,
    ["EVENT_MANAGER", "REGISTRATION", "SCREENER", "SUPPORT"],
    options,
  );
  if (authorization.roles.has("EVENT_MANAGER")) return authorization;

  for (const role of ["REGISTRATION", "SCREENER", "SUPPORT"]) {
    if (!authorization.roles.has(role)) continue;
    try {
      const duty = await requireCurrentDuty(eventId, user, role, {
        ...options,
        stationId: role === "SCREENER" ? options.stationId : undefined,
      });
      return { ...authorization, duty };
    } catch (error) {
      if (error.code !== "CURRENT_DUTY_REQUIRED") throw error;
    }
  }
  throw new AppError(403, "CURRENT_DUTY_REQUIRED", "A current event duty is required to operate queues");
};

const eventVisibilityWhere = (user, roles = null) => {
  assertOperationalAccount(user);
  return {
    memberships: {
      some: {
        userId: actorId(user),
        status: "ACTIVE",
        ...(roles?.length ? { roles: { some: { role: { in: roles } } } } : { roles: { some: {} } }),
      },
    },
  };
};

module.exports = {
  ACTIVE_ASSIGNMENT_STATUSES,
  actorId,
  assertOperationalAccount,
  eventVisibilityWhere,
  getActiveMembership,
  requireCurrentDuty,
  requireEventManager,
  requireEventRoleAndDuty,
  requireEventRoles,
  requireQueueAccess,
};
