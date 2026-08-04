const { z } = require("zod");

const reconciliationResolution = z.object({
  deliveryId: z.string().uuid(),
  outcome: z.enum(["SENT", "FAILED"]),
  providerMessageId: z.string().trim().min(1).max(255).optional(),
}).strict().superRefine((value, context) => {
  if (value.outcome === "SENT" && !value.providerMessageId) {
    context.addIssue({
      code: "custom",
      path: ["providerMessageId"],
      message: "Provider message id is required when confirming delivery",
    });
  }
  if (value.outcome === "FAILED" && value.providerMessageId) {
    context.addIssue({
      code: "custom",
      path: ["providerMessageId"],
      message: "Provider message id is not accepted when the provider confirmed no send",
    });
  }
});

const referralDeliveryMaintenanceBody = z.object({
  staleAfterMinutes: z.number().int().min(5).max(1440).default(30),
  resolutions: z.array(reconciliationResolution).max(200).default([]),
  retryDeliveryIds: z.array(z.string().uuid()).max(200).default([]),
}).strict().superRefine((value, context) => {
  if (new Set(value.resolutions.map(({ deliveryId }) => deliveryId)).size !== value.resolutions.length) {
    context.addIssue({ code: "custom", path: ["resolutions"], message: "A delivery can be resolved only once per request" });
  }
  if (new Set(value.retryDeliveryIds).size !== value.retryDeliveryIds.length) {
    context.addIssue({ code: "custom", path: ["retryDeliveryIds"], message: "A delivery can be retried only once per request" });
  }
  const resolvedIds = new Set(value.resolutions.map(({ deliveryId }) => deliveryId));
  if (value.retryDeliveryIds.some((deliveryId) => resolvedIds.has(deliveryId))) {
    context.addIssue({ code: "custom", path: ["retryDeliveryIds"], message: "Resolve and retry a delivery in separate requests" });
  }
});

const artifactCleanupListQuery = z.object({
  status: z.enum(["ESCALATED", "RESOLVED", "FAILED", "PENDING"]).default("ESCALATED"),
  eventId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
}).strict();

const artifactCleanupParams = z.object({ taskId: z.string().uuid() }).strict();

const artifactCleanupActionBody = z.object({
  action: z.enum(["REQUEUE", "RESOLVE"]),
  resolutionNote: z.string().trim().min(10).max(500),
}).strict();

module.exports = {
  referralDeliveryMaintenanceBody,
  artifactCleanupListQuery,
  artifactCleanupParams,
  artifactCleanupActionBody,
};
