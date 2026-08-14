const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const PDFDocument = require("pdfkit");
const nodemailer = require("nodemailer");
const prisma = require("../../prisma/prismaClient");
const env = require("../../config/env");
const AppError = require("../../errors/AppError");
const domainEventBus = require("../domain/domainEventBus");
const { encrypt, decrypt, encryptionContext } = require("../../utils/crypto/cryptoUtils");
const { loadVerifiedSignature, consumeSignatureArtifact, deleteSignature } = require("../../utils/storage/signatureStorage");
const { requireReviewerAccess } = require("./reviewService");
const { maskNric } = require("../../utils/validation/validation");
const { createAuditLog } = require("../../utils/logging/audit");

const documentsRoot = () => path.resolve(
  process.env.REFERRAL_STORAGE_DIR || path.join(__dirname, "..", "secure-data", "documents"),
);

const deliveryEncryptionContext = (deliveryId, field) => encryptionContext("NotificationDelivery", deliveryId, field);

const maskEmail = (email) => {
  const [local, domain] = email.split("@");
  return `${local.slice(0, 1)}***@${domain}`;
};

const generateHandoffSecret = () => crypto.randomBytes(18).toString("base64url");
const HANDOFF_SECRET_TTL_MS = 15 * 60 * 1000;

const referralEmailTemplate = (referralId) => ({
  subject: "Confidential document from VSMS (encrypted PDF)",
  body: "A confidential health report and referral is attached as an encrypted PDF. Obtain the one-time password from the issuing reviewer through a separate channel. This email body does not contain the password, participant identity, or clinical details. Do not reply with personal or clinical information.",
  filename: `health-report-referral-${referralId.slice(0, 8)}.pdf`,
});

const signedPayload = (referral, destinationEmail, signatureSha256) => JSON.stringify({
  referralId: referral.referralId,
  revisionNumber: referral.revisionNumber || 1,
  supersedesReferralId: referral.supersedesReferralId || null,
  reviewId: referral.review.reviewId,
  registrationId: referral.registrationId,
  outcome: referral.review.outcome,
  urgency: referral.urgency,
  clinicalSummary: referral.review.clinicalSummary,
  recommendations: referral.review.recommendations,
  destinationName: referral.destinationName,
  destinationEmail,
  reason: referral.reason,
  instructions: referral.instructions,
  reviewedByUserId: referral.review.reviewedByUserId,
  signatureSha256,
});

const payloadHash = (payload) => crypto.createHash("sha256").update(payload).digest("hex");

const referralIssueFingerprint = (eventId, referralId, userId, input) => payloadHash(JSON.stringify({
  eventId,
  referralId,
  userId,
  destinationEmail: input.destinationEmail.toLowerCase(),
  signatureObjectKey: input.signatureObjectKey,
  signatureSha256: input.signatureSha256.toLowerCase(),
  signatureMimeType: input.signatureMimeType,
  idempotencyKey: input.idempotencyKey,
  confirmed: input.confirmed,
}));

const referralRevisionFingerprint = (eventId, referralId, userId, input) => payloadHash(JSON.stringify({
  eventId,
  referralId,
  userId,
  destinationName: input.destinationName,
  reason: input.reason,
  instructions: input.instructions || null,
  urgency: input.urgency,
  idempotencyKey: input.idempotencyKey,
  confirmed: input.confirmed,
}));

const PDF_COLORS = Object.freeze({
  navy: "#172233",
  blue: "#315a8c",
  ink: "#17191c",
  secondary: "#4f545b",
  line: "#d9dde3",
  surface: "#f7f8fa",
  white: "#ffffff",
});

const RESULT_LABELS = {
  chartDistanceMetres: "Chart distance",
  measurementStatus: "Measurement status",
  notes: "Notes",
  od: "Right eye (OD)",
  odCorrect: "Right eye correct",
  os: "Left eye (OS)",
  osCorrect: "Left eye correct",
  platesPresented: "Plates presented",
  testKit: "Test kit",
  wearsDistanceGlasses: "Usual distance glasses",
  withUsualDistanceGlasses: "Usual distance glasses",
};

const prettyResultValue = (value, key) => {
  if (value == null) return "Not recorded";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (key === "chartDistanceMetres" && typeof value === "number") return `${value} m`;
  if (typeof value !== "object") return String(value).replace(/_/g, " ");
  if (value.kind === "FRACTION") return `6/${value.denominator}`;
  if (value.kind === "EXCEPTION") return String(value.code).replace(/_/g, " ");
  if (Object.hasOwn(value, "sphere") || Object.hasOwn(value, "cylinder")) {
    const sphere = Number(value.sphere || 0).toFixed(2);
    const cylinder = Number(value.cylinder || 0).toFixed(2);
    return `Sphere ${sphere} D, cylinder ${cylinder} D${value.axis == null ? "" : `, axis ${value.axis} deg`}`;
  }
  return Object.entries(value).map(([nestedKey, nestedValue]) => `${nestedKey.replace(/([A-Z])/g, " $1")}: ${prettyResultValue(nestedValue, nestedKey)}`).join(", ");
};

const resultSummary = (resultData) => Object.entries(resultData || {})
  .map(([key, value]) => `${RESULT_LABELS[key] || key.replace(/([A-Z])/g, " $1").replace(/^./, (letter) => letter.toUpperCase())}: ${prettyResultValue(value, key)}`)
  .join("  |  ");

const line = (doc, label, value) => {
  doc.font("Helvetica-Bold").fillColor(PDF_COLORS.blue).text(label, { continued: true });
  doc.font("Helvetica").fillColor(PDF_COLORS.ink).text(`  ${value || "Not recorded"}`);
};

const sectionTitle = (doc, title) => {
  doc.fillColor(PDF_COLORS.navy).font("Helvetica-Bold").fontSize(11).text(title.toUpperCase());
  doc.moveTo(54, doc.y + 4).lineTo(541, doc.y + 4).strokeColor(PDF_COLORS.line).lineWidth(0.8).stroke();
  doc.moveDown(0.9);
};

const generateReferralPdf = async ({ referral, signature, password, version, generatedAt = new Date() }) => new Promise((resolve, reject) => {
  const chunks = [];
  const registration = referral.review.registration;
  const participant = registration.participant;
  const event = registration.event;
  const doc = new PDFDocument({
    size: "A4",
    margin: 54,
    pdfVersion: "1.7ext3",
    userPassword: password,
    ownerPassword: crypto.randomBytes(32).toString("base64url"),
    permissions: { printing: "lowResolution", copying: false, modifying: false, annotating: false },
    info: { Title: "Vision screening referral", Author: "VSMS Event Operations" },
  });
  doc.on("data", (chunk) => chunks.push(chunk));
  doc.on("end", () => resolve(Buffer.concat(chunks)));
  doc.on("error", reject);

  doc.rect(0, 0, doc.page.width, doc.page.height).fill(PDF_COLORS.white);
  doc.rect(0, 0, doc.page.width, 8).fill(PDF_COLORS.navy);
  doc.fillColor(PDF_COLORS.blue).font("Helvetica-Bold").fontSize(9).text("VSMS EVENT OPERATIONS", 54, 29, { characterSpacing: 1.1 });
  doc.fillColor(PDF_COLORS.navy).font("Helvetica-Bold").fontSize(22).text("VISION SCREENING REFERRAL", 54, 45);
  doc.font("Helvetica").fillColor(PDF_COLORS.secondary).fontSize(8.5).text(`Document ${referral.referralId}  |  Version ${version}`, 54, 72);
  doc.moveTo(54, 91).lineTo(541, 91).strokeColor(PDF_COLORS.line).lineWidth(0.8).stroke();
  doc.y = 110;
  doc.fillColor(PDF_COLORS.navy).font("Helvetica-Bold").fontSize(14).text(event.name);
  doc.font("Helvetica").fillColor(PDF_COLORS.secondary).fontSize(10).text(`${event.venue}  |  ${generatedAt.toLocaleString("en-SG", { timeZone: event.timezone || "Asia/Singapore" })}`);
  doc.moveDown(1.2);

  sectionTitle(doc, "Participant");
  line(doc, "Name", `${participant.firstName} ${participant.lastName}`.trim());
  line(doc, "NRIC", maskNric(participant.nric) || participant.nricMasked || "Not recorded");
  line(doc, "Date of birth", participant.dateOfBirth.toISOString().slice(0, 10));
  doc.moveDown();

  sectionTitle(doc, "Clinical referral");
  line(doc, "Destination", referral.destinationName);
  line(doc, "Urgency", referral.urgency);
  line(doc, "Reason", referral.reason);
  if (referral.instructions) line(doc, "Instructions", referral.instructions);
  doc.moveDown();

  sectionTitle(doc, "Clinical assessment");
  line(doc, "Outcome", referral.review.outcome.replace(/_/g, " "));
  line(doc, "Summary", referral.review.clinicalSummary);
  if (referral.review.recommendations) line(doc, "Recommendations", referral.review.recommendations);
  doc.moveDown();

  sectionTitle(doc, "Screening results");
  for (const result of registration.screeningResults) {
    const summary = resultSummary(result.resultData);
    doc.font("Helvetica").fontSize(8.5);
    const cardHeight = 36
      + doc.heightOfString(summary, { width: 463, lineGap: 1.5 })
      + (result.flagSummary ? doc.heightOfString(result.flagSummary, { width: 463 }) + 4 : 0);
    if (doc.y + cardHeight > 650) {
      doc.addPage();
      sectionTitle(doc, "Screening results - continued");
    }
    const cardTop = doc.y;
    doc.roundedRect(54, cardTop, 487, cardHeight, 4).fill(PDF_COLORS.surface);
    doc.y = cardTop + 11;
    doc.x = 66;
    doc.font("Helvetica-Bold").fillColor(PDF_COLORS.ink).fontSize(10).text(`${result.station.stationName}  |  ${result.overallFlag}`, { width: 463 });
    doc.font("Helvetica").fillColor(PDF_COLORS.secondary).fontSize(8.5).text(summary, { width: 463, lineGap: 1.5 });
    if (result.flagSummary) doc.text(result.flagSummary);
    doc.x = 54;
    doc.y = cardTop + cardHeight + 10;
  }

  if (doc.y > 650) doc.addPage();
  doc.moveDown();
  sectionTitle(doc, "Electronically signed");
  doc.image(signature, { fit: [180, 70] });
  doc.font("Helvetica-Bold").fillColor(PDF_COLORS.ink).text(referral.review.reviewer.fullName);
  doc.font("Helvetica").fontSize(9).fillColor(PDF_COLORS.secondary).text(`Signed ${generatedAt.toISOString()}  |  Review ${referral.review.reviewId}`);
  doc.moveDown(1.5);
  doc.fontSize(8).fillColor(PDF_COLORS.secondary).text("Confidential clinical document. Verify the document identifier with VSMS Event Operations.", { align: "center" });
  doc.end();
});

const createReferralTransport = () => env.referralEmailEnabled ? nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  secure: env.SMTP_PORT === 465,
  requireTLS: env.SMTP_PORT === 587,
  auth: { user: env.SMTP_USERNAME, pass: env.SMTP_PASSWORD },
  tls: { rejectUnauthorized: true, minVersion: "TLSv1.2", servername: "smtp.gmail.com" },
  connectionTimeout: env.LIFECYCLE_EMAIL_CONNECTION_TIMEOUT_MS,
  greetingTimeout: env.LIFECYCLE_EMAIL_CONNECTION_TIMEOUT_MS,
  socketTimeout: env.LIFECYCLE_EMAIL_SOCKET_TIMEOUT_MS,
  disableFileAccess: true,
  disableUrlAccess: true,
}) : null;

const sendWithSmtp = async ({ to, document, referralId, subject, body }, transport = createReferralTransport()) => {
  if (!transport) return { status: "FAILED", reason: "DELIVERY_PROVIDER_NOT_CONFIGURED", attempted: false };
  const { filename } = referralEmailTemplate(referralId);
  let response;
  try {
    response = await transport.sendMail({
      from: env.SMTP_USERNAME,
      to,
      subject,
      text: body,
      attachments: [{ filename, content: document, contentType: "application/pdf", contentDisposition: "attachment" }],
      disableFileAccess: true,
      disableUrlAccess: true,
    });
  } catch (error) {
    if (["EAUTH", "EENVELOPE", "EMESSAGE"].includes(error?.code)) {
      return { status: "FAILED", reason: String(error.code).slice(0, 80), attempted: false };
    }
    throw error;
  }
  const accepted = (response.accepted || []).map((recipient) => String(recipient).toLowerCase());
  if (!accepted.includes(to.toLowerCase())) {
    return { status: "FAILED", reason: "SMTP_RECIPIENT_NOT_ACCEPTED", attempted: true };
  }
  return { status: "SENT", messageId: String(response.messageId || "").slice(0, 255) || null, attempted: true };
};

const loadReferral = (eventId, referralId) => prisma.referral.findFirst({
  where: { referralId, review: { registration: { eventId } } },
  include: {
    review: {
      include: {
        reviewer: { select: { fullName: true } },
        registration: {
          include: {
            event: { select: { name: true, venue: true, timezone: true, status: true } },
            participant: { select: { nric: true, nricMasked: true, firstName: true, lastName: true, dateOfBirth: true, contactNumber: true } },
            screeningResults: { orderBy: { createdAt: "asc" }, include: { station: { select: { stationName: true } } } },
          },
        },
      },
    },
  },
});

const assertReferralOwner = (referral, user) => {
  if (!referral) throw new AppError(404, "REFERRAL_NOT_FOUND", "Referral not found");
  if (referral.review.reviewedByUserId !== user.userId) throw new AppError(403, "REFERRAL_REVIEWER_REQUIRED", "Only the reviewer who recorded this decision can issue its referral");
};

const assertIssuable = (referral) => {
  if (referral.status !== "DRAFT") throw new AppError(409, "REFERRAL_ALREADY_ISSUED", "This referral has already been issued");
};

const serializeRevision = (referral) => ({
  referralId: referral.referralId,
  revisionNumber: referral.revisionNumber,
  supersedesReferralId: referral.supersedesReferralId,
  destinationName: referral.destinationName,
  reason: referral.reason,
  instructions: referral.instructions,
  urgency: referral.urgency,
  status: referral.status,
});

const createReferralRevision = async (eventId, referralId, input, user, ipAddress) => {
  const source = await loadReferral(eventId, referralId);
  assertReferralOwner(source, user);
  await requireReviewerAccess(prisma, eventId, user);
  if (!["ISSUED", "SENT", "ACKNOWLEDGED"].includes(source.status)) {
    throw new AppError(409, "REFERRAL_REVISION_NOT_ALLOWED", "Only an issued referral can be revised");
  }
  const fingerprint = referralRevisionFingerprint(eventId, referralId, user.userId, input);
  const replay = await prisma.referral.findUnique({ where: { revisionIdempotencyKey: input.idempotencyKey } });
  if (replay) {
    if (replay.supersedesReferralId !== referralId || replay.createdByUserId !== user.userId || replay.revisionRequestFingerprint !== fingerprint) {
      throw new AppError(409, "IDEMPOTENCY_KEY_REUSED", "Idempotency key was already used for a different request");
    }
    return serializeRevision(replay);
  }

  try {
    const revised = await prisma.$transaction(async (tx) => {
      const branch = await tx.referral.findUnique({ where: { supersedesReferralId: referralId }, select: { referralId: true } });
      if (branch) throw new AppError(409, "REFERRAL_ALREADY_REVISED", "A newer referral revision already exists");
      const created = await tx.referral.create({ data: {
        reviewId: source.reviewId,
        registrationId: source.registrationId,
        createdByUserId: user.userId,
        revisionNumber: (source.revisionNumber || 1) + 1,
        supersedesReferralId: referralId,
        revisionIdempotencyKey: input.idempotencyKey,
        revisionRequestFingerprint: fingerprint,
        destinationName: input.destinationName,
        reason: input.reason,
        instructions: input.instructions || null,
        urgency: input.urgency,
        status: "DRAFT",
      } });
      await createAuditLog({
        userId: user.userId,
        action: "REFERRAL_REVISION_CREATED",
        resource: "Referral",
        entityName: "Referral",
        entityId: created.referralId,
        details: {
          eventId,
          reviewId: source.reviewId,
          supersedesReferralId: referralId,
          revisionNumber: created.revisionNumber,
        },
        context: { ipAddress },
        client: tx,
      });
      return created;
    }, { isolationLevel: "Serializable" });
    return serializeRevision(revised);
  } catch (error) {
    if (error?.code === "P2002" || error?.code === "P2034") {
      const existing = await prisma.referral.findUnique({ where: { revisionIdempotencyKey: input.idempotencyKey } });
      if (existing?.supersedesReferralId === referralId && existing.createdByUserId === user.userId && existing.revisionRequestFingerprint === fingerprint) return serializeRevision(existing);
      throw new AppError(409, "REFERRAL_ALREADY_REVISED", "A newer referral revision already exists");
    }
    throw error;
  }
};

const serializeDelivery = (delivery) => delivery ? {
  deliveryId: delivery.id,
  status: delivery.status,
  recipient: delivery.recipient,
  providerMessageId: delivery.providerMessageId,
  attemptCount: delivery.attemptCount,
  failureReason: delivery.failureReason,
  sentAt: delivery.sentAt,
  deliveredAt: delivery.deliveredAt,
} : null;

const responseForDelivery = (referralId, delivery, handoffSecret = null) => ({
  referralId,
  status: delivery.sentAt ? "SENT" : "ISSUED",
  documentId: delivery.documentId,
  documentVersion: delivery.document?.version,
  handoffSecret,
  handoffSecretExpiresAt: handoffSecret ? delivery.handoffSecretExpiresAt : null,
  delivery: serializeDelivery(delivery),
});

const readDocumentArtifact = async (artifact) => {
  const match = /^documents\/([a-f0-9-]+\.pdf)$/.exec(artifact?.storageKey || "");
  if (!match) throw new AppError(500, "REFERRAL_DOCUMENT_UNAVAILABLE", "Referral document is unavailable");
  let buffer;
  try {
    buffer = await fs.readFile(path.join(documentsRoot(), match[1]));
  } catch (error) {
    if (error.code === "ENOENT") throw new AppError(404, "REFERRAL_DOCUMENT_NOT_FOUND", "Referral document not found");
    throw error;
  }
  const actualHash = crypto.createHash("sha256").update(buffer).digest("hex");
  if (actualHash !== artifact.contentHash) throw new AppError(500, "REFERRAL_DOCUMENT_TAMPERED", "Referral document failed integrity verification");
  return buffer;
};

const recoverHandoffSecret = async (delivery, now = new Date()) => {
  if (!delivery?.handoffSecretCiphertext || delivery.handoffSecretAcknowledgedAt) return null;
  if (!delivery.handoffSecretExpiresAt || delivery.handoffSecretExpiresAt <= now) {
    await prisma.notificationDelivery.updateMany({
      where: {
        id: delivery.id,
        handoffSecretCiphertext: { not: null },
        handoffSecretAcknowledgedAt: null,
        OR: [{ handoffSecretExpiresAt: null }, { handoffSecretExpiresAt: { lte: now } }],
      },
      data: { handoffSecretCiphertext: null },
    });
    return null;
  }
  return decrypt(delivery.handoffSecretCiphertext, deliveryEncryptionContext(delivery.id, "handoffSecret"));
};

const deliveryWithDocument = (id) => prisma.notificationDelivery.findUnique({
  where: { id },
  include: { document: true },
});

const auditDelivery = (tx, { userId, action, outcome, delivery, eventId, referralId, ipAddress, failureReason = null }) => createAuditLog({
  userId,
  action,
  resource: "NotificationDelivery",
  entityName: "NotificationDelivery",
  entityId: delivery.id,
  outcome,
  details: { eventId, referralId, documentId: delivery.documentId, status: delivery.status, failureReason },
  context: { ipAddress },
  client: tx,
});

// A delivery is claimed before calling SES. An ambiguous provider response is
// moved to manual reconciliation and is never retried automatically.
const resumeQueuedDelivery = async (eventId, referralId, deliveryId, user, ipAddress) => {
  const current = await deliveryWithDocument(deliveryId);
  if (!current || current.status !== "QUEUED") return current;
  const startedAt = new Date();
  const claimed = await prisma.notificationDelivery.updateMany({
    where: { id: deliveryId, status: "QUEUED" },
    data: { status: "SENDING", attemptCount: { increment: 1 }, lastAttemptAt: startedAt, failureReason: null },
  });
  let delivery = await deliveryWithDocument(deliveryId);
  if (!delivery || claimed.count !== 1) return delivery;

  let document;
  try {
    document = await readDocumentArtifact(delivery.document);
  } catch (error) {
    delivery = await prisma.notificationDelivery.update({
      where: { id: delivery.id },
      data: { status: "FAILED", failureReason: "REFERRAL_DOCUMENT_UNAVAILABLE" },
    });
    await prisma.$transaction((tx) => auditDelivery(tx, {
      userId: user.userId, action: "REFERRAL_EMAIL_FAILED", outcome: "FAILED", delivery, eventId, referralId, ipAddress, failureReason: delivery.failureReason,
    }));
    return delivery;
  }

  let result;
  try {
    result = await sendWithSmtp({
      to: decrypt(delivery.recipientCiphertext, deliveryEncryptionContext(delivery.id, "recipient")),
      document,
      referralId,
      subject: delivery.subject,
      body: delivery.body,
    });
  } catch {
    // The provider may have accepted the message before the connection failed.
    delivery = await prisma.notificationDelivery.update({
      where: { id: delivery.id },
      data: { status: "RECONCILIATION_REQUIRED", failureReason: "DELIVERY_CONFIRMATION_PENDING" },
    });
    await prisma.$transaction((tx) => auditDelivery(tx, {
      userId: user.userId, action: "REFERRAL_EMAIL_CONFIRMATION_PENDING", outcome: "FAILED", delivery, eventId, referralId, ipAddress, failureReason: delivery.failureReason,
    }));
    return delivery;
  }

  const finishedAt = new Date();
  delivery = await prisma.$transaction(async (tx) => {
    const updated = await tx.notificationDelivery.update({
      where: { id: delivery.id },
      data: {
        status: result.status,
        providerMessageId: result.messageId || null,
        sentAt: result.status === "SENT" ? finishedAt : null,
        failureReason: result.reason || null,
      },
    });
    if (result.status === "SENT") await tx.referral.update({ where: { referralId }, data: { status: "SENT" } });
    await auditDelivery(tx, {
      userId: user.userId,
      action: result.status === "SENT" ? "REFERRAL_EMAIL_ACCEPTED" : "REFERRAL_EMAIL_FAILED",
      outcome: result.status === "SENT" ? "SUCCESS" : "FAILED",
      delivery: updated,
      eventId,
      referralId,
      ipAddress,
      failureReason: result.reason || null,
    });
    return updated;
  });
  return deliveryWithDocument(delivery.id);
};

const issueReferral = async (eventId, referralId, input, user, ipAddress, context) => {
  const referral = await loadReferral(eventId, referralId);
  assertReferralOwner(referral, user);
  await requireReviewerAccess(prisma, eventId, user);

  const fingerprint = referralIssueFingerprint(eventId, referralId, user.userId, input);
  let existing = await prisma.notificationDelivery.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
    include: { document: true },
  });
  if (existing) {
    if (existing.referralId !== referralId || existing.userId !== user.userId || existing.requestFingerprint !== fingerprint) throw new AppError(409, "IDEMPOTENCY_KEY_REUSED", "Idempotency key was already used for a different request");
    existing = await resumeQueuedDelivery(eventId, referralId, existing.id, user, ipAddress) || existing;
    const handoffSecret = await recoverHandoffSecret(existing);
    return responseForDelivery(referralId, existing, handoffSecret);
  }

  assertIssuable(referral);
  const signature = await loadVerifiedSignature(input, user.userId, eventId, "REFERRAL");
  const destinationEmail = input.destinationEmail.toLowerCase();
  const handoffSecret = generateHandoffSecret();
  const handoffSecretExpiresAt = new Date(Date.now() + HANDOFF_SECRET_TTL_MS);
  const signedPayloadHash = payloadHash(signedPayload(referral, destinationEmail, input.signatureSha256));
  const generatedAt = new Date();
  const version = referral.revisionNumber || 1;
  const email = referralEmailTemplate(referralId);
  const document = await generateReferralPdf({ referral, signature, password: handoffSecret, version, generatedAt });
  const documentId = crypto.randomUUID();
  const deliveryId = crypto.randomUUID();
  const filename = `${documentId}.pdf`;
  const contentHash = crypto.createHash("sha256").update(document).digest("hex");
  await fs.mkdir(documentsRoot(), { recursive: true });
  await fs.writeFile(path.join(documentsRoot(), filename), document, { flag: "wx", mode: 0o600 });

  let delivery;
  try {
    delivery = await prisma.$transaction(async (tx) => {
      await consumeSignatureArtifact(tx, input, user.userId, eventId, "REFERRAL", referralId, generatedAt);
      const updated = await tx.referral.updateMany({
        where: { referralId, status: "DRAFT", createdByUserId: user.userId },
        data: {
          destinationEmail: maskEmail(destinationEmail),
          status: "ISSUED",
          referredAt: generatedAt,
          signatureObjectKey: input.signatureObjectKey,
          signatureSha256: input.signatureSha256.toLowerCase(),
          signatureMimeType: input.signatureMimeType,
          signedPayloadHash,
          signedAt: generatedAt,
        },
      });
      if (updated.count !== 1) throw new AppError(409, "REFERRAL_ALREADY_ISSUED", "This referral has already been issued");
      await tx.documentArtifact.create({ data: {
        documentId,
        reviewId: referral.reviewId,
        referralId,
        documentType: "REFERRAL_PDF",
        version,
        storageKey: `documents/${filename}`,
        contentHash,
        mimeType: "application/pdf",
        sizeBytes: BigInt(document.length),
        generatedByUserId: user.userId,
        generatedAt,
      } });
      const queued = await tx.notificationDelivery.create({ data: {
        id: deliveryId,
        userId: user.userId,
        referralId,
        documentId,
        status: "QUEUED",
        recipient: maskEmail(destinationEmail),
        recipientCiphertext: encrypt(destinationEmail, deliveryEncryptionContext(deliveryId, "recipient")),
        subject: email.subject,
        body: email.body,
        idempotencyKey: input.idempotencyKey,
        requestFingerprint: fingerprint,
        handoffSecretCiphertext: encrypt(handoffSecret, deliveryEncryptionContext(deliveryId, "handoffSecret")),
        handoffSecretExpiresAt,
      } });
      await createAuditLog({
        userId: user.userId,
        action: "REFERRAL_ISSUED",
        resource: "Referral",
        entityName: "Referral",
        entityId: referralId,
        details: { eventId, reviewId: referral.reviewId, documentId, version, signedPayloadHash },
        context: { ...context, ipAddress },
        client: tx,
      });
      await domainEventBus.emit({
        client: tx,
        type: "REFERRAL_ISSUED",
        aggregateType: "Referral",
        aggregateId: referralId,
        context,
        correlationId: context?.requestId,
        actorUserId: user.userId,
        payload: {
          eventId,
          reviewId: referral.reviewId,
          documentId,
          version,
          referralStatus: "ISSUED",
        },
      });
      return queued;
    });
  } catch (error) {
    await fs.unlink(path.join(documentsRoot(), filename)).catch(() => {});
    throw error;
  }
  await deleteSignature(input.signatureObjectKey, user.userId).catch(() => {});
  delivery = await resumeQueuedDelivery(eventId, referralId, delivery.id, user, ipAddress) || delivery;
  delivery = await deliveryWithDocument(delivery.id) || delivery;
  return responseForDelivery(referralId, delivery, await recoverHandoffSecret(delivery));
};

const acknowledgeReferralHandoff = async (eventId, referralId, input, user, ipAddress) => {
  const referral = await loadReferral(eventId, referralId);
  assertReferralOwner(referral, user);
  await requireReviewerAccess(prisma, eventId, user);
  const delivery = await prisma.notificationDelivery.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (!delivery || delivery.referralId !== referralId || delivery.userId !== user.userId) throw new AppError(404, "REFERRAL_HANDOFF_NOT_FOUND", "Referral handoff was not found");
  const acknowledgedAt = delivery.handoffSecretAcknowledgedAt || new Date();
  await prisma.$transaction(async (tx) => {
    await tx.notificationDelivery.updateMany({
      where: { id: delivery.id, handoffSecretAcknowledgedAt: null },
      data: { handoffSecretCiphertext: null, handoffSecretAcknowledgedAt: acknowledgedAt },
    });
    await createAuditLog({
      userId: user.userId,
      action: "REFERRAL_HANDOFF_ACKNOWLEDGED",
      resource: "Referral",
      entityName: "Referral",
      entityId: referralId,
      details: { eventId, deliveryId: delivery.id },
      context: { ipAddress },
      client: tx,
    });
  });
  return { acknowledgedAt };
};

const getDocument = async (eventId, referralId, documentId, user) => {
  const artifact = await prisma.documentArtifact.findFirst({
    where: { documentId, referralId, referral: { review: { registration: { eventId } } } },
    include: { referral: { include: { review: { select: { reviewedByUserId: true } } } } },
  });
  if (!artifact) throw new AppError(404, "REFERRAL_DOCUMENT_NOT_FOUND", "Referral document not found");
  await requireReviewerAccess(prisma, eventId, user);
  if (artifact.referral.review.reviewedByUserId !== user.userId) throw new AppError(403, "REFERRAL_REVIEWER_REQUIRED", "Only the issuing reviewer can download this referral");
  return { buffer: await readDocumentArtifact(artifact), filename: referralEmailTemplate(referralId).filename };
};

const reconcileReferralDeliveries = async (input, user, ipAddress, db = prisma, now = new Date()) => {
  if (!user?.roles?.includes("ADMINISTRATOR")) {
    throw new AppError(403, "ADMINISTRATOR_REQUIRED", "Administrator access is required");
  }
  const staleBefore = new Date(now.getTime() - input.staleAfterMinutes * 60_000);
  return db.$transaction(async (tx) => {
    const expired = await tx.notificationDelivery.updateMany({
      where: {
        handoffSecretCiphertext: { not: null },
        handoffSecretAcknowledgedAt: null,
        OR: [{ handoffSecretExpiresAt: null }, { handoffSecretExpiresAt: { lte: now } }],
      },
      data: { handoffSecretCiphertext: null },
    });

    const stale = await tx.notificationDelivery.findMany({
      where: {
        status: "SENDING",
        OR: [
          { lastAttemptAt: { lte: staleBefore } },
          { lastAttemptAt: null, createdAt: { lte: staleBefore } },
        ],
      },
      select: { id: true, referralId: true, documentId: true },
      take: 200,
    });
    let flagged = 0;
    for (const delivery of stale) {
      const changed = await tx.notificationDelivery.updateMany({
        where: {
          id: delivery.id,
          status: "SENDING",
          OR: [
            { lastAttemptAt: { lte: staleBefore } },
            { lastAttemptAt: null, createdAt: { lte: staleBefore } },
          ],
        },
        data: { status: "RECONCILIATION_REQUIRED", failureReason: "DELIVERY_CONFIRMATION_PENDING" },
      });
      if (changed.count !== 1) continue;
      flagged += 1;
      await auditDelivery(tx, {
        userId: user.userId,
        action: "REFERRAL_EMAIL_RECONCILIATION_REQUIRED",
        outcome: "FAILED",
        delivery: { ...delivery, status: "RECONCILIATION_REQUIRED" },
        eventId: null,
        referralId: delivery.referralId,
        ipAddress,
        failureReason: "DELIVERY_CONFIRMATION_PENDING",
      });
    }

    let reconciled = 0;
    for (const resolution of input.resolutions) {
      const delivery = await tx.notificationDelivery.findUnique({
        where: { id: resolution.deliveryId },
        select: { id: true, referralId: true, documentId: true, status: true },
      });
      if (!delivery) throw new AppError(404, "DELIVERY_NOT_FOUND", "Notification delivery was not found");
      if (delivery.status !== "RECONCILIATION_REQUIRED") {
        throw new AppError(409, "DELIVERY_NOT_RECONCILABLE", "Only a delivery awaiting reconciliation can be resolved");
      }
      const sent = resolution.outcome === "SENT";
      const changed = await tx.notificationDelivery.updateMany({
        where: { id: delivery.id, status: "RECONCILIATION_REQUIRED" },
        data: {
          status: sent ? "SENT" : "FAILED",
          providerMessageId: sent ? resolution.providerMessageId : null,
          sentAt: sent ? now : null,
          failureReason: sent ? null : "PROVIDER_CONFIRMED_NOT_SENT",
        },
      });
      if (changed.count !== 1) throw new AppError(409, "DELIVERY_STATE_CONFLICT", "Delivery state changed during reconciliation");
      if (sent && delivery.referralId) {
        await tx.referral.updateMany({
          where: { referralId: delivery.referralId, status: { in: ["ISSUED", "SENT"] } },
          data: { status: "SENT" },
        });
      }
      await auditDelivery(tx, {
        userId: user.userId,
        action: sent ? "REFERRAL_EMAIL_RECONCILED_SENT" : "REFERRAL_EMAIL_RECONCILED_NOT_SENT",
        outcome: sent ? "SUCCESS" : "FAILED",
        delivery: { ...delivery, status: sent ? "SENT" : "FAILED" },
        eventId: null,
        referralId: delivery.referralId,
        ipAddress,
        failureReason: sent ? null : "PROVIDER_CONFIRMED_NOT_SENT",
      });
      reconciled += 1;
    }

    let retryAuthorized = 0;
    for (const deliveryId of input.retryDeliveryIds || []) {
      const delivery = await tx.notificationDelivery.findUnique({
        where: { id: deliveryId },
        select: {
          id: true,
          referralId: true,
          documentId: true,
          status: true,
          failureReason: true,
          idempotencyKey: true,
          requestFingerprint: true,
        },
      });
      if (!delivery) throw new AppError(404, "DELIVERY_NOT_FOUND", "Notification delivery was not found");
      if (delivery.status !== "FAILED" || delivery.failureReason !== "PROVIDER_CONFIRMED_NOT_SENT") {
        throw new AppError(409, "DELIVERY_RETRY_NOT_ALLOWED", "Only a provider-confirmed unsent delivery can be retried");
      }
      const changed = await tx.notificationDelivery.updateMany({
        where: { id: delivery.id, status: "FAILED", failureReason: "PROVIDER_CONFIRMED_NOT_SENT" },
        data: { status: "QUEUED", failureReason: null, providerMessageId: null, sentAt: null, lastAttemptAt: null },
      });
      if (changed.count !== 1) throw new AppError(409, "DELIVERY_STATE_CONFLICT", "Delivery state changed during retry authorization");
      await auditDelivery(tx, {
        userId: user.userId,
        action: "REFERRAL_EMAIL_RETRY_AUTHORIZED",
        outcome: "SUCCESS",
        delivery: { ...delivery, status: "QUEUED" },
        eventId: null,
        referralId: delivery.referralId,
        ipAddress,
      });
      retryAuthorized += 1;
    }

    return {
      expiredEscrowsCleared: expired.count,
      ambiguousDeliveriesFlagged: flagged,
      deliveriesReconciled: reconciled,
      deliveriesRetryAuthorized: retryAuthorized,
    };
  });
};

module.exports = {
  issueReferral,
  acknowledgeReferralHandoff,
  getDocument,
  generateHandoffSecret,
  signedPayload,
  payloadHash,
  maskEmail,
  generateReferralPdf,
  createReferralTransport,
  sendWithSmtp,
  referralEmailTemplate,
  PDF_COLORS,
  resultSummary,
  referralIssueFingerprint,
  referralRevisionFingerprint,
  createReferralRevision,
  recoverHandoffSecret,
  resumeQueuedDelivery,
  reconcileReferralDeliveries,
};
