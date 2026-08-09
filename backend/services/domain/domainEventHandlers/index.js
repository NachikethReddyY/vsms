/**
 * Domain event handlers.
 *
 * These observers demonstrate event-driven decoupling: producers (screening,
 * event transitions, referrals) only publish facts to the outbox; this module
 * owns every downstream reaction. Handlers are idempotent and must never
 * mutate the aggregate that produced the event (that would couple the observer
 * back to the producer and risk infinite event loops).
 */

const ESCALATED_FLAGS = new Set(["REFER", "URGENT"]);

const FLAG_PUBLISHED_EVENT = "SCREENING_FLAGGED";

/**
 * SCREENING_RESULT_RECORDED -> SCREENING_FLAGGED
 * Fan-out: an escalated clinical finding is republished as its own event so
 * downstream consumers can subscribe to flags without coupling to raw results.
 */
async function escalateScreeningFlag({ event, context }) {
  if (!ESCALATED_FLAGS.has(event.payload.overallFlag)) return;
  await context.emit({
    type: FLAG_PUBLISHED_EVENT,
    aggregateType: "ScreeningResult",
    aggregateId: event.aggregateId,
    correlationId: event.correlationId,
    actorUserId: event.actorUserId,
    payload: {
      eventId: event.payload.eventId,
      registrationId: event.payload.registrationId,
      stationType: event.payload.stationType,
      overallFlag: event.payload.overallFlag,
      ruleVersion: event.payload.ruleVersion,
    },
  });
}

/**
 * SCREENING_FLAGGED
 * Observable audit trail: records that the flag event was dispatched to the
 * downstream stage. A distinct action name keeps this separate from the
 * request-path audit already written by the screening service.
 */
async function auditScreeningFlag({ event, context }) {
  await context.db.auditLog.create({
    data: {
      userId: event.actorUserId,
      action: "SCREENING_FLAG_EVENT_DISPATCHED",
      resource: "DomainEvent",
      entityName: "ScreeningResult",
      entityId: event.aggregateId,
      details: {
        eventId: event.payload.eventId,
        registrationId: event.payload.registrationId,
        overallFlag: event.payload.overallFlag,
      },
      newValue: { domainEventId: event.id },
    },
  });
}

/**
 * EVENT_TRANSITIONED
 * Observable audit trail for lifecycle transitions that were published through
 * the bus (publish / start / complete / cancel).
 */
async function auditEventTransition({ event, context }) {
  await context.db.auditLog.create({
    data: {
      userId: event.actorUserId,
      action: "EVENT_TRANSITION_EVENT_DISPATCHED",
      resource: "DomainEvent",
      entityName: "Event",
      entityId: event.aggregateId,
      details: {
        fromStatus: event.payload.fromStatus,
        toStatus: event.payload.toStatus,
        command: event.payload.command,
      },
      newValue: { domainEventId: event.id },
    },
  });
}

/**
 * REFERRAL_ISSUED
 * Observable audit trail for referral issuance published through the bus.
 */
async function auditReferralIssued({ event, context }) {
  await context.db.auditLog.create({
    data: {
      userId: event.actorUserId,
      action: "REFERRAL_ISSUE_EVENT_DISPATCHED",
      resource: "DomainEvent",
      entityName: "Referral",
      entityId: event.aggregateId,
      details: {
        eventId: event.payload.eventId,
        documentId: event.payload.documentId,
        version: event.payload.version,
      },
      newValue: { domainEventId: event.id },
    },
  });
}

function registerDomainEventHandlers(bus) {
  bus.registerHandler("SCREENING_RESULT_RECORDED", escalateScreeningFlag);
  bus.registerHandler(FLAG_PUBLISHED_EVENT, auditScreeningFlag);
  bus.registerHandler("EVENT_TRANSITIONED", auditEventTransition);
  bus.registerHandler("REFERRAL_ISSUED", auditReferralIssued);
}

module.exports = {
  FLAG_PUBLISHED_EVENT,
  registerDomainEventHandlers,
  escalateScreeningFlag,
  auditScreeningFlag,
  auditEventTransition,
  auditReferralIssued,
};
