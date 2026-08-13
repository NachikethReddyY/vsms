const { z } = require("zod");

const eyeResult = z.object({
  visualAcuity: z.string().optional(),
  rightEye: z.string().optional(),
  leftEye: z.string().optional(),
  remarks: z.string().max(500).optional()
});

const saveScreeningSchema = z.object({
  patientId: z.string().min(1),
  eventId: z.string().min(1),
  stationId: z.string().min(1),
  testType: z.string().min(1),
  screenerId: z.string().optional(),
  screenerName: z.string().optional(),
  offlineOutboxId: z.string().optional(),
  result: eyeResult
});

function validateSaveScreening(payload) {
  return saveScreeningSchema.parse(payload);
}

module.exports = { validateSaveScreening };