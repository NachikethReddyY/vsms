const crypto = require("crypto");
const prisma = require("../../prisma/prismaClient");
const AppError = require("../../errors/AppError");
const { resolveRegistrationByQrValue } = require("../../utils/crypto/qrToken");
const { resolveCompatibleFieldSchema } = require("../../schemas/dynamicStationSchema");

const {
  loadVerifiedSignature,
  consumeSignatureArtifact,
} = require("../../utils/storage/signatureStorage");

const { requireEventRoleAndDuty } = require("../event/eventAuthorizationService");
const { maskNric } = require("../../utils/validation/validation");
const { resolveCompatibleFieldSchema } = require("../../schemas/dynamicStationSchema");

const FLAG_RANK = {
  NORMAL: 0,
  REVIEW: 1,
  REFER: 2,
  URGENT: 3,
};

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

const requireReviewerAccess = async (db, eventId, user) => {
  await requireEventRoleAndDuty(eventId, user, "REVIEWER", { db });
  const event = await db.event.findUnique({
    where: { eventId },
    select: { eventId: true, name: true, venue: true, timezone: true, status: true },
  });
  if (!event) throw new AppError(404, "EVENT_NOT_FOUND", "Event not found");
  if (event.status !== "IN_PROGRESS") {
    throw new AppError(409, "EVENT_NOT_IN_PROGRESS", "Clinical review is available only while the event is in progress");
  }

  return event;
};

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
      stationOrder: true,
      fieldSchemaSnapshot: true,
      updatedAt: true,
    },
  },
};

const routeStations = (registration) => registration.routeSteps
  .slice()
  .sort((left, right) => left.position - right.position)
  .map(({ station }) => station);

const assertReviewOutcomeAllowed = (readiness, outcome) => {
  const incompleteUrgentRoute = readiness.readyReason === "URGENT_FLAG";
  if (incompleteUrgentRoute && outcome !== "URGENT_ESCALATION") {
    throw new AppError(409, "URGENT_ESCALATION_REQUIRED", "An incomplete urgent route can only be closed by urgent escalation.");
  }
  if (outcome === "URGENT_ESCALATION" && readiness.highestFlag !== "URGENT") {
    throw new AppError(409, "URGENT_FLAG_REQUIRED", "Urgent escalation requires an urgent screening result.");
  }
  return incompleteUrgentRoute;
};

const stopRouteForUrgentReview = (tx, registrationId, now = new Date()) => tx.queueEntry.updateMany({
  where: { registrationId, status: { in: ["WAITING", "CALLED", "IN_PROGRESS"] } },
  data: { status: "CANCELLED", leftQueueAt: now },
});

const unfinishedRouteStationIds = (routeSteps) => routeSteps
  .filter(({ completedAt }) => !completedAt)
  .sort((left, right) => left.position - right.position)
  .map(({ stationId }) => stationId);

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
  const event = await requireReviewerAccess(prisma, eventId, user);
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
      routeSteps: { select: routeStepSelect, orderBy: { position: "asc" } },
      screeningResults: { select: resultSelect },
    },
  });

  const queue = registrations.flatMap((registration) => {
    const stations = routeStations(registration);
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

const resolveScannedRegistration = async (eventId, passToken, user, db = prisma) => {
  await requireReviewerAccess(db, eventId, user);
  const registration = await resolveRegistrationByQrValue(db, { eventId, value: passToken });
  if (!registration) throw new AppError(404, "QR_REGISTRATION_NOT_FOUND", "This QR pass is not valid for this event");
  return registration;
};

const loadRegistration = async (db, eventId, registrationId) => db.eventRegistration.findFirst({
    where: { registrationId, eventId },
    select: {
      registrationId: true,
      participantDisplayName: true,
      queueNumber: true,
      registrationStatus: true,
      participant: {
        select: {
          nric: true,
          nricMasked: true,
          firstName: true,
          lastName: true,
          dateOfBirth: true,
          gender: true,
        },
      },
      routeSteps: { select: routeStepSelect, orderBy: { position: "asc" } },
      screeningResults: { select: resultSelect },
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
          eyeHealthObservations: true,
          signatureSha256: true,
          signedPayloadHash: true,
          signedAt: true,
          reviewedAt: true,
          reviewer: { select: { fullName: true } },
          signatureSigner: { select: { fullName: true } },
          referrals: {
            orderBy: { revisionNumber: "desc" },
            take: 1,
            select: {
              referralId: true,
              revisionNumber: true,
              supersedesReferralId: true,
              destinationName: true,
              reason: true,
              instructions: true,
              urgency: true,
              status: true,
              signedAt: true,
              documentArtifacts: {
                orderBy: { generatedAt: "desc" },
                take: 1,
                select: { documentId: true, version: true, generatedAt: true },
              },
              notificationDeliveries: {
                orderBy: { createdAt: "desc" },
                take: 1,
                select: { id: true, status: true, recipient: true, providerMessageId: true, failureReason: true, sentAt: true, deliveredAt: true, attemptCount: true },
              },
            },
          },
        },
      },
    },
  });

const normalizeEyeHealthObservations = (value) => {
  if (!value) return null;
  return {
    cataractRisk: value.cataractRisk,
    glaucomaRisk: value.glaucomaRisk,
    symptomsNoted: value.symptomsNoted,
    symptomSummary: value.symptomsNoted ? (value.symptomSummary || null) : null,
    observations: value.observations,
    deviceFindings: value.deviceFindings ? value.deviceFindings : null,
  };
};

const serializeReview = (review) => review ? {
  reviewId: review.reviewId,
  version: review.version,
  outcome: review.outcome,
  urgency: review.urgency,
  clinicalSummary: review.clinicalSummary,
  recommendations: review.recommendations,
  eyeHealthObservations: review.eyeHealthObservations || null,
  reviewedAt: review.reviewedAt,
  reviewedByName: review.reviewer.fullName,
  signatureSignerName: review.signatureSigner?.fullName || review.reviewer.fullName,
  signatureSha256: review.signatureSha256,
  signedPayloadHash: review.signedPayloadHash,
  signedAt: review.signedAt,
  referral: serializeReferral(review.referrals[0]),
} : null;

const serializeReferral = (referral) => referral ? {
  referralId: referral.referralId,
  revisionNumber: referral.revisionNumber || 1,
  supersedesReferralId: referral.supersedesReferralId || null,
  destinationName: referral.destinationName,
  reason: referral.reason,
  instructions: referral.instructions,
  urgency: referral.urgency,
  status: referral.status,
  signedAt: referral.signedAt,
  document: referral.documentArtifacts?.[0] || null,
  delivery: referral.notificationDeliveries?.[0] ? {
    deliveryId: referral.notificationDeliveries[0].id,
    status: referral.notificationDeliveries[0].status,
    recipient: referral.notificationDeliveries[0].recipient,
    providerMessageId: referral.notificationDeliveries[0].providerMessageId,
    failureReason: referral.notificationDeliveries[0].failureReason,
    sentAt: referral.notificationDeliveries[0].sentAt,
    deliveredAt: referral.notificationDeliveries[0].deliveredAt,
    attemptCount: referral.notificationDeliveries[0].attemptCount,
  } : null,
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
      maskedNric: maskNric(registration.participant.nric) || registration.participant.nricMasked || "Not recorded",
      dateOfBirth: registration.participant.dateOfBirth.toISOString().slice(0, 10),
      gender: registration.participant.gender,
    },
    stations: stations.map((station) => ({
      stationId: station.stationId,
      stationName: station.stationName,
      stationType: station.stationType,
      stationOrder: station.stationOrder,
      fieldSchemaSnapshot: resolveCompatibleFieldSchema(
        station.stationType,
        station.fieldSchemaSnapshot,
      ),
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
  const event = await requireReviewerAccess(prisma, eventId, user);
  const registration = await loadRegistration(prisma, eventId, registrationId);
  if (!registration) throw new AppError(404, "REGISTRATION_NOT_FOUND", "Registration not found");
  const stations = routeStations(registration);
  return buildDetail(event, stations, registration);
};

const decisionUrgency = (decision) => {
  if (decision.outcome === "URGENT_ESCALATION") return "EMERGENCY";
  if (decision.outcome === "REFER") return decision.urgency;
  return "ROUTINE";
};

const reviewSignedPayloadHash = ({ eventId, registrationId, reviewId, userId, decision, urgency, eyeHealthObservations, signedAt }) => crypto
  .createHash("sha256")
  .update(JSON.stringify({
    eventId,
    registrationId,
    reviewId,
    version: 1,
    reviewedByUserId: userId,
    outcome: decision.outcome,
    urgency,
    contextVersion: decision.contextVersion,
    clinicalSummary: decision.clinicalSummary,
    recommendations: decision.recommendations || null,
    eyeHealthObservations,
    referral: decision.referral || null,
    signatureSha256: decision.signatureSha256.toLowerCase(),
    signedAt: signedAt.toISOString(),
  }))
  .digest("hex");

const recordDecision = async (eventId, registrationId, decision, user, ipAddress) => {
  const userId = user.userId;
  const signature = {
    signatureObjectKey: decision.signatureObjectKey,
    signatureSha256: decision.signatureSha256,
    signatureMimeType: decision.signatureMimeType,
  };
  await loadVerifiedSignature(signature, userId, eventId, "REVIEW_DECISION");
  const reviewId = crypto.randomUUID();
  const signedAt = new Date();
  const urgency = decisionUrgency(decision);
  const eyeHealthObservations = normalizeEyeHealthObservations(decision.eyeHealthObservations);
  const signedPayloadHash = reviewSignedPayloadHash({
    eventId,
    registrationId,
    reviewId,
    userId,
    decision,
    urgency,
    eyeHealthObservations,
    signedAt,
  });
  try {
    return await prisma.$transaction(async (tx) => {
      await requireReviewerAccess(tx, eventId, user);
      const registration = await loadRegistration(tx, eventId, registrationId);
      if (!registration) throw new AppError(404, "REGISTRATION_NOT_FOUND", "Registration not found");
      if (registration.reviews[0]) {
        throw new AppError(409, "REVIEW_ALREADY_RECORDED", "A clinical review has already been recorded");
      }

      const stations = routeStations(registration);
      const readiness = reviewReadiness(stations, registration.screeningResults);
      if (!readiness.ready || ["COMPLETED", "CANCELLED"].includes(registration.registrationStatus)) {
        throw new AppError(409, "REVIEW_NOT_READY", "This registration is not ready for clinical review");
      }
      if (contextVersion(stations, registration.screeningResults) !== decision.contextVersion) {
        throw new AppError(409, "SCREENING_RESULTS_CHANGED", "Screening results changed; reassess before deciding");
      }
      const incompleteUrgentRoute = assertReviewOutcomeAllowed(readiness, decision.outcome);

      await consumeSignatureArtifact(
        tx,
        signature,
        userId,
        eventId,
        "REVIEW_DECISION",
        registrationId,
        signedAt,
      );
      const review = await tx.review.create({
        data: {
          reviewId,
          registrationId,
          version: 1,
          reviewedByUserId: userId,
          parentReviewId: null,
          outcome: decision.outcome,
          urgency,
          clinicalSummary: decision.clinicalSummary,
          recommendations: decision.recommendations || null,
          eyeHealthObservations,
          signatureObjectKey: signature.signatureObjectKey,
          signatureSha256: signature.signatureSha256.toLowerCase(),
          signatureMimeType: signature.signatureMimeType,
          signatureSignerUserId: userId,
          signedPayloadHash,
          signedAt,
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

      const cancelledQueue = incompleteUrgentRoute
        ? await stopRouteForUrgentReview(tx, registrationId)
        : { count: 0 };

      const auditBase = {
        eventId,
        registrationId,
        reviewId: review.reviewId,
        outcome: review.outcome,
        urgency: review.urgency,
        eyeHealthRecorded: Boolean(eyeHealthObservations),
        signaturePurpose: "REVIEW_DECISION",
        signatureSha256: review.signatureSha256,
        signedPayloadHash: review.signedPayloadHash,
        signedAt: review.signedAt,
        routeStoppedForUrgentReview: incompleteUrgentRoute,
        cancelledActiveQueueCount: cancelledQueue.count,
        stoppedUnfinishedStationIds: incompleteUrgentRoute
          ? unfinishedRouteStationIds(registration.routeSteps)
          : [],
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
          eyeHealthObservations: review.eyeHealthObservations,
          signatureSignerName: user.fullName || null,
          signatureSha256: review.signatureSha256,
          signedPayloadHash: review.signedPayloadHash,
          signedAt: review.signedAt,
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
  resolveScannedRegistration,
  getDetail,
  recordDecision,
  reviewReadiness,
  compareQueueItems,
  contextVersion,
  requireReviewerAccess,
  reviewSignedPayloadHash,
  assertReviewOutcomeAllowed,
  routeStations,
  stopRouteForUrgentReview,
  unfinishedRouteStationIds,
};
