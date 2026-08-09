const crypto = require("node:crypto");
const prisma = require("../../prisma/prismaClient");
const AppError = require("../../errors/AppError");
const { verifySnsMessage, confirmSnsSubscription } = require("./snsMessageService");

const providerMessageHash = (messageId) => crypto.createHash("sha256").update(messageId).digest("hex");

const parseSesEvent = (message) => {
  let payload;
  try {
    payload = JSON.parse(message.Message);
  } catch {
    throw new AppError(400, "INVALID_SES_EVENT", "SES event payload must be valid JSON");
  }
  const eventType = payload?.eventType || payload?.notificationType;
  const providerMessageId = payload?.mail?.messageId;
  if (typeof eventType !== "string" || typeof providerMessageId !== "string" || !providerMessageId || providerMessageId.length > 255) {
    throw new AppError(400, "INVALID_SES_EVENT", "SES event payload is incomplete");
  }
  const normalized = eventType.replace(/[_\s-]/g, "").toUpperCase();
  if (normalized === "DELIVERY") {
    const deliveredAt = payload.delivery?.timestamp && Number.isFinite(Date.parse(payload.delivery.timestamp))
      ? new Date(payload.delivery.timestamp)
      : new Date();
    return { eventType: "DELIVERY", providerMessageId, targetStatus: "DELIVERED", failureReason: null, deliveredAt };
  }
  if (normalized === "BOUNCE") {
    const bounceType = String(payload.bounce?.bounceType || "UNDETERMINED").replace(/[^A-Za-z0-9_]/g, "_").slice(0, 40).toUpperCase();
    return { eventType: "BOUNCE", providerMessageId, targetStatus: "BOUNCED", failureReason: `SES_BOUNCE_${bounceType}`, deliveredAt: null };
  }
  if (normalized === "COMPLAINT") return { eventType: "COMPLAINT", providerMessageId, targetStatus: "COMPLAINT", failureReason: "SES_COMPLAINT", deliveredAt: null };
  if (normalized === "REJECT") return { eventType: "REJECT", providerMessageId, targetStatus: "FAILED", failureReason: "SES_REJECT", deliveredAt: null };
  if (normalized === "RENDERINGFAILURE") return { eventType: "RENDERING_FAILURE", providerMessageId, targetStatus: "FAILED", failureReason: "SES_RENDERING_FAILURE", deliveredAt: null };
  return { eventType: normalized.slice(0, 40), providerMessageId, targetStatus: null, failureReason: null, deliveredAt: null };
};

const STATUS_PRIORITY = Object.freeze({
  QUEUED: 0,
  SENDING: 0,
  RECONCILIATION_REQUIRED: 0,
  SENT: 0,
  DELIVERED: 1,
  FAILED: 2,
  BOUNCED: 3,
  COMPLAINT: 4,
  CANCELLED: 5,
});

const canApplyStatus = (current, target) => target
  && current !== "CANCELLED"
  && (STATUS_PRIORITY[target] ?? -1) > (STATUS_PRIORITY[current] ?? -1);

const recordProviderEvent = async (message, event, db = prisma) => {
  const messageIdHash = providerMessageHash(event.providerMessageId);
  try {
    return await db.$transaction(async (tx) => {
      const receipt = await tx.providerEventReceipt.create({ data: {
        provider: "AWS_SES_SNS",
        providerEventId: message.MessageId,
        providerMessageIdHash: messageIdHash,
        eventType: event.eventType,
      } });
      const matches = await tx.notificationDelivery.findMany({
        where: { providerMessageId: event.providerMessageId },
        select: { id: true, referralId: true, documentId: true, status: true },
        take: 2,
      });
      const delivery = matches.length === 1 ? matches[0] : null;
      let appliedStatus = null;
      if (delivery && canApplyStatus(delivery.status, event.targetStatus)) {
        const changed = await tx.notificationDelivery.updateMany({
          where: { id: delivery.id, status: delivery.status },
          data: {
            status: event.targetStatus,
            failureReason: event.failureReason,
            ...(event.targetStatus === "DELIVERED" ? { deliveredAt: event.deliveredAt } : {}),
          },
        });
        if (changed.count === 1) {
          appliedStatus = event.targetStatus;
          await tx.auditLog.create({ data: {
            userId: null,
            action: `REFERRAL_EMAIL_${event.targetStatus}`,
            resource: "NotificationDelivery",
            entityName: "NotificationDelivery",
            entityId: delivery.id,
            details: {
              referralId: delivery.referralId,
              documentId: delivery.documentId,
              providerEventReceiptId: receipt.id,
              eventType: event.eventType,
              previousStatus: delivery.status,
              status: event.targetStatus,
            },
          } });
        }
      }
      await tx.providerEventReceipt.update({
        where: { id: receipt.id },
        data: { deliveryId: delivery?.id || null, appliedStatus },
      });
      return { accepted: true, duplicate: false, matched: Boolean(delivery), appliedStatus };
    });
  } catch (error) {
    if (error?.code === "P2002") return { accepted: true, duplicate: true, matched: null, appliedStatus: null };
    throw error;
  }
};

const ingestSesProviderEvent = async (rawBody, options = {}) => {
  const message = await (options.verify || verifySnsMessage)(rawBody, options.verifyOptions);
  if (options.headerType && options.headerType !== message.Type) throw new AppError(400, "SNS_TYPE_MISMATCH", "Provider event type header does not match the signed body");
  if (message.Type === "SubscriptionConfirmation") {
    await (options.confirm || confirmSnsSubscription)(message, options.confirmOptions);
    return { accepted: true, subscriptionConfirmed: true };
  }
  if (message.Type === "UnsubscribeConfirmation") return { accepted: true, subscriptionConfirmed: false };
  return recordProviderEvent(message, parseSesEvent(message), options.db || prisma);
};

module.exports = {
  providerMessageHash,
  parseSesEvent,
  canApplyStatus,
  recordProviderEvent,
  ingestSesProviderEvent,
};
