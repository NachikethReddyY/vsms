const crypto = require("node:crypto");
const nodemailer = require("nodemailer");
const { Prisma } = require("@prisma/client");
const prisma = require("../../prisma/prismaClient");
const env = require("../../config/env");
const { createAuditLog } = require("../../utils/logging/audit");

const PURPOSES = new Set(["SIGNUP_RECEIVED", "APPROVED", "REJECTED", "SUSPENDED", "REACTIVATED", "EVENT_ASSIGNMENT", "PASSWORD_CHANGED", "DEPROVISIONED"]);
const TYPE_MAP = Object.freeze({ APPROVED: "APPROVED", REJECTED: "REJECTED", PENDING: "SIGNUP_RECEIVED", SUSPEND: "SUSPENDED", SUSPENDED: "SUSPENDED", REACTIVATE: "REACTIVATED", REACTIVATED: "REACTIVATED", SIGNUP_RECEIVED: "SIGNUP_RECEIVED", EVENT_ASSIGNMENT: "EVENT_ASSIGNMENT", PASSWORD_CHANGED: "PASSWORD_CHANGED", DEPROVISIONED: "DEPROVISIONED" });
const SAFE_METADATA = Object.freeze({ SIGNUP_RECEIVED: [], APPROVED: [], REJECTED: [], SUSPENDED: [], REACTIVATED: [], DEPROVISIONED: [], PASSWORD_CHANGED: ["changedAt"], EVENT_ASSIGNMENT: ["eventId", "eventName", "roles"] });
const LEASE_MS = 5 * 60 * 1000;

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);

function safeMetadata(purpose, metadata = {}) {
  if (!metadata || Array.isArray(metadata) || typeof metadata !== "object") throw new Error("Lifecycle email metadata must be an object");
  const allowed = new Set(SAFE_METADATA[purpose] || []);
  if (Object.keys(metadata).some((key) => !allowed.has(key))) throw new Error("Lifecycle email metadata contains an unsafe field");
  const safe = {};
  if (metadata.eventId) safe.eventId = String(metadata.eventId).slice(0, 36);
  if (metadata.eventName) safe.eventName = String(metadata.eventName).replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 150);
  if (metadata.changedAt) safe.changedAt = new Date(metadata.changedAt).toISOString();
  if (metadata.roles) safe.roles = [...new Set(metadata.roles.map(String))].sort().slice(0, 5);
  if (Buffer.byteLength(JSON.stringify(safe)) > 4096) throw new Error("Lifecycle email metadata is too large");
  return safe;
}

function renderTemplate(purpose, account, metadata = {}) {
  const name = String(account.fullName || "there");
  const eventName = String(metadata.eventName || "your event");
  const roles = (metadata.roles || []).join(", ");
  const templates = {
    SIGNUP_RECEIVED: ["We received your VSMS signup", "Your signup was received and is awaiting administrator review."],
    APPROVED: ["Your VSMS account was approved", "Your account is approved. You can now sign in to VSMS."],
    REJECTED: ["Your VSMS account request was not approved", "Your account request was not approved. Contact an administrator if you need assistance."],
    SUSPENDED: ["Your VSMS account was suspended", "Access to your VSMS account has been suspended. Contact an administrator for assistance."],
    REACTIVATED: ["Your VSMS account was reactivated", "Access to your VSMS account has been restored."],
    DEPROVISIONED: ["Your VSMS account was deprovisioned", "Your VSMS account has been disabled. Contact an administrator if you need assistance."],
    EVENT_ASSIGNMENT: [`VSMS event assignment: ${eventName}`, `You were assigned to ${eventName}${roles ? ` with role${metadata.roles.length === 1 ? "" : "s"}: ${roles}` : ""}.`],
    PASSWORD_CHANGED: ["Your VSMS password was changed", `Your password was changed${metadata.changedAt ? ` at ${metadata.changedAt}` : ""}. If this was not you, contact an administrator immediately.`],
  };
  if (!templates[purpose]) throw new Error("Unsupported lifecycle email purpose");
  const [subject, message] = templates[purpose];
  return { subject, text: `Hello ${name},\n\n${message}\n\nVSMS`, html: `<p>Hello ${escapeHtml(name)},</p><p>${escapeHtml(message)}</p><p>VSMS</p>` };
}

function createGoogleTransport() {
  if (!env.lifecycleEmailEnabled) return null;
  return nodemailer.createTransport({ host: "smtp.gmail.com", port: 465, secure: true, auth: { type: "OAuth2", user: env.GOOGLE_WORKSPACE_USER, clientId: env.GOOGLE_WORKSPACE_CLIENT_ID, clientSecret: env.GOOGLE_WORKSPACE_CLIENT_SECRET, refreshToken: env.GOOGLE_WORKSPACE_REFRESH_TOKEN }, tls: { rejectUnauthorized: true, minVersion: "TLSv1.2", servername: "smtp.gmail.com" }, connectionTimeout: env.LIFECYCLE_EMAIL_CONNECTION_TIMEOUT_MS, greetingTimeout: env.LIFECYCLE_EMAIL_CONNECTION_TIMEOUT_MS, socketTimeout: env.LIFECYCLE_EMAIL_SOCKET_TIMEOUT_MS, disableFileAccess: true, disableUrlAccess: true });
}

async function enqueueLifecycleEmail({ purpose, userId, metadata = {}, idempotencyKey, db = prisma, maxAttempts = 5 }) {
  if (!PURPOSES.has(purpose)) return { queued: false, reason: "UNSUPPORTED_PURPOSE" };
  if (!db.lifecycleEmailOutbox) return { queued: false, reason: "OUTBOX_UNAVAILABLE" };
  const normalizedMetadata = safeMetadata(purpose, metadata);
  try {
    const delivery = await db.lifecycleEmailOutbox.create({ data: { userId, purpose, metadata: normalizedMetadata, idempotencyKey, maxAttempts } });
    return { queued: true, deliveryId: delivery.id, status: delivery.status };
  } catch (error) {
    if (error.code !== "P2002") throw error;
    const existing = await db.lifecycleEmailOutbox.findUnique({ where: { idempotencyKey } });
    return { queued: false, deliveryId: existing?.id, status: existing?.status, duplicate: true };
  }
}

function lifecyclePurposeForAccount(account) {
  if (account.deprovisionedAt || account.accessState === "DISABLED") return "DEPROVISIONED";
  if (account.accessState === "SUSPENDED") return "SUSPENDED";
  return TYPE_MAP[account.approvalState] || account.approvalState;
}

async function enqueueAccountLifecycle({ type, account, metadata = {}, idempotencyKey, db = prisma, force = false }) {
  const purpose = type ? (TYPE_MAP[type] || type) : lifecyclePurposeForAccount(account);
  if (!PURPOSES.has(purpose)) return { queued: false, reason: "UNSUPPORTED_PURPOSE" };
  const key = idempotencyKey || `${purpose}:${account.id}:${force ? crypto.randomUUID() : new Date(account.updatedAt || account.createdAt || 0).getTime()}`;
  return enqueueLifecycleEmail({ purpose, userId: account.id, metadata, idempotencyKey: key, db });
}

async function claimNextLifecycleEmail({ db = prisma, now = new Date(), leaseMs = LEASE_MS } = {}) {
  if (!env.lifecycleEmailEnabled) return null;
  const claimToken = crypto.randomUUID();
  const rows = await db.$queryRaw(Prisma.sql`
    WITH candidate AS (
      SELECT lifecycle_email_id FROM lifecycle_email_outbox
      WHERE attempt_count < max_attempts AND status IN ('QUEUED', 'FAILED') AND next_attempt_at <= ${now}
      ORDER BY next_attempt_at, created_at, lifecycle_email_id FOR UPDATE SKIP LOCKED LIMIT 1
    )
    UPDATE lifecycle_email_outbox e
    SET status = 'SENDING', claim_token = ${claimToken}::uuid, lease_expires_at = ${new Date(now.getTime() + leaseMs)},
      attempt_count = e.attempt_count + 1, failure_code = NULL, updated_at = ${now}
    FROM candidate WHERE e.lifecycle_email_id = candidate.lifecycle_email_id
    RETURNING e.lifecycle_email_id AS id
  `);
  if (!rows.length) return null;
  return db.lifecycleEmailOutbox.findUnique({ where: { id: rows[0].id }, include: { user: { select: { id: true, email: true, fullName: true } } } });
}

const emailFailureCode = (error) => {
  if (["ETIMEDOUT", "ESOCKET", "ECONNECTION", "ECONNRESET", "ECONNREFUSED", "EPIPE"].includes(error?.code)) return "SMTP_TIMEOUT_OR_CONNECTION";
  return String(error?.code || error?.responseCode || "SMTP_REJECTED").replace(/[^A-Z0-9_-]/gi, "_").toUpperCase().slice(0, 80);
};
const definitelyPreSendFailure = (error, sendStarted) => !sendStarted || ["EAUTH", "EENVELOPE", "EMESSAGE", "SMTP_RECIPIENT_NOT_ACCEPTED", "SMTP_REJECTED"].includes(error?.code);

async function processClaimedLifecycleEmail(delivery, { db = prisma, now = new Date(), transport = createGoogleTransport() } = {}) {
  if (!transport) return { status: "DISABLED" };
  let sendStarted = false;
  try {
    const template = renderTemplate(delivery.purpose, delivery.user, delivery.metadata);
    sendStarted = true;
    const info = await transport.sendMail({ from: env.LIFECYCLE_EMAIL_FROM, to: delivery.user.email, subject: template.subject, text: template.text, html: template.html, disableFileAccess: true, disableUrlAccess: true });
    const accepted = (info.accepted || []).map((value) => String(value).toLowerCase());
    if (!accepted.includes(delivery.user.email.toLowerCase())) {
      const error = new Error("Google did not accept the recipient"); error.code = "SMTP_RECIPIENT_NOT_ACCEPTED"; throw error;
    }
    const changed = await db.lifecycleEmailOutbox.updateMany({ where: { id: delivery.id, status: "SENDING", claimToken: delivery.claimToken }, data: { status: "SENT", acceptedAt: now, providerMessageId: String(info.messageId || "").slice(0, 255) || null, claimToken: null, leaseExpiresAt: null, failureCode: null, failedAt: null } });
    return changed.count === 1 ? { status: "SENT", accepted: true } : { status: "LEASE_LOST", accepted: true };
  } catch (error) {
    const definitelyFailed = definitelyPreSendFailure(error, sendStarted);
    const exhausted = delivery.attemptCount >= delivery.maxAttempts;
    const status = definitelyFailed ? (exhausted ? "ESCALATED" : "FAILED") : "RECONCILIATION_REQUIRED";
    const nextAttemptAt = new Date(now.getTime() + Math.min(60 * 60 * 1000, 30_000 * (2 ** Math.max(0, delivery.attemptCount - 1))));
    const changed = await db.lifecycleEmailOutbox.updateMany({ where: { id: delivery.id, status: "SENDING", claimToken: delivery.claimToken }, data: { status, failureCode: emailFailureCode(error), failedAt: now, claimToken: null, leaseExpiresAt: null, nextAttemptAt: definitelyFailed && !exhausted ? nextAttemptAt : new Date("9999-12-31T23:59:59.999Z") } });
    if (!changed.count) return { status: "LEASE_LOST" };
    return { status, accepted: false, retryable: status === "FAILED", failureCode: emailFailureCode(error) };
  }
}

async function reconcileStaleLifecycleEmails({ db = prisma, now = new Date(), limit = 100 } = {}) {
  const stale = await db.lifecycleEmailOutbox.findMany({ where: { status: "SENDING", leaseExpiresAt: { lte: now } }, select: { id: true, userId: true, claimToken: true }, orderBy: { leaseExpiresAt: "asc" }, take: Math.min(Math.max(limit, 1), 500) });
  let escalated = 0;
  for (const delivery of stale) {
    const applied = await db.$transaction(async (tx) => {
      const changed = await tx.lifecycleEmailOutbox.updateMany({ where: { id: delivery.id, status: "SENDING", claimToken: delivery.claimToken, leaseExpiresAt: { lte: now } }, data: { status: "ESCALATED", claimToken: null, leaseExpiresAt: null, failureCode: "SMTP_SEND_STATE_UNKNOWN", failedAt: now, nextAttemptAt: new Date("9999-12-31T23:59:59.999Z") } });
      if (!changed.count) return false;
      await createAuditLog({ userId: delivery.userId, action: "LIFECYCLE_EMAIL_RECONCILIATION_REQUIRED", entityName: "LifecycleEmailOutbox", entityId: delivery.id, outcome: "FAILED", newValue: { reason: "SMTP_SEND_STATE_UNKNOWN", claimToken: delivery.claimToken }, client: tx });
      return true;
    });
    if (applied) escalated += 1;
  }
  return { inspected: stale.length, escalated };
}

async function maintainLifecycleEmail(deliveryId, action, reason, actorId, context, db = prisma, now = new Date()) {
  if (!String(reason || "").trim()) throw new Error("Lifecycle email resolution reason is required");
  if (!["REQUEUE", "RESOLVE"].includes(action)) throw new Error("Lifecycle email reconciliation action is invalid");
  return db.$transaction(async (tx) => {
    const delivery = await tx.lifecycleEmailOutbox.findUnique({ where: { id: deliveryId }, select: { id: true, userId: true, status: true } });
    if (!delivery) return null;
    if (!["RECONCILIATION_REQUIRED", "ESCALATED"].includes(delivery.status)) throw new Error("Lifecycle email is not awaiting manual reconciliation");
    const data = action === "REQUEUE"
      ? { status: "QUEUED", claimToken: null, leaseExpiresAt: null, attemptCount: 0, failureCode: null, failedAt: null, nextAttemptAt: now }
      : { status: "CANCELLED", claimToken: null, leaseExpiresAt: null, nextAttemptAt: new Date("9999-12-31T23:59:59.999Z") };
    const changed = await tx.lifecycleEmailOutbox.updateMany({ where: { id: deliveryId, status: delivery.status }, data });
    if (!changed.count) throw new Error("Lifecycle email reconciliation changed concurrently");
    await createAuditLog({ userId: actorId, action: action === "REQUEUE" ? "LIFECYCLE_EMAIL_MANUALLY_REQUEUED" : "LIFECYCLE_EMAIL_MANUALLY_RESOLVED", entityName: "LifecycleEmailOutbox", entityId: deliveryId, newValue: { reason: String(reason).trim(), priorStatus: delivery.status, recipientUserId: delivery.userId }, context, client: tx });
    return tx.lifecycleEmailOutbox.findUnique({ where: { id: deliveryId } });
  });
}

async function processNextLifecycleEmail(options = {}) {
  const delivery = await claimNextLifecycleEmail(options);
  return delivery ? processClaimedLifecycleEmail(delivery, options) : null;
}

module.exports = { LEASE_MS, claimNextLifecycleEmail, createGoogleTransport, definitelyPreSendFailure, emailFailureCode, enqueueAccountLifecycle, enqueueLifecycleEmail, escapeHtml, lifecyclePurposeForAccount, maintainLifecycleEmail, processClaimedLifecycleEmail, processNextLifecycleEmail, reconcileStaleLifecycleEmails, renderTemplate, safeMetadata };
