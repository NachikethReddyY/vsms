const { v4: uuidv4 } = require("uuid");
const { validateSaveScreening } = require("../validators/screening.validator");
const repo = require("../repositories/screening.repository");

function buildScreeningItem(data, now = new Date().toISOString()) {
  const resultId = data.offlineOutboxId || uuidv4();
  return {
    PK: `PATIENT#${data.patientId}`,
    SK: `RESULT#${data.testType}#${now}`,
    itemType: "SCREENING_RESULT",
    resultId,
    patientId: data.patientId,
    eventId: data.eventId,
    stationId: data.stationId,
    testType: data.testType,
    screenerId: data.screenerId || "UNKNOWN",
    screenerName: data.screenerName || "UNKNOWN",
    result: data.result,
    status: "COMPLETED",
    createdAt: now,
    GSI1PK: `EVENT#${data.eventId}`,
    GSI1SK: `RESULT#${now}#PATIENT#${data.patientId}`,
    GSI2PK: `STATION#${data.stationId}#EVENT#${data.eventId}`,
    GSI2SK: `RESULT#${now}`,
    GSI3PK: `EVENT#${data.eventId}`,
    GSI3SK: `STATUS#COMPLETED#${now}`
  };
}

async function saveScreeningResult(payload) {
  const data = validateSaveScreening(payload);
  const item = buildScreeningItem(data);
  await repo.saveScreeningItem(item);
  return { success: true, message: "Screening result saved", resultId: item.resultId, pk: item.PK, sk: item.SK };
}

async function getPatientResults(patientId) {
  const items = await repo.getResultsByPatient(patientId);
  return { success: true, patientId, count: items.length, items };
}

module.exports = { saveScreeningResult, getPatientResults, buildScreeningItem };