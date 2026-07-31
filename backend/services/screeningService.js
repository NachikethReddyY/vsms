const crypto = require("crypto");
const prisma = require("../prisma/prismaClient");
const AppError = require("../errors/AppError");

const VA_RULE_VERSION = "VSMS-VA-1.0";
const REF_RULE_VERSION = "VSMS-REF-1.0";
const CV_RULE_VERSION = "VSMS-CV-1.0";
const FLAG_RANK = { NORMAL: 0, REVIEW: 1, REFER: 2, URGENT: 3 };

const worstFlag = (reasons) => reasons.reduce((worst, item) => (
  FLAG_RANK[item.flag] > FLAG_RANK[worst] ? item.flag : worst
), "NORMAL");

const formatEyeLabel = (eye, distanceMetres) => {
  if (eye.kind === "FRACTION") return `${distanceMetres}/${eye.denominator}`;
  return eye.code;
};

const formatDiopter = (value) => {
  const signed = value > 0 ? `+${value.toFixed(2)}` : value.toFixed(2);
  return signed;
};

const evaluateVisualAcuity = (resultData) => {
  const reasons = [];
  for (const [label, eye] of [["OD", resultData.od], ["OS", resultData.os]]) {
    if (eye.kind === "EXCEPTION") {
      if (eye.code === "NLP" || eye.code === "HM") reasons.push({ flag: "URGENT", reason: `${label} ${eye.code}` });
      else if (eye.code === "CF" || eye.code === "LP") reasons.push({ flag: "REFER", reason: `${label} ${eye.code}` });
      else reasons.push({ flag: "REVIEW", reason: `${label} not testable` });
      continue;
    }
    const scaled = eye.denominator * (6 / resultData.chartDistanceMetres);
    if (scaled > 18) reasons.push({ flag: "REFER", reason: `${label} ${formatEyeLabel(eye, resultData.chartDistanceMetres)}` });
    else if (scaled > 12) reasons.push({ flag: "REVIEW", reason: `${label} ${formatEyeLabel(eye, resultData.chartDistanceMetres)}` });
  }

  const overallFlag = worstFlag(reasons);
  return {
    ruleVersion: VA_RULE_VERSION,
    overallFlag,
    isFlagged: overallFlag !== "NORMAL",
    flagSummary: reasons.length
      ? reasons.map((item) => item.reason).join("; ")
      : `VA OD ${formatEyeLabel(resultData.od, resultData.chartDistanceMetres)} / OS ${formatEyeLabel(resultData.os, resultData.chartDistanceMetres)}`,
    reasons,
  };
};

const evaluateRefraction = (resultData) => {
  const reasons = [];

  if (resultData.measurementStatus === "UNABLE_TO_MEASURE") {
    reasons.push({ flag: "REVIEW", reason: "Unable to measure refraction" });
  } else if (resultData.measurementStatus === "REPEAT_REQUIRED") {
    reasons.push({ flag: "REVIEW", reason: "Refraction repeat required" });
  } else {
    for (const [label, eye] of [["OD", resultData.od], ["OS", resultData.os]]) {
      if (eye.sphere < -6 || eye.sphere > 5) {
        reasons.push({ flag: "REFER", reason: `${label} SPH ${formatDiopter(eye.sphere)} outside -6.00 to +5.00` });
      }
      if (Math.abs(eye.cylinder) > 3) {
        reasons.push({ flag: "REVIEW", reason: `${label} high astigmatism CYL ${formatDiopter(eye.cylinder)}` });
      }
    }
    const sphDiff = Math.abs(resultData.od.sphere - resultData.os.sphere);
    if (sphDiff >= 2) {
      reasons.push({ flag: "REVIEW", reason: `Anisometropia SPH difference ${sphDiff.toFixed(2)} D` });
    }
  }

  const overallFlag = worstFlag(reasons);
  const summaryParts = resultData.measurementStatus === "COMPLETED"
    ? [
      `OD ${formatDiopter(resultData.od.sphere)}/${formatDiopter(resultData.od.cylinder)} x ${resultData.od.axis ?? "—"}`,
      `OS ${formatDiopter(resultData.os.sphere)}/${formatDiopter(resultData.os.cylinder)} x ${resultData.os.axis ?? "—"}`,
    ]
    : [resultData.measurementStatus.replaceAll("_", " ").toLowerCase()];

  return {
    ruleVersion: REF_RULE_VERSION,
    overallFlag,
    isFlagged: overallFlag !== "NORMAL",
    flagSummary: reasons.length ? reasons.map((item) => item.reason).join("; ") : summaryParts.join(" / "),
    reasons,
  };
};

const colourVisionPassThreshold = (platesPresented) => Math.max(1, platesPresented - 1);

const evaluateColourVision = (resultData) => {
  const reasons = [];
  const threshold = colourVisionPassThreshold(resultData.platesPresented);
  const odPass = resultData.odCorrect >= threshold;
  const osPass = resultData.osCorrect >= threshold;
  const scoreGap = Math.abs(resultData.odCorrect - resultData.osCorrect);

  if ((odPass && !osPass) || (!odPass && osPass) || scoreGap >= 3) {
    reasons.push({
      flag: "URGENT",
      reason: `Critical colour-vision asymmetry OD ${resultData.odCorrect}/${resultData.platesPresented} vs OS ${resultData.osCorrect}/${resultData.platesPresented}`,
    });
  } else if (!odPass || !osPass) {
    reasons.push({
      flag: "REVIEW",
      reason: `Colour vision below ${threshold}/${resultData.platesPresented} (OD ${resultData.odCorrect}, OS ${resultData.osCorrect})`,
    });
  }

  const overallFlag = worstFlag(reasons);
  return {
    ruleVersion: CV_RULE_VERSION,
    overallFlag,
    isFlagged: overallFlag !== "NORMAL",
    flagSummary: reasons.length
      ? reasons.map((item) => item.reason).join("; ")
      : `Ishihara OD ${resultData.odCorrect}/${resultData.platesPresented} / OS ${resultData.osCorrect}/${resultData.platesPresented}`,
    reasons,
  };
};

const assertCanScreen = async (eventId, user) => {
  if (user.systemRole === "ADMIN" || user.systemRole === "EVENT_MANAGER") return;
  const assignment = await prisma.staffAssignment.findFirst({
    where: {
      userId: user.userId,
      status: { in: ["ASSIGNED", "CONFIRMED"] },
      assignmentRole: { in: ["SCREENER", "SUPPORT", "REGISTRATION"] },
      shift: { eventId, status: "ACTIVE" },
    },
    select: { id: true },
  });
  if (!assignment) {
    throw new AppError(403, "FORBIDDEN", "You are not assigned to screen this event");
  }
};

const assertStation = async (eventId, stationId, stationType, label) => {
  const station = await prisma.station.findFirst({
    where: { stationId, eventId, isActive: true, stationType },
  });
  if (!station) throw new AppError(404, "STATION_NOT_FOUND", `${label} station not found`);
  return station;
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
      registrationStatus: { in: ["CHECKED_IN", "SIGNED_UP"] },
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
      status: row.registrationStatus,
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
    status: registration.registrationStatus,
    passToken: registration.passToken,
  };
};

const previewStationResult = async (eventId, stationId, stationType, label, evaluate, body, user) => {
  await assertCanScreen(eventId, user);
  await assertStation(eventId, stationId, stationType, label);
  return evaluate(body.resultData);
};

const saveStationResult = async ({
  eventId,
  stationId,
  stationType,
  label,
  ruleVersion,
  evaluate,
  body,
  user,
}) => {
  await assertCanScreen(eventId, user);
  await assertStation(eventId, stationId, stationType, label);

  const evaluation = evaluate(body.resultData);
  if (evaluation.isFlagged && body.acknowledged !== true) {
    throw new AppError(
      400,
      "ACKNOWLEDGEMENT_REQUIRED",
      `Flagged result (${evaluation.overallFlag}) must be acknowledged before save`,
      { evaluation },
    );
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const registration = await tx.eventRegistration.findFirst({
        where: { registrationId: body.registrationId, eventId },
      });
      if (!registration) throw new AppError(404, "REGISTRATION_NOT_FOUND", "Registration not found for this event");
      if (["COMPLETED", "CANCELLED"].includes(registration.registrationStatus)) {
        throw new AppError(409, "REGISTRATION_NOT_SCREENABLE", "Completed or cancelled registrations cannot be changed");
      }

      const existingByKey = await tx.screeningResult.findUnique({
        where: { idempotencyKey: body.idempotencyKey },
      });
      if (existingByKey) return { result: existingByKey, created: false };

      const payload = {
        recordedByUserId: user.userId,
        screeningType: stationType,
        resultData: body.resultData,
        overallFlag: evaluation.overallFlag,
        isFlagged: evaluation.isFlagged,
        flagSummary: evaluation.flagSummary,
        ruleVersion,
        acknowledgedAt: evaluation.isFlagged ? new Date() : null,
        idempotencyKey: body.idempotencyKey,
      };

      const result = await tx.screeningResult.upsert({
        where: {
          registrationId_stationId: {
            registrationId: body.registrationId,
            stationId,
          },
        },
        update: payload,
        create: {
          registrationId: body.registrationId,
          stationId,
          ...payload,
        },
      });
      return { result: { ...result, evaluation }, created: true };
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    if (error.code === "P2002") {
      const raced = await prisma.screeningResult.findUnique({ where: { idempotencyKey: body.idempotencyKey } });
      if (raced) return { result: raced, created: false };
    }
    if (error.code === "P2034") {
      const registration = await prisma.eventRegistration.findUnique({ where: { registrationId: body.registrationId } });
      if (registration && ["COMPLETED", "CANCELLED"].includes(registration.registrationStatus)) {
        throw new AppError(409, "REGISTRATION_NOT_SCREENABLE", "Completed or cancelled registrations cannot be changed");
      }
      throw new AppError(409, "SCREENING_WRITE_CONFLICT", "Screening results changed concurrently; retry with the latest registration");
    }
    throw error;
  }
};

const previewVisualAcuity = (eventId, stationId, body, user) => previewStationResult(
  eventId, stationId, "VISUAL_ACUITY", "Visual acuity", evaluateVisualAcuity, body, user,
);

const saveVisualAcuity = (eventId, stationId, body, user) => saveStationResult({
  eventId,
  stationId,
  stationType: "VISUAL_ACUITY",
  label: "Visual acuity",
  ruleVersion: VA_RULE_VERSION,
  evaluate: evaluateVisualAcuity,
  body,
  user,
});

const previewRefraction = (eventId, stationId, body, user) => previewStationResult(
  eventId, stationId, "REFRACTION", "Refraction", evaluateRefraction, body, user,
);

const saveRefraction = (eventId, stationId, body, user) => saveStationResult({
  eventId,
  stationId,
  stationType: "REFRACTION",
  label: "Refraction",
  ruleVersion: REF_RULE_VERSION,
  evaluate: evaluateRefraction,
  body,
  user,
});

const previewColourVision = (eventId, stationId, body, user) => previewStationResult(
  eventId, stationId, "COLOUR_VISION", "Colour vision", evaluateColourVision, body, user,
);

const saveColourVision = (eventId, stationId, body, user) => saveStationResult({
  eventId,
  stationId,
  stationType: "COLOUR_VISION",
  label: "Colour vision",
  ruleVersion: CV_RULE_VERSION,
  evaluate: evaluateColourVision,
  body,
  user,
});

const ensureDemoStations = async (eventId) => {
  const desired = [
    { stationName: "Visual Acuity", stationType: "VISUAL_ACUITY", stationOrder: 1 },
    { stationName: "Refraction", stationType: "REFRACTION", stationOrder: 2 },
    { stationName: "Colour Vision", stationType: "COLOUR_VISION", stationOrder: 3 },
  ];
  const existing = await prisma.station.findMany({
    where: { eventId },
    select: { stationType: true, stationOrder: true },
  });
  const present = new Set(existing.map((row) => row.stationType));
  const usedOrders = new Set(existing.map((row) => row.stationOrder));
  const missing = [];
  for (const station of desired) {
    if (present.has(station.stationType)) continue;
    let order = station.stationOrder;
    while (usedOrders.has(order)) order += 1;
    usedOrders.add(order);
    missing.push({
      stationId: crypto.randomUUID(),
      eventId,
      stationName: station.stationName,
      stationType: station.stationType,
      stationOrder: order,
      updatedAt: new Date(),
    });
  }
  if (missing.length) await prisma.station.createMany({ data: missing });
};

module.exports = {
  VA_RULE_VERSION,
  REF_RULE_VERSION,
  CV_RULE_VERSION,
  listStations,
  listQueue,
  resolveParticipant,
  previewVisualAcuity,
  saveVisualAcuity,
  previewRefraction,
  saveRefraction,
  previewColourVision,
  saveColourVision,
  ensureDemoStations,
  evaluateVisualAcuity,
  evaluateRefraction,
  evaluateColourVision,
};
