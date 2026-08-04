const crypto = require("crypto");
const prisma = require("../prisma/prismaClient");
const AppError = require("../errors/AppError");
const { IMPORTABLE_TEMPLATE_KEYS } = require("./stationTemplateMapping");

const FLAG_RANK = { NORMAL: 0, REVIEW: 1, REFER: 2, URGENT: 3 };
const ACTIVE_ASSIGNMENT_STATUSES = ["ASSIGNED", "CONFIRMED"];
const SUPPORTED_SCREENING_TYPES = Object.values(IMPORTABLE_TEMPLATE_KEYS);

const highestFlag = (results) => results.reduce(
  (highest, result) => FLAG_RANK[result.overallFlag] > FLAG_RANK[highest] ? result.overallFlag : highest,
  "NORMAL",
);

const reviewReadiness = (stations, results) => {
  const stationIds = new Set(stations.map((station) => station.stationId));
  const activeResults = results.filter((result) => stationIds.has(result.stationId));
  const completedStationCount = new Set(activeResults.map((result) => result.stationId)).size;
  const screeningComplete = stations.length > 0 && completedStationCount === stations.length;
  const urgent = activeResults.some((result) => result.overallFlag === "URGENT");

  return {
    ready: screeningComplete || urgent,
    readyReason: screeningComplete ? "SCREENING_COMPLETE" : urgent ? "URGENT_FLAG" : null,
    completedStationCount,
    totalStationCount: stations.length,
    highestFlag: highestFlag(activeResults),
    flaggedResultCount: activeResults.filter((result) => result.overallFlag !== "NORMAL").length,
    lastResultAt: activeResults.reduce((latest, result) => {
      const value = result.updatedAt || result.createdAt;
      return !latest || value > latest ? value : latest;
    }, null),
  };
};

const contextVersion = (stations, results) => {
  const byStation = new Map(results.map((result) => [result.stationId, result]));
  const context = [...stations]
    .sort((a, b) => a.stationId.localeCompare(b.stationId))
    .map(({ stationId }) => {
      const result = byStation.get(stationId);
      return `${stationId}|${result?.resultId || ""}|${result?.updatedAt ? new Date(result.updatedAt).toISOString() : ""}`;
    })
    .join("\n");
  return crypto.createHash("sha256").update(context).digest("hex");
};

const compareQueueItems = (left, right) => {
  const flagDifference = FLAG_RANK[right.highestFlag] - FLAG_RANK[left.highestFlag];
  if (flagDifference) return flagDifference;
  if (left.queueNumber == null && right.queueNumber != null) return 1;
  if (left.queueNumber != null && right.queueNumber == null) return -1;
  if (left.queueNumber !== right.queueNumber) return (left.queueNumber || 0) - (right.queueNumber || 0);
  return left.participantDisplayName.localeCompare(right.participantDisplayName, undefined, { sensitivity: "base" });
};

const requireReviewerAccess = async (db, eventId, userId) => {
  const event = await db.event.findUnique({
    where: { eventId },
    select: { eventId: true, name: true, venue: true, timezone: true, status: true },
  });
  if (!event) throw new AppError(404, "EVENT_NOT_FOUND", "Event not found");
  if (event.status !== "IN_PROGRESS") {
    throw new AppError(409, "EVENT_NOT_IN_PROGRESS", "Clinical review is available only while the event is in progress");
  }

  const assignment = await db.staffAssignment.findFirst({
    where: {
      eventId,
      userId,
      assignmentRole: "REVIEWER",
      status: { in: ACTIVE_ASSIGNMENT_STATUSES },
      shift: { eventId, status: "ACTIVE" },
    },
    select: { id: true },
  });
  if (!assignment) {
    throw new AppError(403, "REVIEWER_ASSIGNMENT_REQUIRED", "An active reviewer assignment is required");
  }
  return event;
};

const activeStations = (db, eventId) => db.station.findMany({
  where: { eventId, isActive: true, stationType: { in: SUPPORTED_SCREENING_TYPES } },
  orderBy: [{ stationOrder: "asc" }, { stationId: "asc" }],
  select: {
    stationId: true,
    stationName: true,
    stationType: true,
    stationOrder: true,
    updatedAt: true,
  },
});

const resultSelect = {
  resultId: true,
  stationId: true,
  screeningType: true,
  resultData: true,
  overallFlag: true,
  isFlagged: true,
  flagSummary: true,
  ruleVersion: true,
  createdAt: true,
  updatedAt: true,
};

const displayName = (registration) => registration.participantDisplayName
  || `${registration.participant.firstName} ${registration.participant.lastName}`.trim()
  || "Unnamed participant";

const listQueue = async (eventId, user) => {
  const event = await requireReviewerAccess(prisma, eventId, user.userId);
  const stations = await activeStations(prisma, eventId);
  if (stations.length === 0) return { event, queue: [] };
  const stationIds = stations.map((station) => station.stationId);
  const registrations = await prisma.eventRegistration.findMany({
    where: {
      eventId,
      registrationStatus: { in: ["SIGNED_UP", "CHECKED_IN"] },
      reviews: { none: {} },
    },
    orderBy: { registrationId: "asc" },
    select: {
      registrationId: true,
      participantDisplayName: true,
      queueNumber: true,
      participant: { select: { firstName: true, lastName: true } },
      screeningResults: { where: { stationId: { in: stationIds } }, select: resultSelect },
    },
  });

  const queue = registrations.flatMap((registration) => {
    const readiness = reviewReadiness(stations, registration.screeningResults);
    if (!readiness.ready) return [];
    return [{
      registrationId: registration.registrationId,
      participantDisplayName: displayName(registration),
      queueNumber: registration.queueNumber,
      highestFlag: readiness.highestFlag,
      flaggedResultCount: readiness.flaggedResultCount,
      completedStationCount: readiness.completedStationCount,
      totalStationCount: readiness.totalStationCount,
      readyReason: readiness.readyReason,
      lastResultAt: readiness.lastResultAt,
    }];
  });
  queue.sort(compareQueueItems);
  return { event, queue };
};

const loadRegistration = async (db, eventId, registrationId, stations) => {
  const stationIds = stations.map((station) => station.stationId);
  return db.eventRegistration.findFirst({
    where: { registrationId, eventId },
    select: {
      registrationId: true,
      participantDisplayName: true,
      queueNumber: true,
      registrationStatus: true,
      participant: {
        select: {
          nric: true,
          firstName: true,
          lastName: true,
          dateOfBirth: true,
          gender: true,
        },
      },
      screeningResults: { where: { stationId: { in: stationIds } }, select: resultSelect },
      reviews: {
        where: { version: 1 },
        take: 1,
        select: {
          reviewId: true,
          version: true,
          outcome: true,
          urgency: true,
          clinicalSummary: true,
          recommendations: true,
          reviewedAt: true,
          reviewer: { select: { fullName: true } },
          referrals: {
            take: 1,
            select: {
              referralId: true,
              destinationName: true,
              reason: true,
              instructions: true,
              urgency: true,
              status: true,
            },
          },
        },
      },
    },
  });
};

const serializeReview = (review) => review ? {
  reviewId: review.reviewId,
  version: review.version,
  outcome: review.outcome,
  urgency: review.urgency,
  clinicalSummary: review.clinicalSummary,
  recommendations: review.recommendations,
  reviewedAt: review.reviewedAt,
  reviewedByName: review.reviewer.fullName,
  referral: review.referrals[0] || null,
} : null;

const serializeReferral = (referral) => referral ? {
  referralId: referral.referralId,
  destinationName: referral.destinationName,
  reason: referral.reason,
  instructions: referral.instructions,
  urgency: referral.urgency,
  status: referral.status,
} : null;

const buildDetail = (event, stations, registration) => {
  const resultByStation = new Map(registration.screeningResults.map((result) => [result.stationId, result]));
  const readiness = reviewReadiness(stations, registration.screeningResults);
  return {
    event,
    participant: {
      registrationId: registration.registrationId,
      participantDisplayName: displayName(registration),
      queueNumber: registration.queueNumber,
      registrationStatus: registration.registrationStatus,
      maskedNric: `••••${String(registration.participant.nric).slice(-4)}`,
      dateOfBirth: registration.participant.dateOfBirth.toISOString().slice(0, 10),
      gender: registration.participant.gender,
    },
    stations: stations.map((station) => ({
      stationId: station.stationId,
      stationName: station.stationName,
      stationType: station.stationType,
      stationOrder: station.stationOrder,
      result: resultByStation.get(station.stationId) || null,
    })),
    readiness: {
      ready: readiness.ready,
      readyReason: readiness.readyReason,
      completedStationCount: readiness.completedStationCount,
      totalStationCount: readiness.totalStationCount,
      highestFlag: readiness.highestFlag,
    },
    existingReview: serializeReview(registration.reviews[0]),
    contextVersion: contextVersion(stations, registration.screeningResults),
  };
};

const getDetail = async (eventId, registrationId, user) => {
  const event = await requireReviewerAccess(prisma, eventId, user.userId);
  const stations = await activeStations(prisma, eventId);
  const registration = await loadRegistration(prisma, eventId, registrationId, stations);
  if (!registration) throw new AppError(404, "REGISTRATION_NOT_FOUND", "Registration not found");
  return buildDetail(event, stations, registration);
};

const decisionUrgency = (decision) => {
  if (decision.outcome === "URGENT_ESCALATION") return "EMERGENCY";
  if (decision.outcome === "REFER") return decision.urgency;
  return "ROUTINE";
};

const recordDecision = async (eventId, registrationId, decision, user, ipAddress) => {
  const userId = user.userId;
  try {
    return await prisma.$transaction(async (tx) => {
      await requireReviewerAccess(tx, eventId, userId);
      const stations = await activeStations(tx, eventId);
      const registration = await loadRegistration(tx, eventId, registrationId, stations);
      if (!registration) throw new AppError(404, "REGISTRATION_NOT_FOUND", "Registration not found");
      if (registration.reviews[0]) {
        throw new AppError(409, "REVIEW_ALREADY_RECORDED", "A clinical review has already been recorded");
      }

      const readiness = reviewReadiness(stations, registration.screeningResults);
      if (!readiness.ready || ["COMPLETED", "CANCELLED"].includes(registration.registrationStatus)) {
        throw new AppError(409, "REVIEW_NOT_READY", "This registration is not ready for clinical review");
      }
      if (contextVersion(stations, registration.screeningResults) !== decision.contextVersion) {
        throw new AppError(409, "SCREENING_RESULTS_CHANGED", "Screening results changed; reassess before deciding");
      }

      const urgency = decisionUrgency(decision);
      const review = await tx.review.create({
        data: {
          registrationId,
          version: 1,
          reviewedByUserId: userId,
          parentReviewId: null,
          outcome: decision.outcome,
          urgency,
          clinicalSummary: decision.clinicalSummary,
          recommendations: decision.recommendations || null,
        },
      });

      const referral = decision.referral ? await tx.referral.create({
        data: {
          reviewId: review.reviewId,
          registrationId,
          createdByUserId: userId,
          destinationName: decision.referral.destinationName,
          reason: decision.referral.reason,
          instructions: decision.referral.instructions || null,
          urgency,
          status: "DRAFT",
        },
      }) : null;

      const completed = await tx.eventRegistration.updateMany({
        where: { registrationId, eventId, registrationStatus: { in: ["SIGNED_UP", "CHECKED_IN"] } },
        data: { registrationStatus: "COMPLETED" },
      });
      if (completed.count !== 1) {
        throw new AppError(409, "REVIEW_NOT_READY", "This registration is not ready for clinical review");
      }

      const auditBase = {
        eventId,
        registrationId,
        reviewId: review.reviewId,
        outcome: review.outcome,
        urgency: review.urgency,
      };
      await tx.auditLog.create({
        data: {
          userId,
          action: "CLINICAL_REVIEW_RECORDED",
          resource: "Review",
          details: auditBase,
          ipAddress: String(ipAddress || "").slice(0, 45) || null,
        },
      });
      if (referral) {
        await tx.auditLog.create({
          data: {
            userId,
            action: "REFERRAL_DRAFT_CREATED",
            resource: "Referral",
            details: { ...auditBase, referralId: referral.referralId, referralStatus: referral.status },
            ipAddress: String(ipAddress || "").slice(0, 45) || null,
          },
        });
      }

      return {
        registrationStatus: "COMPLETED",
        review: {
          reviewId: review.reviewId,
          version: review.version,
          outcome: review.outcome,
          urgency: review.urgency,
          clinicalSummary: review.clinicalSummary,
          recommendations: review.recommendations,
          reviewedAt: review.reviewedAt,
        },
        referral: serializeReferral(referral),
      };
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    if (error?.code === "P2002" || error?.code === "P2034") {
      const existing = await prisma.review.findFirst({ where: { registrationId, version: 1 }, select: { reviewId: true } });
      if (existing) throw new AppError(409, "REVIEW_ALREADY_RECORDED", "A clinical review has already been recorded");
      throw new AppError(409, "SCREENING_RESULTS_CHANGED", "Screening results changed; reassess before deciding");
    }
    throw error;
  }
};

module.exports = {
  listQueue,
  getDetail,
  recordDecision,
  reviewReadiness,
  compareQueueItems,
  contextVersion,
};
