const crypto = require("crypto");
const prisma = require("../prisma/prismaClient");
const AppError = require("../errors/AppError");
const qrService = require("./qrService");

const VA_RULE_VERSION = "VSMS-VA-1.0";
const REF_RULE_VERSION = "VSMS-REF-1.0";
const CV_RULE_VERSION = "VSMS-CV-1.0";
const FLAG_RANK = { NORMAL: 0, REVIEW: 1, REFER: 2, URGENT: 3 };

const canonicalJson = (value) => {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalJson(value[key])]));
  }
  return value;
};

const screeningRequestFingerprint = ({ eventId, stationId, registrationId, userId, body }) => crypto
  .createHash("sha256")
  .update(JSON.stringify(canonicalJson({
    eventId,
    stationId,
    registrationId,
    userId,
    payload: { acknowledged: body.acknowledged, resultData: body.resultData },
  })))
  .digest("hex");

const replayReceipt = (receipt, { eventId, stationId, registrationId, userId, fingerprint }) => {
  if (
    receipt.actorUserId !== userId
    || receipt.eventId !== eventId
    || receipt.registrationId !== registrationId
    || receipt.stationId !== stationId
    || receipt.requestFingerprint !== fingerprint
  ) {
    throw new AppError(409, "IDEMPOTENCY_KEY_REUSED", "Idempotency key was already used for a different screening request");
  }
  return { result: receipt.resultSnapshot, created: false };
};

const immutableSnapshot = (value) => JSON.parse(JSON.stringify(value));

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

const SCREENING_STATION_TYPES = ["VISUAL_ACUITY", "REFRACTION", "COLOUR_VISION"];

const assertCanScreen = async (eventId, user, _stationId) => {
  if (user.roles?.includes("ADMINISTRATOR") || !user.roles?.includes("SCREENER")) {
    throw new AppError(403, "SCREENER_ROLE_REQUIRED", "A screener account role is required");
  }
  const event = await prisma.event.findUnique({
    where: { eventId },
    select: { eventId: true, name: true, status: true, venue: true, endsAt: true },
  });
  if (!event) throw new AppError(404, "EVENT_NOT_FOUND", "Event not found");
  if (event.status !== "IN_PROGRESS") {
    throw new AppError(409, "EVENT_NOT_IN_PROGRESS", "Screening is available only while the event is in progress");
  }
  const now = new Date();
  // Any active SCREENER assignment on this in-progress event unlocks the screening route
  // (VA → refraction → colour vision). Once Admin has started the event and the shift is
  // ACTIVE, do not also gate on wall-clock shift hours — overtime / stale seed windows
  // should not block screening.
  const assignment = await prisma.staffAssignment.findFirst({
    where: {
      eventId,
      userId: user.userId,
      status: { in: ["ASSIGNED", "CONFIRMED"] },
      assignmentRole: "SCREENER",
      shift: { eventId, status: "ACTIVE" },
    },
    select: { id: true },
  });
  if (!assignment) {
    const rostered = await prisma.staffAssignment.findFirst({
      where: {
        eventId,
        userId: user.userId,
        status: { in: ["ASSIGNED", "CONFIRMED"] },
        assignmentRole: "SCREENER",
      },
      select: { id: true, shift: { select: { status: true, startsAt: true, endsAt: true } } },
    });
    if (rostered && rostered.shift.status !== "ACTIVE") {
      throw new AppError(
        403,
        "SHIFT_NOT_ACTIVE",
        "You are rostered, but your screening shift is not active right now",
      );
    }
    throw new AppError(403, "FORBIDDEN", "You are not assigned to screen this event");
  }
  return event;
};

const assertStation = async (eventId, stationId, stationType, label) => {
  const station = await prisma.station.findFirst({
    where: { stationId, eventId, isActive: true, stationType },
  });
  if (!station) throw new AppError(404, "STATION_NOT_FOUND", `${label} station not found`);
  return station;
};

const listStations = async (eventId, user) => {
  const event = await assertCanScreen(eventId, user);

  const assignments = await prisma.staffAssignment.findMany({
    where: {
      eventId,
      userId: user.userId,
      status: { in: ["ASSIGNED", "CONFIRMED"] },
      assignmentRole: "SCREENER",
      stationId: { not: null },
      shift: { eventId, status: "ACTIVE" },
    },
    select: { stationId: true, shift: { select: { endsAt: true } } },
  });

  const stations = await prisma.station.findMany({
    where: {
      eventId,
      isActive: true,
      stationType: { in: SCREENING_STATION_TYPES },
    },
    orderBy: { stationOrder: "asc" },
  });

  const assignmentEndsAt = assignments.reduce((latest, assignment) => (
    !latest || assignment.shift.endsAt > latest ? assignment.shift.endsAt : latest
  ), null);

  return {
    event,
    stations: stations.map((station) => {
      if (!event.endsAt || !assignmentEndsAt) return station;
      return {
        ...station,
        // Offline access may never outlive either the live event or this user's active shift.
        offlineAccessExpiresAt: new Date(Math.min(event.endsAt.getTime(), assignmentEndsAt.getTime())).toISOString(),
      };
    }),
  };
};

const listQueue = async (eventId, stationId, user) => {
  await assertCanScreen(eventId, user, stationId);
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

const hashQrToken = (token) => crypto.createHash("sha256").update(token).digest("hex");

const resolveParticipant = async (eventId, query, user) => {
  await assertCanScreen(eventId, user);

  const orClauses = [
    query.registrationId ? { registrationId: query.registrationId } : undefined,
    query.passToken ? { passToken: query.passToken } : undefined,
  ].filter(Boolean);

  let registration = orClauses.length
    ? await prisma.eventRegistration.findFirst({
      where: { eventId, OR: orClauses },
    })
    : null;

  // Prefer registration.passToken first (keeps VSMS-DEMO-QR-001 working), then QRCodePass.token.
  const qrLookupToken = query.qrToken || (!registration ? query.passToken : null);
  if (!registration && qrLookupToken) {
    const qr = await prisma.qRCodePass.findFirst({
      where: {
        OR: [
          { token: qrLookupToken },
          { tokenHash: hashQrToken(qrLookupToken) },
        ],
        registration: { eventId },
      },
      include: { registration: true },
    });
    registration = qr?.registration || null;
  }

  if (!registration) {
    throw new AppError(404, "REGISTRATION_NOT_FOUND", "No registration matched that pass, QR token, or id");
  }

  return {
    registrationId: registration.registrationId,
    participantDisplayName: registration.participantDisplayName || "Unnamed participant",
    queueNumber: registration.queueNumber,
    status: registration.registrationStatus,
    passToken: registration.passToken,
  };
};

const getPassDisplay = async (eventId, registrationId, user) => {
  await assertCanScreen(eventId, user);
  const registration = await prisma.eventRegistration.findFirst({
    where: { eventId, registrationId },
    select: { registrationId: true },
  });
  if (!registration) throw new AppError(404, "REGISTRATION_NOT_FOUND", "Registration was not found for this event");
  return qrService.renderActivePassForRegistration(registrationId);
};

const previewStationResult = async (eventId, stationId, stationType, label, evaluate, body, user) => {
  await assertCanScreen(eventId, user, stationId);
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
  await assertCanScreen(eventId, user, stationId);
  await assertStation(eventId, stationId, stationType, label);
  const fingerprint = screeningRequestFingerprint({ eventId, stationId, registrationId: body.registrationId, userId: user.userId, body });
  const replayContext = {
    eventId,
    stationId,
    registrationId: body.registrationId,
    userId: user.userId,
    fingerprint,
  };

  try {
    return await prisma.$transaction(async (tx) => {
      const existingByKey = await tx.screeningRequestLedger.findUnique({
        where: { idempotencyKey: body.idempotencyKey },
      });
      if (existingByKey) return replayReceipt(existingByKey, replayContext);

      const registration = await tx.eventRegistration.findFirst({
        where: { registrationId: body.registrationId, eventId },
      });
      if (!registration) throw new AppError(404, "REGISTRATION_NOT_FOUND", "Registration not found for this event");
      if (["COMPLETED", "CANCELLED"].includes(registration.registrationStatus)) {
        throw new AppError(409, "REGISTRATION_NOT_SCREENABLE", "Completed or cancelled registrations cannot be changed");
      }

      const evaluation = evaluate(body.resultData);
      if (evaluation.isFlagged && body.acknowledged !== true) {
        throw new AppError(
          400,
          "ACKNOWLEDGEMENT_REQUIRED",
          `Flagged result (${evaluation.overallFlag}) must be acknowledged before save`,
          { evaluation },
        );
      }

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
        requestFingerprint: fingerprint,
      };

      const result = await tx.screeningResult.upsert({
        where: {
          registrationId_stationId: {
            registrationId: body.registrationId,
            stationId,
          },
        },
        update: { ...payload, version: { increment: 1 } },
        create: {
          registrationId: body.registrationId,
          stationId,
          version: 1,
          ...payload,
        },
      });
      const responseResult = { ...result, evaluation };
      await tx.screeningRequestLedger.create({
        data: {
          idempotencyKey: body.idempotencyKey,
          requestFingerprint: fingerprint,
          actorUserId: user.userId,
          eventId,
          registrationId: body.registrationId,
          stationId,
          resultId: result.resultId,
          resultVersion: result.version,
          resultSnapshot: immutableSnapshot(responseResult),
        },
      });
      return { result: responseResult, created: true };
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    if (error.code === "P2002") {
      const raced = await prisma.screeningRequestLedger.findUnique({ where: { idempotencyKey: body.idempotencyKey } });
      if (raced) return replayReceipt(raced, replayContext);
    }
    if (error.code === "P2034") {
      const raced = await prisma.screeningRequestLedger.findUnique({ where: { idempotencyKey: body.idempotencyKey } });
      if (raced) return replayReceipt(raced, replayContext);
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
  getPassDisplay,
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
  screeningRequestFingerprint,
};
