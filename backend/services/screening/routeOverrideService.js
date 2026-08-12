const prisma = require("../../prisma/prismaClient");
const AppError = require("../../errors/AppError");
const { createAuditLog } = require("../../utils/logging/audit");
const {
  actorId,
  isAdministrator,
  requireCurrentDuty,
  requireEventRoles,
} = require("../event/eventAuthorizationService");
const { buildRouteState, getRouteState } = require("./routeAssignmentService");
const { reconcileAfterRouteOverride } = require("./routeProgressionService");
const { validateRouteOverride } = require("./routeOverridePolicy");

const routeStepSelect = {
  routeStepId: true,
  stationId: true,
  position: true,
  completedAt: true,
  station: {
    select: {
      stationId: true,
      stationName: true,
      stationType: true,
      isActive: true,
      operationalStatus: true,
    },
  },
};

const authorizeOverride = async (db, eventId, user) => {
  const authorization = await requireEventRoles(
    eventId,
    user,
    ["EVENT_MANAGER", "REGISTRATION", "SCREENER"],
    { db, allowAdministrator: true },
  );
  if (authorization.event.status !== "IN_PROGRESS") {
    throw new AppError(409, "EVENT_NOT_IN_PROGRESS", "Routes can be changed only while the event is in progress.");
  }
  if (isAdministrator(user) || authorization.roles.has("EVENT_MANAGER")) return "FULL";

  for (const role of ["REGISTRATION", "SCREENER"]) {
    if (!authorization.roles.has(role)) continue;
    try {
      await requireCurrentDuty(eventId, user, role, { db });
      return "NEXT_ONLY";
    } catch (error) {
      if (error.code !== "CURRENT_DUTY_REQUIRED") throw error;
    }
  }
  throw new AppError(403, "CURRENT_DUTY_REQUIRED", "A current registration or screening duty is required to change the next station.");
};

const staleRouteError = async (db, registrationId) => new AppError(
  409,
  "ROUTE_VERSION_CONFLICT",
  "The route changed. Refresh and try again with the latest version.",
  { latestRoute: await getRouteState(db, registrationId) },
);

const getRoute = async ({ eventId, registrationId, user, db = prisma }) => {
  await authorizeOverride(db, eventId, user);
  const registration = await db.eventRegistration.findFirst({
    where: { registrationId, eventId },
    select: { registrationId: true },
  });
  if (!registration) throw new AppError(404, "REGISTRATION_NOT_FOUND", "Event registration not found.");
  return getRouteState(db, registrationId);
};

const replaceRoute = async ({
  eventId,
  registrationId,
  stationIds,
  reasonCode,
  expectedVersion,
  user,
  context = null,
  db = prisma,
  now = new Date(),
}) => {
  try {
    return await db.$transaction(async (tx) => {
      const scope = await authorizeOverride(tx, eventId, user);
      const registration = await tx.eventRegistration.findFirst({
        where: { registrationId, eventId },
        select: { registrationId: true, eventId: true, registrationStatus: true, routeVersion: true },
      });
      if (!registration) throw new AppError(404, "REGISTRATION_NOT_FOUND", "Event registration not found.");
      if (["COMPLETED", "CANCELLED"].includes(registration.registrationStatus)) {
        throw new AppError(409, "REGISTRATION_ROUTE_TERMINAL", "Completed or cancelled routes cannot be changed.");
      }
      if (registration.routeVersion !== expectedVersion) {
        throw await staleRouteError(tx, registrationId);
      }

      const [steps, activeQueue] = await Promise.all([
        tx.registrationRouteStep.findMany({
          where: { registrationId },
          select: routeStepSelect,
          orderBy: { position: "asc" },
        }),
        tx.queueEntry.findFirst({
          where: { registrationId, status: { in: ["WAITING", "CALLED", "IN_PROGRESS"] } },
          orderBy: { enteredAt: "desc" },
        }),
      ]);
      if (!steps.length) throw new AppError(409, "ROUTE_NOT_ASSIGNED", "The participant does not have an assigned screening route.");

      const validated = validateRouteOverride({
        steps,
        stationIds,
        activeStationId: activeQueue?.stationId || null,
        scope,
      });
      const version = await tx.eventRegistration.updateMany({
        where: { registrationId, eventId, routeVersion: expectedVersion },
        data: { routeVersion: { increment: 1 } },
      });
      if (version.count !== 1) throw await staleRouteError(tx, registrationId);

      const temporaryOffset = steps.length + 1;
      await tx.registrationRouteStep.updateMany({
        where: { registrationId },
        data: { position: { increment: temporaryOffset } },
      });
      for (const [index, stationId] of validated.after.entries()) {
        await tx.registrationRouteStep.update({
          where: { registrationId_stationId: { registrationId, stationId } },
          data: { position: index + 1 },
        });
      }

      const stepByStation = new Map(steps.map((step) => [step.stationId, step]));
      const orderedSteps = validated.after.map((stationId, index) => ({
        ...stepByStation.get(stationId),
        position: index + 1,
      }));
      const firstUnfinished = orderedSteps.find(({ completedAt }) => !completedAt) || null;
      const queueEntry = await reconcileAfterRouteOverride({
        tx,
        registrationId,
        eventId,
        nextStep: firstUnfinished,
        now,
      });

      const routeVersion = expectedVersion + 1;
      await createAuditLog({
        userId: actorId(user),
        action: "REGISTRATION_ROUTE_OVERRIDDEN",
        entityName: "EventRegistration",
        entityId: registrationId,
        oldValue: { eventId, stationIds: validated.before, routeVersion: expectedVersion },
        newValue: { eventId, stationIds: validated.after, routeVersion, reasonCode, scope },
        context,
        client: tx,
      });

      return buildRouteState({ routeVersion, steps: orderedSteps, queueEntry });
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    if (["P2002", "P2034"].includes(error?.code)) throw await staleRouteError(db, registrationId);
    throw error;
  }
};

module.exports = {
  authorizeOverride,
  getRoute,
  replaceRoute,
};
