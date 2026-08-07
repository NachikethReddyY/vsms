const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const prisma = require("../../prisma/prismaClient");
const {
  generateHandoffSecret,
  maskEmail,
  signedPayload,
  payloadHash,
  generateReferralPdf,
  buildRawEmail,
  issueReferral,
  acknowledgeReferralHandoff,
  referralIssueFingerprint,
  recoverHandoffSecret,
  resumeQueuedDelivery,
  reconcileReferralDeliveries,
  createReferralRevision,
  referralRevisionFingerprint,
  PDF_COLORS,
  resultSummary,
} = require("../../services/referralService");
const {
  encrypt,
  decrypt,
  encryptionContext,
  encryptWithKeyring,
  decryptWithKeyring,
} = require("../../utils/cryptoUtils");
const { storeSignature, loadVerifiedSignature, consumeSignatureArtifact } = require("../../utils/signatureStorage");

const replace = (t, target, key, value) => {
  const original = target[key];
  target[key] = value;
  t.after(() => { target[key] = original; });
};

const reviewerUser = (userId, roles = ["REVIEWER"]) => ({
  userId,
  roles,
  status: "ACTIVE",
  approvalState: "APPROVED",
  accessState: "ENABLED",
});

const installReviewerMembership = (t, eventId, reviewerId) => replace(
  t,
  prisma.eventMembership,
  "findFirst",
  async () => ({ id: crypto.randomUUID(), eventId, userId: reviewerId, status: "ACTIVE", roles: [{ role: "REVIEWER" }] }),
);

const referralFixture = () => ({
  referralId: "11111111-1111-4111-8111-111111111111",
  reviewId: "22222222-2222-4222-8222-222222222222",
  registrationId: "33333333-3333-4333-8333-333333333333",
  destinationName: "National Eye Centre",
  reason: "Reduced visual acuity requires specialist assessment.",
  instructions: "Please arrange review within two weeks.",
  urgency: "PRIORITY",
  review: {
    reviewId: "22222222-2222-4222-8222-222222222222",
    reviewedByUserId: "44444444-4444-4444-8444-444444444444",
    outcome: "REFER",
    clinicalSummary: "Reduced distance vision in the right eye.",
    recommendations: "Continue current spectacles pending review.",
    reviewer: { fullName: "Dr Samira Tan" },
    registration: {
      event: { name: "Community Eye Screening", venue: "Jurong Library", timezone: "Asia/Singapore", status: "IN_PROGRESS" },
      participant: {
        nric: "S1234567D",
        nricMasked: "••••567D",
        firstName: "Alicia",
        lastName: "Lim",
        dateOfBirth: new Date("1980-04-12T00:00:00.000Z"),
        contactNumber: "+65 8123 9876",
      },
      screeningResults: [{
        station: { stationName: "Visual acuity" },
        overallFlag: "REFER",
        resultData: { od: "6/18", os: "6/6" },
        flagSummary: "Right eye below referral threshold.",
      }],
    },
  },
});

test("generates a unique referral passphrase without persisting it in signed payload", () => {
  const first = generateHandoffSecret();
  const second = generateHandoffSecret();
  assert.match(first, /^[A-Za-z0-9_-]{24}$/);
  assert.notEqual(first, second);
  const payload = signedPayload(referralFixture(), "clinic@example.com", "a".repeat(64));
  assert.equal(payload.includes("45679876"), false);
  assert.match(payloadHash(payload), /^[a-f0-9]{64}$/);
  assert.equal(maskEmail("clinic@example.com"), "c***@example.com");
});

test("binds the referral idempotency key to the complete issuance request", () => {
  const eventId = crypto.randomUUID();
  const referralId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const input = {
    destinationEmail: "clinic@example.com",
    signatureObjectKey: `signatures/${userId}/referral-${eventId}-${crypto.randomUUID()}.png`,
    signatureSha256: "a".repeat(64),
    signatureMimeType: "image/png",
    idempotencyKey: crypto.randomUUID(),
    confirmed: true,
  };
  const fingerprint = referralIssueFingerprint(eventId, referralId, userId, input);
  assert.notEqual(fingerprint, referralIssueFingerprint(eventId, referralId, userId, { ...input, destinationEmail: "other@example.com" }));
  assert.notEqual(fingerprint, referralIssueFingerprint(eventId, referralId, userId, { ...input, signatureSha256: "b".repeat(64) }));
});

test("generates an encrypted PDF whose plaintext clinical values are not exposed", async () => {
  const signature = fs.readFileSync(path.join(__dirname, "../../../react-user-dashboard/src/assets/event-covers/event-operations.jpg"));
  const pdf = await generateReferralPdf({
    referral: referralFixture(),
    signature,
    password: "45679876",
    version: 1,
    generatedAt: new Date("2026-08-04T08:00:00.000Z"),
  });
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  assert.match(pdf.toString("latin1"), /\/Encrypt\b/);
  assert.equal(pdf.includes(Buffer.from("Alicia Lim")), false);
  assert.equal(pdf.includes(Buffer.from("45679876")), false);

  const raw = buildRawEmail({
    from: "referrals@example.com",
    to: "clinic@example.com",
    subject: "Encrypted referral",
    body: "Use the separately known password.",
    attachment: pdf,
    filename: "referral.pdf",
  });
  assert.match(raw, /Content-Type: application\/pdf/);
  assert.equal(raw.includes("45679876"), false);
});

test("uses the VSMS report palette and formats clinical results without JSON", () => {
  assert.deepEqual(PDF_COLORS, {
    navy: "#172233",
    blue: "#315a8c",
    ink: "#17191c",
    secondary: "#4f545b",
    line: "#d9dde3",
    surface: "#f7f8fa",
    white: "#ffffff",
  });
  const summary = resultSummary({
    chartDistanceMetres: 6,
    od: { kind: "FRACTION", denominator: 18 },
    os: { kind: "EXCEPTION", code: "NOT_TESTABLE" },
    withUsualDistanceGlasses: true,
  });
  assert.match(summary, /Chart distance: 6 m/);
  assert.match(summary, /Right eye \(OD\): 6\/18/);
  assert.match(summary, /Left eye \(OS\): NOT TESTABLE/);
  assert.match(summary, /Usual distance glasses: Yes/);
  assert.doesNotMatch(summary, /[{}"]|kind|denominator/);
  assert.equal(Object.values(PDF_COLORS).includes("#173f36"), false);
});

test("encrypts delivery recipients with an authenticated, non-deterministic cipher", () => {
  const context = encryptionContext("NotificationDelivery", crypto.randomUUID(), "recipient");
  const first = encrypt("clinic@example.com", context);
  const second = encrypt("clinic@example.com", context);
  assert.notEqual(first, second);
  assert.equal(decrypt(first, context), "clinic@example.com");
  assert.throws(() => decrypt(first, encryptionContext("NotificationDelivery", crypto.randomUUID(), "recipient")));
  assert.throws(() => decrypt(`${first.slice(0, -1)}${first.endsWith("0") ? "1" : "0"}`, context));
});

test("decrypts old and new ciphertext across a key rotation", () => {
  const oldKey = crypto.randomBytes(32).toString("hex");
  const newKey = crypto.randomBytes(32).toString("hex");
  const keyring = { old: oldKey, current: newKey };
  const context = encryptionContext("NotificationDelivery", crypto.randomUUID(), "recipient");
  const beforeRotation = encryptWithKeyring("clinic@example.com", context, "old", keyring);
  const afterRotation = encryptWithKeyring("clinic@example.com", context, "current", keyring);
  assert.match(beforeRotation, /^v2:old:/);
  assert.match(afterRotation, /^v2:current:/);
  assert.equal(decryptWithKeyring(beforeRotation, context, keyring), "clinic@example.com");
  assert.equal(decryptWithKeyring(afterRotation, context, keyring), "clinic@example.com");

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", Buffer.from(oldKey, "hex"), iv);
  const ciphertext = Buffer.concat([cipher.update("legacy@example.com", "utf8"), cipher.final()]);
  const legacy = `${iv.toString("hex")}:${cipher.getAuthTag().toString("hex")}:${ciphertext.toString("hex")}`;
  assert.equal(decryptWithKeyring(legacy, context, keyring, [oldKey]), "legacy@example.com");
});

test("recovers an encrypted passphrase only before acknowledgement or expiry", async (t) => {
  const deliveryId = crypto.randomUUID();
  const active = {
    id: deliveryId,
    handoffSecretCiphertext: encrypt("random-passphrase", encryptionContext("NotificationDelivery", deliveryId, "handoffSecret")),
    handoffSecretExpiresAt: new Date(Date.now() + 60_000),
    handoffSecretAcknowledgedAt: null,
  };
  assert.equal(await recoverHandoffSecret(active), "random-passphrase");
  assert.equal(await recoverHandoffSecret({ ...active, handoffSecretAcknowledgedAt: new Date() }), null);

  let cleared = false;
  replace(t, prisma.notificationDelivery, "updateMany", async ({ data }) => {
    cleared = data.handoffSecretCiphertext === null;
    return { count: 1 };
  });
  assert.equal(await recoverHandoffSecret({ ...active, handoffSecretExpiresAt: new Date(Date.now() - 1) }), null);
  assert.equal(cleared, true);
});

test("binds stored signatures to their user, event, and purpose", async (t) => {
  const root = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "vsms-signature-"));
  const priorRoot = process.env.SIGNATURE_STORAGE_DIR;
  process.env.SIGNATURE_STORAGE_DIR = root;
  t.after(() => {
    if (priorRoot === undefined) delete process.env.SIGNATURE_STORAGE_DIR;
    else process.env.SIGNATURE_STORAGE_DIR = priorRoot;
    fs.rmSync(root, { recursive: true, force: true });
  });

  const userId = crypto.randomUUID();
  const eventId = crypto.randomUUID();
  const image = Buffer.alloc(128);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(image);
  const stored = await storeSignature(image, "image/png", userId, eventId, "CONSENT");
  assert.deepEqual(await loadVerifiedSignature(stored, userId, eventId, "CONSENT"), image);
  await assert.rejects(
    loadVerifiedSignature(stored, userId, eventId, "REFERRAL"),
    (error) => error.status === 422 && error.code === "INVALID_SIGNATURE",
  );

  const reviewSignature = await storeSignature(image, "image/png", userId, eventId, "REVIEW_DECISION");
  assert.match(reviewSignature.signatureObjectKey, /\/review-decision-/);
  assert.deepEqual(
    await loadVerifiedSignature(reviewSignature, userId, eventId, "REVIEW_DECISION"),
    image,
  );
  for (const [owner, purpose, signature] of [
    [crypto.randomUUID(), "REVIEW_DECISION", reviewSignature],
    [userId, "REFERRAL", reviewSignature],
    [userId, "REVIEW_DECISION", { ...reviewSignature, signatureSha256: "0".repeat(64) }],
  ]) {
    await assert.rejects(
      loadVerifiedSignature(signature, owner, eventId, purpose),
      (error) => error.status === 422 && error.code === "INVALID_SIGNATURE",
    );
  }
});

test("consumes a signature artifact once and only for its bound target", async () => {
  const userId = crypto.randomUUID();
  const eventId = crypto.randomUUID();
  const targetId = crypto.randomUUID();
  const signature = { signatureObjectKey: "signatures/key", signatureSha256: "a".repeat(64), signatureMimeType: "image/png" };
  let consumed = false;
  const db = { signatureArtifact: { updateMany: async ({ where }) => {
    const matches = !consumed
      && where.signatureObjectKey === signature.signatureObjectKey
      && where.signatureSha256 === signature.signatureSha256
      && where.signatureMimeType === signature.signatureMimeType
      && where.userId === userId
      && where.eventId === eventId
      && where.purpose === "REFERRAL"
      && where.targetId === targetId
      && where.consumedAt === null;
    if (matches) consumed = true;
    return { count: matches ? 1 : 0 };
  } } };

  await assert.rejects(
    consumeSignatureArtifact(db, signature, userId, eventId, "REFERRAL", crypto.randomUUID()),
    (error) => error.status === 409 && error.code === "SIGNATURE_ALREADY_USED",
  );
  await consumeSignatureArtifact(db, signature, userId, eventId, "REFERRAL", targetId);
  await assert.rejects(
    consumeSignatureArtifact(db, signature, userId, eventId, "REFERRAL", targetId),
    (error) => error.status === 409 && error.code === "SIGNATURE_ALREADY_USED",
  );
});

test("referral issuance rejects a user other than the original reviewer", async (t) => {
  const referral = referralFixture();
  referral.status = "DRAFT";
  referral.review.registration.event.status = "IN_PROGRESS";
  replace(t, prisma.notificationDelivery, "findUnique", async () => null);
  replace(t, prisma.referral, "findFirst", async () => referral);
  await assert.rejects(
    issueReferral(crypto.randomUUID(), referral.referralId, { idempotencyKey: crypto.randomUUID() }, { userId: crypto.randomUUID() }),
    (error) => error.status === 403 && error.code === "REFERRAL_REVIEWER_REQUIRED",
  );
});

test("idempotent issuance replay returns the existing artifact and delivery", async (t) => {
  const referralId = crypto.randomUUID();
  const documentId = crypto.randomUUID();
  const reviewerId = crypto.randomUUID();
  const eventId = crypto.randomUUID();
  const deliveryId = crypto.randomUUID();
  const input = {
    destinationEmail: "clinic@example.com",
    signatureObjectKey: `signatures/${reviewerId}/referral-${eventId}-${crypto.randomUUID()}.png`,
    signatureSha256: "a".repeat(64),
    signatureMimeType: "image/png",
    idempotencyKey: crypto.randomUUID(),
    confirmed: true,
  };
  const referral = referralFixture();
  referral.referralId = referralId;
  referral.status = "SENT";
  referral.review.reviewedByUserId = reviewerId;
  installReviewerMembership(t, eventId, reviewerId);
  replace(t, prisma.referral, "findFirst", async () => referral);
  replace(t, prisma.event, "findUnique", async () => ({ eventId: crypto.randomUUID(), name: "Live", venue: "Hall", timezone: "Asia/Singapore", status: "IN_PROGRESS" }));
  replace(t, prisma.staffAssignment, "findFirst", async () => ({ id: crypto.randomUUID() }));
  replace(t, prisma.notificationDelivery, "findUnique", async () => ({
    id: deliveryId,
    userId: reviewerId,
    referralId,
    documentId,
    status: "SENT",
    recipient: "c***@example.com",
    providerMessageId: "ses-message",
    attemptCount: 1,
    failureReason: null,
    sentAt: new Date(),
    requestFingerprint: referralIssueFingerprint(eventId, referralId, reviewerId, input),
    handoffSecretCiphertext: encrypt("recovery-secret", encryptionContext("NotificationDelivery", deliveryId, "handoffSecret")),
    handoffSecretExpiresAt: new Date(Date.now() + 60_000),
    handoffSecretAcknowledgedAt: null,
    document: { version: 1 },
  }));
  const result = await issueReferral(
    eventId,
    referralId,
    input,
    reviewerUser(reviewerId),
  );
  assert.equal(result.documentId, documentId);
  assert.equal(result.status, "SENT");
  assert.equal(result.delivery.status, "SENT");
  assert.equal(result.handoffSecret, "recovery-secret");
});

test("does not retry a delivery left SENDING after an ambiguous provider response", async (t) => {
  const delivery = { id: crypto.randomUUID(), status: "SENDING", document: null };
  let claims = 0;
  replace(t, prisma.notificationDelivery, "findUnique", async () => delivery);
  replace(t, prisma.notificationDelivery, "updateMany", async () => { claims += 1; return { count: 1 }; });
  const resumed = await resumeQueuedDelivery(crypto.randomUUID(), crypto.randomUUID(), delivery.id, { userId: crypto.randomUUID() });
  assert.equal(resumed, delivery);
  assert.equal(claims, 0);
});

test("maintenance clears expired escrow and moves stale sends to reconciliation without resending", async () => {
  const delivery = { id: crypto.randomUUID(), referralId: crypto.randomUUID(), documentId: crypto.randomUUID() };
  const writes = [];
  const tx = {
    notificationDelivery: {
      findMany: async () => [delivery],
      updateMany: async (args) => {
        writes.push(args);
        return { count: 1 };
      },
    },
    auditLog: { create: async () => ({}) },
  };
  const db = { $transaction: async (work) => work(tx) };
  const result = await reconcileReferralDeliveries(
    { staleAfterMinutes: 30, resolutions: [] },
    { userId: crypto.randomUUID(), roles: ["ADMINISTRATOR"] },
    "127.0.0.1",
    db,
    new Date("2026-08-04T12:00:00.000Z"),
  );
  assert.deepEqual(result, { expiredEscrowsCleared: 1, ambiguousDeliveriesFlagged: 1, deliveriesReconciled: 0, deliveriesRetryAuthorized: 0 });
  assert.ok(writes.some(({ data }) => data.handoffSecretCiphertext === null));
  assert.ok(writes.some(({ data }) => data.status === "RECONCILIATION_REQUIRED"));
});

test("maintenance records provider-confirmed delivery exactly once without invoking a send", async () => {
  const delivery = {
    id: crypto.randomUUID(),
    referralId: crypto.randomUUID(),
    documentId: crypto.randomUUID(),
    status: "RECONCILIATION_REQUIRED",
  };
  const writes = [];
  let referralUpdates = 0;
  const tx = {
    notificationDelivery: {
      findMany: async () => [],
      findUnique: async () => delivery,
      updateMany: async (args) => {
        writes.push(args);
        return { count: args.data.handoffSecretCiphertext === null ? 0 : 1 };
      },
    },
    referral: { updateMany: async () => { referralUpdates += 1; return { count: 1 }; } },
    auditLog: { create: async () => ({}) },
  };
  const db = { $transaction: async (work) => work(tx) };
  const result = await reconcileReferralDeliveries(
    { staleAfterMinutes: 30, resolutions: [{ deliveryId: delivery.id, outcome: "SENT", providerMessageId: "ses-confirmed-id" }] },
    { userId: crypto.randomUUID(), roles: ["ADMINISTRATOR"] },
    "127.0.0.1",
    db,
    new Date("2026-08-04T12:00:00.000Z"),
  );
  assert.equal(result.deliveriesReconciled, 1);
  assert.ok(writes.some(({ data }) => data.status === "SENT" && data.providerMessageId === "ses-confirmed-id"));
  assert.equal(referralUpdates, 1);
});

test("only an administrator can requeue a provider-confirmed unsent delivery without changing issuance identity", async () => {
  const delivery = {
    id: crypto.randomUUID(),
    referralId: crypto.randomUUID(),
    documentId: crypto.randomUUID(),
    status: "FAILED",
    failureReason: "PROVIDER_CONFIRMED_NOT_SENT",
    idempotencyKey: crypto.randomUUID(),
    requestFingerprint: crypto.randomBytes(32).toString("hex"),
  };
  let retryWrite;
  const tx = {
    notificationDelivery: {
      findMany: async () => [],
      findUnique: async () => delivery,
      updateMany: async (args) => {
        if (args.data.status === "QUEUED") retryWrite = args;
        return { count: args.data.handoffSecretCiphertext === null ? 0 : 1 };
      },
    },
    auditLog: { create: async () => ({}) },
  };
  const db = { $transaction: async (work) => work(tx) };
  await assert.rejects(
    reconcileReferralDeliveries(
      { staleAfterMinutes: 30, resolutions: [], retryDeliveryIds: [delivery.id] },
      { userId: crypto.randomUUID(), roles: ["SUPPORT"] },
      "127.0.0.1",
      db,
    ),
    (error) => error.status === 403 && error.code === "ADMINISTRATOR_REQUIRED",
  );

  const result = await reconcileReferralDeliveries(
    { staleAfterMinutes: 30, resolutions: [], retryDeliveryIds: [delivery.id] },
    { userId: crypto.randomUUID(), roles: ["ADMINISTRATOR"] },
    "127.0.0.1",
    db,
  );
  assert.equal(result.deliveriesRetryAuthorized, 1);
  assert.deepEqual(retryWrite.where, {
    id: delivery.id,
    status: "FAILED",
    failureReason: "PROVIDER_CONFIRMED_NOT_SENT",
  });
  assert.equal(retryWrite.data.status, "QUEUED");
  for (const immutableField of ["idempotencyKey", "requestFingerprint", "documentId", "referralId"]) {
    assert.equal(Object.hasOwn(retryWrite.data, immutableField), false);
  }
});

test("an ambiguous referral send cannot be requeued", async () => {
  const delivery = {
    id: crypto.randomUUID(),
    referralId: crypto.randomUUID(),
    documentId: crypto.randomUUID(),
    status: "RECONCILIATION_REQUIRED",
    failureReason: "DELIVERY_CONFIRMATION_PENDING",
  };
  const tx = {
    notificationDelivery: {
      findMany: async () => [],
      findUnique: async () => delivery,
      updateMany: async ({ data }) => ({ count: data.handoffSecretCiphertext === null ? 0 : 1 }),
    },
    auditLog: { create: async () => ({}) },
  };
  await assert.rejects(
    reconcileReferralDeliveries(
      { staleAfterMinutes: 30, resolutions: [], retryDeliveryIds: [delivery.id] },
      { userId: crypto.randomUUID(), roles: ["ADMINISTRATOR"] },
      "127.0.0.1",
      { $transaction: async (work) => work(tx) },
    ),
    (error) => error.status === 409 && error.code === "DELIVERY_RETRY_NOT_ALLOWED",
  );
});

test("acknowledging the secure handoff permanently clears its escrow", async (t) => {
  const eventId = crypto.randomUUID();
  const referral = referralFixture();
  referral.status = "SENT";
  const reviewerId = referral.review.reviewedByUserId;
  installReviewerMembership(t, eventId, reviewerId);
  const delivery = { id: crypto.randomUUID(), referralId: referral.referralId, userId: reviewerId, idempotencyKey: crypto.randomUUID(), handoffSecretAcknowledgedAt: null };
  let update;
  replace(t, prisma.referral, "findFirst", async () => referral);
  replace(t, prisma.event, "findUnique", async () => ({ eventId, status: "IN_PROGRESS" }));
  replace(t, prisma.staffAssignment, "findFirst", async () => ({ id: crypto.randomUUID() }));
  replace(t, prisma.notificationDelivery, "findUnique", async () => delivery);
  replace(t, prisma, "$transaction", async (callback) => callback({
    notificationDelivery: { updateMany: async (args) => { update = args; return { count: 1 }; } },
    auditLog: { create: async () => ({}) },
  }));
  const result = await acknowledgeReferralHandoff(eventId, referral.referralId, { idempotencyKey: delivery.idempotencyKey }, reviewerUser(reviewerId));
  assert.ok(result.acknowledgedAt);
  assert.equal(update.data.handoffSecretCiphertext, null);
  assert.ok(update.data.handoffSecretAcknowledgedAt);
});

test("creates an immutable sequential referral revision for the issuing reviewer", async (t) => {
  const eventId = crypto.randomUUID();
  const reviewerId = crypto.randomUUID();
  const source = referralFixture();
  source.status = "SENT";
  source.revisionNumber = 1;
  source.supersedesReferralId = null;
  source.review.reviewedByUserId = reviewerId;
  installReviewerMembership(t, eventId, reviewerId);
  const input = {
    destinationName: "Community Eye Clinic",
    reason: "Updated destination requested after clinical review.",
    instructions: "Arrange a specialist appointment within one week.",
    urgency: "URGENT",
    idempotencyKey: crypto.randomUUID(),
    confirmed: true,
  };
  replace(t, prisma.referral, "findFirst", async () => source);
  replace(t, prisma.referral, "findUnique", async () => null);
  replace(t, prisma.event, "findUnique", async () => ({ eventId, status: "IN_PROGRESS" }));
  replace(t, prisma.staffAssignment, "findFirst", async () => ({ id: crypto.randomUUID() }));
  let createdData;
  let audit;
  replace(t, prisma, "$transaction", async (work) => work({
    referral: {
      findUnique: async () => null,
      create: async ({ data }) => {
        createdData = data;
        return { referralId: crypto.randomUUID(), ...data };
      },
    },
    auditLog: { create: async ({ data }) => { audit = data; return data; } },
  }));
  const result = await createReferralRevision(eventId, source.referralId, input, reviewerUser(reviewerId), "127.0.0.1");
  assert.equal(result.revisionNumber, 2);
  assert.equal(result.supersedesReferralId, source.referralId);
  assert.equal(result.status, "DRAFT");
  assert.equal(createdData.revisionRequestFingerprint, referralRevisionFingerprint(eventId, source.referralId, reviewerId, input));
  assert.equal(audit.action, "REFERRAL_REVISION_CREATED");
  assert.deepEqual(audit.details, {
    eventId,
    reviewId: source.reviewId,
    supersedesReferralId: source.referralId,
    revisionNumber: 2,
  });
});

test("does not allow another reviewer or an administrator without event reviewer membership to revise a referral", async (t) => {
  const source = referralFixture();
  source.status = "SENT";
  source.revisionNumber = 1;
  replace(t, prisma.referral, "findFirst", async () => source);
  const input = {
    destinationName: source.destinationName,
    reason: source.reason,
    urgency: "PRIORITY",
    idempotencyKey: crypto.randomUUID(),
    confirmed: true,
  };
  await assert.rejects(
    createReferralRevision(crypto.randomUUID(), source.referralId, input, { userId: crypto.randomUUID(), roles: ["REVIEWER"] }),
    (error) => error.status === 403 && error.code === "REFERRAL_REVIEWER_REQUIRED",
  );
  replace(t, prisma.event, "findUnique", async ({ where }) => ({ eventId: where.eventId, status: "IN_PROGRESS" }));
  replace(t, prisma.eventMembership, "findFirst", async () => null);
  await assert.rejects(
    createReferralRevision(crypto.randomUUID(), source.referralId, input, reviewerUser(source.review.reviewedByUserId, ["ADMINISTRATOR", "REVIEWER"])),
    (error) => error.status === 403 && error.code === "EVENT_ROLE_REQUIRED",
  );
});
