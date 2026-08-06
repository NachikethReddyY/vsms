const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const request = require("supertest");
const app = require("../../app");
const {
  canonicalSnsMessage,
  validateAwsSnsUrl,
  verifySnsMessage,
  confirmSnsSubscription,
} = require("../../services/snsMessageService");
const {
  parseSesEvent,
  recordProviderEvent,
} = require("../../services/sesProviderEventService");

const TOPIC_ARN = "arn:aws:sns:us-east-1:123456789012:vsms-ses-events";
const CERT_URL = "https://sns.us-east-1.amazonaws.com/SimpleNotificationService-test.pem";

const signedEnvelope = (privateKey, overrides = {}) => {
  const message = {
    Type: "Notification",
    MessageId: crypto.randomUUID(),
    TopicArn: TOPIC_ARN,
    Message: JSON.stringify({ eventType: "Delivery", mail: { messageId: "ses-provider-id" }, delivery: { timestamp: "2026-08-04T12:00:00.000Z" } }),
    Timestamp: "2026-08-04T12:00:00.000Z",
    SignatureVersion: "2",
    SigningCertURL: CERT_URL,
    ...overrides,
  };
  message.Signature = crypto.sign("RSA-SHA256", Buffer.from(canonicalSnsMessage(message)), privateKey).toString("base64");
  return message;
};

test("verifies an allowlisted SNS envelope using the canonical signed fields", async () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const message = signedEnvelope(privateKey);
  const verified = await verifySnsMessage(JSON.stringify(message), {
    topicArns: [TOPIC_ARN],
    certificateLoader: async (url) => {
      assert.equal(url.href, CERT_URL);
      return publicKey;
    },
  });
  assert.equal(verified.MessageId, message.MessageId);

  message.Message = JSON.stringify({ eventType: "Complaint", mail: { messageId: "ses-provider-id" } });
  await assert.rejects(
    verifySnsMessage(JSON.stringify(message), { topicArns: [TOPIC_ARN], certificateLoader: async () => publicKey }),
    (error) => error.status === 403 && error.code === "SNS_SIGNATURE_REJECTED",
  );
});

test("rejects SNS certificate and confirmation URLs outside the topic region", () => {
  assert.throws(
    () => validateAwsSnsUrl("https://example.com/SimpleNotificationService-test.pem", TOPIC_ARN, { certificate: true }),
    (error) => error.status === 403 && error.code === "SNS_ORIGIN_REJECTED",
  );
  assert.throws(
    () => validateAwsSnsUrl("https://sns.eu-west-1.amazonaws.com/confirmation.html", TOPIC_ARN),
    (error) => error.status === 403 && error.code === "SNS_ORIGIN_REJECTED",
  );
});

test("confirms a signed SNS subscription with authenticated unsubscribe enabled", async () => {
  let command;
  const result = await confirmSnsSubscription({
    TopicArn: TOPIC_ARN,
    Token: "signed-subscription-token",
    SubscribeURL: "https://sns.us-east-1.amazonaws.com/confirmation.html?TopicArn=allowed",
  }, { client: { send: async (value) => { command = value; return { SubscriptionArn: "arn:subscription" }; } } });
  assert.equal(command.input.TopicArn, TOPIC_ARN);
  assert.equal(command.input.Token, "signed-subscription-token");
  assert.equal(command.input.AuthenticateOnUnsubscribe, "true");
  assert.equal(result.subscriptionArn, "arn:subscription");
});

test("maps SES lifecycle records without retaining recipient or diagnostic content", () => {
  const bounce = parseSesEvent({ Message: JSON.stringify({
    notificationType: "Bounce",
    mail: { messageId: "provider-id", destination: ["private@example.com"] },
    bounce: { bounceType: "Permanent", bouncedRecipients: [{ emailAddress: "private@example.com", diagnosticCode: "private diagnostic" }] },
  }) });
  assert.deepEqual(bounce, {
    eventType: "BOUNCE",
    providerMessageId: "provider-id",
    targetStatus: "BOUNCED",
    failureReason: "SES_BOUNCE_PERMANENT",
    deliveredAt: null,
  });
  assert.equal(JSON.stringify(bounce).includes("private@example.com"), false);
  assert.equal(parseSesEvent({ Message: JSON.stringify({ eventType: "Complaint", mail: { messageId: "provider-id" } }) }).targetStatus, "COMPLAINT");
  assert.equal(parseSesEvent({ Message: JSON.stringify({ eventType: "Rendering Failure", mail: { messageId: "provider-id" } }) }).targetStatus, "FAILED");
});

test("applies a provider lifecycle event once and writes a leak-free audit", async () => {
  const deliveryId = crypto.randomUUID();
  const referralId = crypto.randomUUID();
  const documentId = crypto.randomUUID();
  const providerEventId = crypto.randomUUID();
  const writes = [];
  let audit;
  const tx = {
    providerEventReceipt: {
      create: async ({ data }) => ({ id: crypto.randomUUID(), ...data }),
      update: async ({ data }) => { writes.push({ receipt: data }); return data; },
    },
    notificationDelivery: {
      findMany: async () => [{ id: deliveryId, referralId, documentId, status: "SENT" }],
      updateMany: async ({ data }) => { writes.push({ delivery: data }); return { count: 1 }; },
    },
    auditLog: { create: async ({ data }) => { audit = data; return data; } },
  };
  const result = await recordProviderEvent(
    { MessageId: providerEventId },
    { eventType: "COMPLAINT", providerMessageId: "ses-provider-id", targetStatus: "COMPLAINT", failureReason: "SES_COMPLAINT", deliveredAt: null },
    { $transaction: async (work) => work(tx) },
  );
  assert.deepEqual(result, { accepted: true, duplicate: false, matched: true, appliedStatus: "COMPLAINT" });
  assert.ok(writes.some((write) => write.delivery?.status === "COMPLAINT"));
  const auditJson = JSON.stringify(audit);
  assert.equal(auditJson.includes("ses-provider-id"), false);
  assert.equal(auditJson.includes("recipient"), false);
  assert.equal(auditJson.includes("body"), false);
});

test("treats a repeated SNS MessageId as an idempotent replay", async () => {
  const result = await recordProviderEvent(
    { MessageId: crypto.randomUUID() },
    { eventType: "DELIVERY", providerMessageId: "provider-id", targetStatus: "DELIVERED", failureReason: null, deliveredAt: new Date() },
    { $transaction: async () => { const error = new Error("unique"); error.code = "P2002"; throw error; } },
  );
  assert.deepEqual(result, { accepted: true, duplicate: true, matched: null, appliedStatus: null });
});

test("mounts the provider callback outside browser CSRF while failing closed on an unauthorized topic", async () => {
  const response = await request(app)
    .post("/api/v1/webhooks/ses")
    .set("Content-Type", "application/json")
    .set("x-amz-sns-message-type", "Notification")
    .send(JSON.stringify({
      Type: "Notification",
      MessageId: crypto.randomUUID(),
      TopicArn: TOPIC_ARN,
      Message: "{}",
      Timestamp: new Date().toISOString(),
      SignatureVersion: "2",
      Signature: "YQ==",
      SigningCertURL: CERT_URL,
    }));
  assert.equal(response.status, 403);
  assert.equal(response.body.code, "SNS_TOPIC_REJECTED");
  assert.notEqual(response.body.code, "CSRF_TOKEN_INVALID");
});
