const crypto = require("crypto");
const prisma = require("../../prisma/prismaClient");
const AppError = require("../../errors/AppError");
const env = require("../../config/env");
const eventService = require("./eventService");
const eventAuthorization = require("./eventAuthorizationService");
const screeningService = require("../screening/screeningService");
const queueService = require("../screening/queueService");
const reviewService = require("../screening/reviewService");
const { buildRouteState } = require("../screening/routeAssignmentService");

const EVENT_ROLES = ["EVENT_MANAGER", "REGISTRATION", "SCREENER", "REVIEWER", "SUPPORT"];
const DUTY_ROLES = ["SCREENER", "REGISTRATION", "SUPPORT", "REVIEWER"];

const safeStation = (station) => ({
  stationId: station.stationId,
  eventId: station.eventId,
  stationName: station.stationName,
  stationType: station.stationType,
  stationOrder: station.stationOrder,
  isActive: station.isActive,
  fieldSchemaSnapshot: station.fieldSchemaSnapshot || null,
  schemaVersion: station.schemaVersion ?? null,
  offlineAccessExpiresAt: station.offlineAccessExpiresAt || null,
});

const safeRegistration = (registration) => ({
  registrationId: registration.registrationId,
  participantDisplayName: registration.participantDisplayName,
  queueNumber: registration.queueNumber,
  status: registration.status,
  existingResult: registration.existingResult ? {
    resultId: registration.existingResult.resultId,
    overallFlag: registration.existingResult.overallFlag,
    isFlagged: registration.existingResult.isFlagged,
    createdAt: registration.existingResult.createdAt,
  } : null,
});

const safeReviewQueueItem = (item) => ({
  registrationId: item.registrationId,
  participantDisplayName: item.participantDisplayName,
  queueNumber: item.queueNumber,
  highestFlag: item.highestFlag,
  flaggedResultCount: item.flaggedResultCount,
  completedStationCount: item.completedStationCount,
  skippedStationCount: item.skippedStationCount,
  totalStationCount: item.totalStationCount,
  readyReason: item.readyReason,
  lastResultAt: item.lastResultAt,
});

const safeReviewEvent = (event) => ({
  eventId: event.eventId,
  name: event.name,
  venue: event.venue,
  timezone: event.timezone,
  status: event.status,
});

const safeReviewResult = (result) => result ? {
  resultId: result.resultId,
  stationId: result.stationId,
  screeningType: result.screeningType,
  resultData: result.resultData,
  overallFlag: result.overallFlag,
  isFlagged: result.isFlagged,
  flagSummary: result.flagSummary,
  ruleVersion: result.ruleVersion,
  createdAt: result.createdAt,
  updatedAt: result.updatedAt,
} : null;

const safeReviewDetail = (detail) => ({
  event: safeReviewEvent(detail.event),
  participant: {
    registrationId: detail.participant.registrationId,
    participantDisplayName: detail.participant.participantDisplayName,
    queueNumber: detail.participant.queueNumber,
    registrationStatus: detail.participant.registrationStatus,
    maskedNric: detail.participant.maskedNric,
    dateOfBirth: detail.participant.dateOfBirth,
    gender: detail.participant.gender,
  },
  stations: detail.stations.map((station) => ({
    stationId: station.stationId,
    stationName: station.stationName,
    stationType: station.stationType,
    stationOrder: station.stationOrder,
    fieldSchemaSnapshot: station.fieldSchemaSnapshot,
    status: station.status,
    result: safeReviewResult(station.result),
  })),
  readiness: {
    ready: detail.readiness.ready,
    readyReason: detail.readiness.readyReason,
    completedStationCount: detail.readiness.completedStationCount,
    skippedStationCount: detail.readiness.skippedStationCount,
    totalStationCount: detail.readiness.totalStationCount,
    highestFlag: detail.readiness.highestFlag,
  },
  existingReview: null,
  contextVersion: detail.contextVersion,
});

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

const loadOfflineRoutes = async (db, eventId, registrationIds) => {
  if (!registrationIds.length) return [];
  const registrations = await db.eventRegistration.findMany({
    where: { eventId, registrationId: { in: registrationIds } },
    select: {
      registrationId: true,
      routeVersion: true,
      routeSteps: { select: routeStepSelect, orderBy: { position: "asc" } },
      queueEntries: {
        where: { status: { in: ["WAITING", "CALLED", "IN_PROGRESS"] } },
        select: { id: true, stationId: true, queueNumber: true, status: true },
        orderBy: { enteredAt: "desc" },
        take: 1,
      },
    },
  });
  const byId = new Map(registrations.map((registration) => [registration.registrationId, registration]));
  return registrationIds.flatMap((registrationId) => {
    const registration = byId.get(registrationId);
    return registration ? [{
      registrationId,
      route: buildRouteState({
        routeVersion: registration.routeVersion,
        steps: registration.routeSteps,
        queueEntry: registration.queueEntries[0] || null,
      }),
    }] : [];
  });
};

const safeEvent = (event, actorId) => {
  const { eventTeam: _eventTeam, createdBy: _createdBy, cancelledBy: _cancelledBy, ...safe } = event;
  return {
    ...safe,
    shifts: (event.shifts || []).flatMap((shift) => {
      const ownAssignments = (shift.staffAssignments || [])
        .filter((assignment) => assignment.user?.userId === actorId);
      return ownAssignments.length ? [{ ...shift, staffAssignments: ownAssignments }] : [];
    }),
  };
};

const packIdFor = ({ actorId, eventId, deviceId, generatedAt, expiresAt, nonce, secret }) => crypto
  .createHmac("sha256", secret)
  .update(JSON.stringify({ schemaVersion: 1, actorId, eventId, deviceId, generatedAt, expiresAt, nonce }))
  .digest("base64url");

const leaseSigningBytes = (payload) => Buffer.from(JSON.stringify({
  schemaVersion: payload.schemaVersion,
  packId: payload.packId,
  actorId: payload.actorId,
  eventId: payload.eventId,
  deviceId: payload.deviceId,
  issuedAt: payload.issuedAt,
  expiresAt: payload.expiresAt,
  roles: payload.roles,
  capabilities: {
    screening: payload.capabilities.screening,
    registration: payload.capabilities.registration,
    queue: payload.capabilities.queue,
    review: payload.capabilities.review,
    routeOverride: payload.capabilities.routeOverride,
  },
}));

const signLease = (payload, keys = env) => ({
  algorithm: "ES256",
  keyId: keys.offlineLeaseKeyId,
  publicKey: keys.offlineLeasePublicJwk,
  payload,
  signature: crypto.sign("sha256", leaseSigningBytes(payload), {
    key: keys.offlineLeasePrivateKey,
    dsaEncoding: "ieee-p1363",
  }).toString("base64url"),
});

const verifyLease = (lease) => crypto.verify(
  "sha256",
  leaseSigningBytes(lease.payload),
  {
    key: crypto.createPublicKey({ key: lease.publicKey, format: "jwk" }),
    dsaEncoding: "ieee-p1363",
  },
  Buffer.from(lease.signature, "base64url"),
);

const asTime = (value) => {
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
};

const getOfflinePack = async (eventId, user, context, existingAuthorization, dependencies = {}) => {
  const auth = dependencies.authorization || eventAuthorization;
  const screening = dependencies.screening || screeningService;
  const queue = dependencies.queue || queueService;
  const review = dependencies.review || reviewService;
  const db = dependencies.db || prisma;
  const getEvent = dependencies.getEvent || eventService.getEvent;
  const now = dependencies.now || new Date();
  const deviceId = context?.deviceId;
  if (!deviceId) throw new AppError(422, "DEVICE_ID_REQUIRED", "A valid x-device-id header is required");

  const authorization = existingAuthorization || await auth.requireEventRoles(
    eventId,
    user,
    EVENT_ROLES,
    { allowAdministrator: true },
  );
  if (auth.isAdministrator(user) && !authorization.membership) {
    throw new AppError(403, "OFFLINE_ADMIN_UNAVAILABLE", "Global administrator access remains online-only");
  }
  const event = safeEvent(await getEvent(eventId, user), user.userId);
  const eventEnd = asTime(event.endsAt);
  if (!eventEnd || eventEnd <= now.getTime()) {
    throw new AppError(409, "OFFLINE_PACK_UNAVAILABLE", "Offline access is unavailable after the event ends");
  }

  const managerAccess = authorization.roles.has("EVENT_MANAGER");
  const activeDuties = [];
  let reviewerEligibilityError = null;
  for (const role of DUTY_ROLES.filter((candidate) => authorization.roles.has(candidate))) {
    try {
      const duty = await auth.requireEventRoleAndDuty(eventId, user, role);
      activeDuties.push({ role, duty });
    } catch (error) {
      if (error.code === "CURRENT_DUTY_REQUIRED") continue;
      if (error.code === "DOCTOR_REQUIRED") {
        reviewerEligibilityError = error;
        continue;
      }
      throw error;
    }
  }
  if (!managerAccess && activeDuties.length === 0) {
    if (reviewerEligibilityError) throw reviewerEligibilityError;
    throw new AppError(403, "CURRENT_DUTY_REQUIRED", "A current event duty is required for offline access");
  }

  const dutyEnds = activeDuties.map(({ duty }) => (
    asTime((event.shifts || []).find(({ shiftId }) => shiftId === duty.shiftId)?.endsAt)
  ));
  if (activeDuties.length && dutyEnds.some((end) => !end || end <= now.getTime())) {
    throw new AppError(403, "CURRENT_DUTY_REQUIRED", "The active duty expiry could not be verified");
  }

  const screeningStations = [];
  if (activeDuties.some(({ role }) => role === "SCREENER")) {
    const accessible = await screening.listStations(eventId, user);
    for (const station of accessible.stations.filter((item) => item.eventId === eventId)) {
      const queue = await screening.listQueue(eventId, station.stationId, user);
      screeningStations.push({
        ...safeStation(station),
        registrations: queue.registrations.map(safeRegistration),
      });
    }
  }

  let registration;
  if (activeDuties.some(({ role }) => role === "REGISTRATION")) {
    const available = await queue.listRegistrationStations(eventId, user);
    const [registrations, queues] = await Promise.all([
      db.eventRegistration.aggregate({ where: { eventId }, _max: { queueNumber: true } }),
      db.queueEntry.aggregate({ where: { station: { eventId } }, _max: { queueNumber: true } }),
    ]);
    registration = {
      stations: available.stations.filter(({ selectable }) => selectable).map((station) => ({
        stationId: station.stationId,
        stationName: station.stationName,
        stationType: station.stationType,
        stationOrder: station.stationOrder,
      })),
      nextQueueNumber: Math.max(
        registrations._max.queueNumber || 0,
        queues._max.queueNumber || 0,
      ) + 1,
    };
  }

  let queueSnapshot;
  if (
    event.status === "IN_PROGRESS"
    && (managerAccess || activeDuties.some(({ role }) => ["REGISTRATION", "SCREENER", "SUPPORT"].includes(role)))
  ) {
    try {
      queueSnapshot = await queue.getEventQueueStatus(eventId, user);
    } catch (error) {
      if (!["EVENT_ROLE_REQUIRED", "CURRENT_DUTY_REQUIRED"].includes(error.code)) throw error;
    }
  }

  const canOverrideRoutes = Boolean(queueSnapshot) && (
    managerAccess || activeDuties.some(({ role }) => ["REGISTRATION", "SCREENER"].includes(role))
  );
  let routes;
  if (canOverrideRoutes) {
    const registrationIds = [...new Set(
      queueSnapshot.entries.map(({ registrationId }) => registrationId).filter(Boolean),
    )];
    routes = await (dependencies.loadRoutes || loadOfflineRoutes)(db, eventId, registrationIds);
  }

  let reviewSnapshot;
  if (event.status === "IN_PROGRESS" && activeDuties.some(({ role }) => role === "REVIEWER")) {
    const actionable = await review.listQueue(eventId, user);
    const details = await Promise.all(actionable.queue.map(({ registrationId }) => (
      review.getDetail(eventId, registrationId, user)
    )));
    const currentDetails = details.filter((detail) => (
      !detail.existingReview
      && detail.readiness.ready
      && ["SIGNED_UP", "CHECKED_IN"].includes(detail.participant.registrationStatus)
    ));
    const currentRegistrationIds = new Set(currentDetails.map(({ participant }) => participant.registrationId));
    reviewSnapshot = {
      event: safeReviewEvent(actionable.event),
      queue: actionable.queue.filter(({ registrationId }) => currentRegistrationIds.has(registrationId)).map(safeReviewQueueItem),
      details: currentDetails.map(safeReviewDetail),
    };
  }

  const generatedAt = now.toISOString();
  const expiresAt = new Date(Math.min(
    eventEnd,
    ...(activeDuties.length ? dutyEnds : []),
  )).toISOString();
  const packId = packIdFor({
    actorId: user.userId,
    eventId,
    deviceId,
    generatedAt,
    expiresAt,
    nonce: (dependencies.randomUUID || crypto.randomUUID)(),
    secret: dependencies.secret || env.jwtAccessSecret,
  });
  const roles = [
    ...(managerAccess ? ["EVENT_MANAGER"] : []),
    ...activeDuties.map(({ role }) => role),
  ];
  const capabilities = {
    screening: screeningStations.length > 0,
    registration: Boolean(registration),
    queue: Boolean(queueSnapshot),
    review: Boolean(reviewSnapshot),
    routeOverride: canOverrideRoutes,
  };
  const lease = signLease({
    schemaVersion: 1,
    packId,
    actorId: user.userId,
    eventId,
    deviceId,
    issuedAt: generatedAt,
    expiresAt,
    roles,
    capabilities,
  }, dependencies.leaseKeys || env);

  return {
    schemaVersion: 1,
    packId,
    generatedAt,
    expiresAt,
    event,
    roles,
    capabilities,
    lease,
    screening: {
      event: { eventId: event.eventId, name: event.name, status: event.status },
      stations: screeningStations,
    },
    ...(registration ? { registration } : {}),
    ...(queueSnapshot ? { queue: queueSnapshot } : {}),
    ...(routes ? { routes } : {}),
    ...(reviewSnapshot ? { review: reviewSnapshot } : {}),
  };
};

module.exports = { getOfflinePack, __test: { leaseSigningBytes, loadOfflineRoutes, packIdFor, safeEvent, signLease, verifyLease } };
