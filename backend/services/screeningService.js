const crypto = require("crypto");
const prisma = require("../prisma/prismaClient");
const AppError = require("../errors/AppError");

const FLAG_RANK = { NORMAL: 0, REVIEW: 1, REFER: 2, URGENT: 3 };

const formatEye = (eye) => {
  if (eye.kind === "FRACTION") return `6/${eye.denominator}`;
  return eye.code;
};

const evaluateVisualAcuity = (resultData) => {
  const flags = [];
  for (const [label, eye] of [["OD", resultData.od], ["OS", resultData.os]]) {
    if (eye.kind === "EXCEPTION") {
      if (eye.code === "NLP" || eye.code === "HM") flags.push({ flag: "URGENT", reason: `${label} ${eye.code}` });
      else if (eye.code === "CF" || eye.code === "LP") flags.push({ flag: "REFER", reason: `${label} ${eye.code}` });
      else flags.push({ flag: "REVIEW", reason: `${label} not testable` });
      continue;
    }
    const scaled = eye.denominator * (6 / resultData.chartDistanceMetres);
    if (scaled > 18) flags.push({ flag: "REFER", reason: `${label} ${resultData.chartDistanceMetres}/${eye.denominator}` });
    else if (scaled > 12) flags.push({ flag: "REVIEW", reason: `${label} ${resultData.chartDistanceMetres}/${eye.denominator}` });
  }

  const overallFlag = flags.reduce((worst, item) => (
    FLAG_RANK[item.flag] > FLAG_RANK[worst] ? item.flag : worst
  ), "NORMAL");

  return {
    overallFlag,
    isFlagged: overallFlag !== "NORMAL",
    flagSummary: flags.length
      ? flags.map((item) => item.reason).join("; ")
      : `VA OD ${formatEye(resultData.od)} / OS ${formatEye(resultData.os)}`,
  };
};

const assertCanScreen = async (eventId, user) => {
  if (user.systemRole === "ADMIN" || user.systemRole === "EVENT_MANAGER") return;
  const assignment = await prisma.staffAssignment.findFirst({
    where: {
      userId: user.userId,
      status: { in: ["ASSIGNED", "CONFIRMED"] },
      assignmentRole: { in: ["SCREENER", "SUPPORT", "REGISTRATION"] },
      shift: { eventId },
    },
    select: { staffAssignmentId: true },
  });
  if (!assignment) {
    throw new AppError(403, "FORBIDDEN", "You are not assigned to screen this event");
  }
};

const listStations = async (eventId, user) => {
  await assertCanScreen(eventId, user);
  const event = await prisma.event.findUnique({
    where: { eventId },
    select: { eventId: true, name: true, status: true, venue: true },
  });
  if (!event) throw new AppError(404, "EVENT_NOT_FOUND", "Event not found");

  const stations = await prisma.station.findMany({
    where: { eventId, isActive: true },
    orderBy: { stationOrder: "asc" },
  });

  return { event, stations };
};

const listQueue = async (eventId, stationId, user) => {
  await assertCanScreen(eventId, user);
  const station = await prisma.station.findFirst({ where: { stationId, eventId, isActive: true } });
  if (!station) throw new AppError(404, "STATION_NOT_FOUND", "Station not found for this event");

  const registrations = await prisma.eventRegistration.findMany({
    where: {
      eventId,
      status: { in: ["CHECKED_IN", "SIGNED_UP"] },
    },
    orderBy: [{ queueNumber: "asc" }, { createdAt: "asc" }],
    include: {
      screeningResults: {
        where: { stationId },
        select: {
          resultId: true,
          overallFlag: true,
          isFlagged: true,
          createdAt: true,
        },
      },
    },
  });

  return {
    station,
    registrations: registrations.map((row) => ({
      registrationId: row.registrationId,
      participantDisplayName: row.participantDisplayName || "Unnamed participant",
      queueNumber: row.queueNumber,
      status: row.status,
      passToken: row.passToken,
      existingResult: row.screeningResults[0] || null,
    })),
  };
};

const resolveParticipant = async (eventId, query, user) => {
  await assertCanScreen(eventId, user);
  const registration = await prisma.eventRegistration.findFirst({
    where: {
      eventId,
      OR: [
        query.registrationId ? { registrationId: query.registrationId } : undefined,
        query.passToken ? { passToken: query.passToken } : undefined,
      ].filter(Boolean),
    },
  });
  if (!registration) throw new AppError(404, "REGISTRATION_NOT_FOUND", "No registration matched that pass or id");

  return {
    registrationId: registration.registrationId,
    participantDisplayName: registration.participantDisplayName || "Unnamed participant",
    queueNumber: registration.queueNumber,
    status: registration.status,
    passToken: registration.passToken,
  };
};

const saveVisualAcuity = async (eventId, stationId, body, user) => {
  await assertCanScreen(eventId, user);
  const station = await prisma.station.findFirst({
    where: { stationId, eventId, isActive: true, stationType: "VISUAL_ACUITY" },
  });
  if (!station) throw new AppError(404, "STATION_NOT_FOUND", "Visual acuity station not found");

  const registration = await prisma.eventRegistration.findFirst({
    where: { registrationId: body.registrationId, eventId },
  });
  if (!registration) throw new AppError(404, "REGISTRATION_NOT_FOUND", "Registration not found for this event");
  if (registration.status === "CANCELLED") {
    throw new AppError(409, "REGISTRATION_CANCELLED", "Cannot screen a cancelled registration");
  }

  const evaluation = evaluateVisualAcuity(body.resultData);
  if (evaluation.isFlagged && !body.acknowledged) {
    throw new AppError(400, "ACKNOWLEDGEMENT_REQUIRED", "Flagged results must be acknowledged before save");
  }

  const existingByKey = await prisma.screeningResult.findUnique({
    where: { idempotencyKey: body.idempotencyKey },
  });
  if (existingByKey) return { result: existingByKey, created: false };

  try {
    const result = await prisma.screeningResult.upsert({
      where: {
        registrationId_stationId: {
          registrationId: body.registrationId,
          stationId,
        },
      },
      update: {
        recordedByUserId: user.userId,
        screeningType: "VISUAL_ACUITY",
        resultData: body.resultData,
        overallFlag: evaluation.overallFlag,
        isFlagged: evaluation.isFlagged,
        flagSummary: evaluation.flagSummary,
        ruleVersion: "VSMS-VA-1.0",
        acknowledgedAt: evaluation.isFlagged ? new Date() : null,
        idempotencyKey: body.idempotencyKey,
      },
      create: {
        registrationId: body.registrationId,
        stationId,
        recordedByUserId: user.userId,
        screeningType: "VISUAL_ACUITY",
        resultData: body.resultData,
        overallFlag: evaluation.overallFlag,
        isFlagged: evaluation.isFlagged,
        flagSummary: evaluation.flagSummary,
        ruleVersion: "VSMS-VA-1.0",
        acknowledgedAt: evaluation.isFlagged ? new Date() : null,
        idempotencyKey: body.idempotencyKey,
      },
    });
    return { result, created: true };
  } catch (error) {
    if (error.code === "P2002") {
      const raced = await prisma.screeningResult.findUnique({ where: { idempotencyKey: body.idempotencyKey } });
      if (raced) return { result: raced, created: false };
    }
    throw error;
  }
};

const ensureDemoStations = async (eventId) => {
  const existing = await prisma.station.count({ where: { eventId } });
  if (existing > 0) return;
  await prisma.station.createMany({
    data: [
      { stationId: crypto.randomUUID(), eventId, stationName: "Visual Acuity", stationType: "VISUAL_ACUITY", stationOrder: 1, updatedAt: new Date() },
      { stationId: crypto.randomUUID(), eventId, stationName: "Refraction", stationType: "REFRACTION", stationOrder: 2, updatedAt: new Date() },
      { stationId: crypto.randomUUID(), eventId, stationName: "Colour Vision", stationType: "COLOUR_VISION", stationOrder: 3, updatedAt: new Date() },
    ],
  });
};

module.exports = {
  listStations,
  listQueue,
  resolveParticipant,
  saveVisualAcuity,
  ensureDemoStations,
  evaluateVisualAcuity,
};
