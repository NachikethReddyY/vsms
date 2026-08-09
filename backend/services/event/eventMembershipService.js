const prisma = require("../../prisma/prismaClient");
const AppError = require("../../errors/AppError");
const { createAuditLog } = require("../../utils/audit");
const { requireEventManager, actorId } = require("./eventAuthorizationService");
const { enqueueAccountLifecycle } = require("../account/accountLifecycleNotificationService");

const EVENT_ROLES = ["EVENT_MANAGER", "REGISTRATION", "SCREENER", "REVIEWER", "SUPPORT"];
const ACTIVE_DUTIES = ["ASSIGNED", "CONFIRMED"];
const EVENT_MEMBERSHIP_LOCK_NAMESPACE = 8172634;
const memberInclude = {
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
  roles: { orderBy: { role: "asc" }, select: { id: true, role: true, assignedAt: true, assignedById: true } },
};

const serialize = (membership) => ({
  membershipId: membership.id,
  eventId: membership.eventId,
  userId: membership.userId,
  status: membership.status,
  addedAt: membership.addedAt,
  removedAt: membership.removedAt,
  removalReason: membership.removalReason,
  user: membership.user,
  roles: membership.roles,
});

const audit = (tx, user, action, membership, context, details = {}) => createAuditLog({
  userId: actorId(user),
  action,
  entityName: "EventMembership",
  entityId: membership.id,
  newValue: { eventId: membership.eventId, memberUserId: membership.userId, ...details },
  context,
  client: tx,
});

const requireEligibleUser = async (tx, userId) => {
  const user = await tx.user.findFirst({
    where: {
      id: userId,
      status: "ACTIVE",
      approvalState: "APPROVED",
      accessState: "ENABLED",
      deprovisionedAt: null,
    },
    select: { id: true },
  });
  if (!user) throw new AppError(422, "MEMBER_NOT_ELIGIBLE", "Only an approved and enabled account can join an event");
};

// All event membership mutations take this lock first, then authorize the
// actor, then inspect or mutate membership rows. This order keeps the final
// manager invariant stable across concurrent requests.
const lockEventMembershipMutation = (tx, eventId) => tx.$executeRaw`
  SELECT pg_advisory_xact_lock(hashtextextended(${eventId}, ${EVENT_MEMBERSHIP_LOCK_NAMESPACE}))
`;

const beginMembershipMutation = async (tx, eventId, user) => {
  await lockEventMembershipMutation(tx, eventId);
  await requireEventManager(eventId, user, { db: tx });
};

const listMemberships = async (eventId, user, db = prisma) => {
  await requireEventManager(eventId, user, { db });
  const memberships = await db.eventMembership.findMany({
    where: { eventId },
    include: memberInclude,
    orderBy: [{ status: "asc" }, { addedAt: "asc" }],
  });
  return { memberships: memberships.map(serialize) };
};

const listEligibleUsers = async (eventId, query, user, db = prisma) => {
  await requireEventManager(eventId, user, { db });
  const search = query.search?.trim();
  const users = await db.user.findMany({
    where: {
      status: "ACTIVE",
      approvalState: "APPROVED",
      accessState: "ENABLED",
      deprovisionedAt: null,
      ...(search ? { OR: [
        { fullName: { contains: search, mode: "insensitive" } },
        { email: { contains: search, mode: "insensitive" } },
      ] } : {}),
    },
    select: {
      id: true,
      fullName: true,
      email: true,
      professionalCategory: true,
      eventMemberships: {
        where: { eventId },
        select: { id: true, status: true, roles: { select: { role: true } } },
      },
    },
    orderBy: [{ fullName: "asc" }, { id: "asc" }],
    take: query.limit || 100,
  });
  return { users };
};

const addMembership = async (eventId, input, user, context, db = prisma) => {
  return db.$transaction(async (tx) => {
    await beginMembershipMutation(tx, eventId, user);
    await requireEligibleUser(tx, input.userId);
    const existing = await tx.eventMembership.findUnique({
      where: { eventId_userId: { eventId, userId: input.userId } },
      include: memberInclude,
    });
    if (existing?.status === "ACTIVE") throw new AppError(409, "MEMBERSHIP_EXISTS", "This account is already an active event member");

    const membership = existing
      ? await tx.eventMembership.update({
          where: { id: existing.id },
          data: {
            status: "ACTIVE",
            addedById: actorId(user),
            addedAt: new Date(),
            removedById: null,
            removedAt: null,
            removalReason: null,
            roles: {
              deleteMany: {},
              createMany: { data: input.roles.map((role) => ({ role, assignedById: actorId(user) })) },
            },
          },
          include: memberInclude,
        })
      : await tx.eventMembership.create({
          data: {
            eventId,
            userId: input.userId,
            addedById: actorId(user),
            roles: { create: input.roles.map((role) => ({ role, assignedById: actorId(user) })) },
          },
          include: memberInclude,
        });
    await audit(tx, user, existing ? "EVENT_MEMBERSHIP_REACTIVATED" : "EVENT_MEMBERSHIP_ADDED", membership, context, { roles: input.roles });
    const event = await tx.event.findUniqueOrThrow({ where: { eventId }, select: { name: true } });
    await enqueueAccountLifecycle({
      type: "EVENT_ASSIGNMENT",
      account: { id: membership.userId },
      metadata: { eventId, eventName: event.name, roles: input.roles },
      idempotencyKey: `EVENT_ASSIGNMENT:${membership.id}:${membership.addedAt.getTime()}`,
      db: tx,
    });
    return serialize(membership);
  });
};

const removeMembership = async (eventId, membershipId, input, user, context, db = prisma) => {
  return db.$transaction(async (tx) => {
    await beginMembershipMutation(tx, eventId, user);
    const membership = await tx.eventMembership.findFirst({ where: { id: membershipId, eventId, status: "ACTIVE" }, include: memberInclude });
    if (!membership) throw new AppError(404, "MEMBERSHIP_NOT_FOUND", "Active event membership was not found");
    if (membership.roles.some(({ role }) => role === "EVENT_MANAGER")) {
      const otherManagers = await tx.eventMembership.count({
        where: { eventId, status: "ACTIVE", id: { not: membershipId }, roles: { some: { role: "EVENT_MANAGER" } } },
      });
      if (!otherManagers) throw new AppError(409, "FINAL_EVENT_MANAGER", "Appoint another event manager before removing this membership");
    }
    await tx.staffAssignment.updateMany({
      where: { eventId, userId: membership.userId, OR: [
        { status: { in: ACTIVE_DUTIES } },
        { assignmentStatus: { in: ACTIVE_DUTIES } },
      ] },
      data: { status: "CANCELLED", assignmentStatus: "CANCELLED" },
    });
    const removed = await tx.eventMembership.update({
      where: { id: membershipId },
      data: { status: "REMOVED", removedById: actorId(user), removedAt: new Date(), removalReason: input.reason },
      include: memberInclude,
    });
    await audit(tx, user, "EVENT_MEMBERSHIP_REMOVED", removed, context, { reason: input.reason });
    return serialize(removed);
  });
};

const addRole = async (eventId, membershipId, role, user, context, db = prisma) => {
  return db.$transaction(async (tx) => {
    await beginMembershipMutation(tx, eventId, user);
    const membership = await tx.eventMembership.findFirst({ where: { id: membershipId, eventId, status: "ACTIVE" } });
    if (!membership) throw new AppError(404, "MEMBERSHIP_NOT_FOUND", "Active event membership was not found");
    const assignment = await tx.eventMembershipRole.upsert({
      where: { membershipId_role: { membershipId, role } },
      update: {},
      create: { membershipId, role, assignedById: actorId(user) },
    });
    const updated = await tx.eventMembership.findUniqueOrThrow({ where: { id: membershipId }, include: memberInclude });
    await audit(tx, user, "EVENT_MEMBERSHIP_ROLE_ASSIGNED", updated, context, { role });
    const event = await tx.event.findUniqueOrThrow({ where: { eventId }, select: { name: true } });
    await enqueueAccountLifecycle({
      type: "EVENT_ASSIGNMENT",
      account: { id: updated.userId },
      metadata: { eventId, eventName: event.name, roles: [role] },
      idempotencyKey: `EVENT_ASSIGNMENT:${assignment.id}:${assignment.assignedAt.getTime()}`,
      db: tx,
    });
    return serialize(updated);
  });
};

const removeRole = async (eventId, membershipId, role, user, context, db = prisma) => {
  return db.$transaction(async (tx) => {
    await beginMembershipMutation(tx, eventId, user);
    const membership = await tx.eventMembership.findFirst({ where: { id: membershipId, eventId, status: "ACTIVE" }, include: memberInclude });
    if (!membership) throw new AppError(404, "MEMBERSHIP_NOT_FOUND", "Active event membership was not found");
    const activeDuty = await tx.staffAssignment.findFirst({
      where: { eventId, userId: membership.userId, assignmentRole: role, OR: [
        { status: { in: ACTIVE_DUTIES } },
        { assignmentStatus: { in: ACTIVE_DUTIES } },
      ] },
      select: { id: true },
    });
    if (activeDuty) throw new AppError(409, "ROLE_HAS_ACTIVE_DUTIES", "Remove current duties before removing this event role");
    if (role === "EVENT_MANAGER") {
      const managerCount = await tx.eventMembershipRole.count({
        where: { role: "EVENT_MANAGER", membership: { eventId, status: "ACTIVE" } },
      });
      if (managerCount <= 1) throw new AppError(409, "FINAL_EVENT_MANAGER", "Every event must retain an active event manager");
    }
    const removed = await tx.eventMembershipRole.deleteMany({ where: { membershipId, role } });
    if (!removed.count) throw new AppError(404, "MEMBERSHIP_ROLE_NOT_FOUND", "Event membership role was not found");
    const updated = await tx.eventMembership.findUniqueOrThrow({ where: { id: membershipId }, include: memberInclude });
    await audit(tx, user, "EVENT_MEMBERSHIP_ROLE_REMOVED", updated, context, { role });
    return serialize(updated);
  });
};

module.exports = {
  EVENT_MEMBERSHIP_LOCK_NAMESPACE,
  EVENT_ROLES,
  addMembership,
  addRole,
  listEligibleUsers,
  listMemberships,
  removeMembership,
  removeRole,
};
