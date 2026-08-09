const crypto = require("node:crypto");
const { SNSClient, ConfirmSubscriptionCommand } = require("@aws-sdk/client-sns");
const AppError = require("../../errors/AppError");
const env = require("../../config/env");

const MAX_CERTIFICATE_BYTES = 64 * 1024;
const certificateCache = new Map();

const parseTopicArn = (topicArn) => {
  const match = /^arn:(aws|aws-us-gov|aws-cn):sns:([a-z0-9-]+):(\d{12}):([A-Za-z0-9_.-]{1,256})$/.exec(topicArn || "");
  if (!match) throw new AppError(403, "SNS_TOPIC_REJECTED", "Provider topic is not authorized");
  return { partition: match[1], region: match[2] };
};

const expectedSnsHostname = ({ partition, region }) => partition === "aws-cn"
  ? `sns.${region}.amazonaws.com.cn`
  : `sns.${region}.amazonaws.com`;

const validateAwsSnsUrl = (value, topicArn, { certificate = false } = {}) => {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new AppError(403, "SNS_ORIGIN_REJECTED", "Provider origin is not authorized");
  }
  const topic = parseTopicArn(topicArn);
  const expectedHostname = expectedSnsHostname(topic);
  const validCertificatePath = /^\/SimpleNotificationService-[A-Za-z0-9_-]+\.pem$/.test(url.pathname);
  const validConfirmationPath = url.pathname === "/" || url.pathname === "/confirmation.html";
  if (
    url.protocol !== "https:"
    || url.hostname !== expectedHostname
    || url.port
    || url.username
    || url.password
    || url.hash
    || (certificate ? (!validCertificatePath || url.search) : !validConfirmationPath)
  ) {
    throw new AppError(403, "SNS_ORIGIN_REJECTED", "Provider origin is not authorized");
  }
  return url;
};

const canonicalSnsMessage = (message) => {
  const fields = message.Type === "Notification"
    ? ["Message", "MessageId", ...(message.Subject ? ["Subject"] : []), "Timestamp", "TopicArn", "Type"]
    : ["Message", "MessageId", "SubscribeURL", "Timestamp", "Token", "TopicArn", "Type"];
  return fields.map((field) => `${field}\n${message[field]}\n`).join("");
};

const parseEnvelope = (rawBody) => {
  if (typeof rawBody !== "string" || !rawBody.length) throw new AppError(400, "INVALID_PROVIDER_EVENT", "Provider event body is required");
  let message;
  try {
    message = JSON.parse(rawBody);
  } catch {
    throw new AppError(400, "INVALID_PROVIDER_EVENT", "Provider event body must be valid JSON");
  }
  if (!message || Array.isArray(message) || typeof message !== "object") throw new AppError(400, "INVALID_PROVIDER_EVENT", "Provider event body must be an object");
  if (!["Notification", "SubscriptionConfirmation", "UnsubscribeConfirmation"].includes(message.Type)) throw new AppError(400, "INVALID_PROVIDER_EVENT", "Provider event type is not supported");
  const required = ["Message", "MessageId", "Timestamp", "TopicArn", "SignatureVersion", "Signature", "SigningCertURL"];
  if (message.Type !== "Notification") required.push("SubscribeURL", "Token");
  if (required.some((field) => typeof message[field] !== "string" || !message[field])) throw new AppError(400, "INVALID_PROVIDER_EVENT", "Provider event is incomplete");
  if (!/^[A-Za-z0-9_-]{1,255}$/.test(message.MessageId)) throw new AppError(400, "INVALID_PROVIDER_EVENT", "Provider event identifier is invalid");
  if (!Number.isFinite(Date.parse(message.Timestamp))) throw new AppError(400, "INVALID_PROVIDER_EVENT", "Provider event timestamp is invalid");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(message.Signature)) throw new AppError(400, "INVALID_PROVIDER_EVENT", "Provider signature is invalid");
  return message;
};

const fetchSigningCertificate = async (certificateUrl) => {
  const cached = certificateCache.get(certificateUrl.href);
  if (cached && cached.expiresAt > Date.now()) return cached.publicKey;
  let response;
  try {
    response = await fetch(certificateUrl, { redirect: "error", signal: AbortSignal.timeout(5_000) });
  } catch {
    throw new AppError(503, "SNS_CERTIFICATE_UNAVAILABLE", "Provider certificate could not be loaded");
  }
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (!response.ok || (declaredLength && declaredLength > MAX_CERTIFICATE_BYTES)) throw new AppError(503, "SNS_CERTIFICATE_UNAVAILABLE", "Provider certificate could not be loaded");
  const pem = await response.text();
  if (Buffer.byteLength(pem) > MAX_CERTIFICATE_BYTES) throw new AppError(503, "SNS_CERTIFICATE_UNAVAILABLE", "Provider certificate could not be loaded");
  let certificate;
  try {
    certificate = new crypto.X509Certificate(pem);
  } catch {
    throw new AppError(503, "SNS_CERTIFICATE_INVALID", "Provider certificate is invalid");
  }
  const now = Date.now();
  const validFrom = Date.parse(certificate.validFrom);
  const validTo = Date.parse(certificate.validTo);
  if (!Number.isFinite(validFrom) || !Number.isFinite(validTo) || now < validFrom || now > validTo) throw new AppError(503, "SNS_CERTIFICATE_INVALID", "Provider certificate is not valid now");
  const expiresAt = Math.min(validTo, now + 60 * 60 * 1000);
  certificateCache.set(certificateUrl.href, { publicKey: certificate.publicKey, expiresAt });
  return certificate.publicKey;
};

const verifySnsMessage = async (rawBody, options = {}) => {
  const message = parseEnvelope(rawBody);
  const topicArns = options.topicArns || env.sesSnsTopicArns;
  if (!topicArns?.includes(message.TopicArn)) throw new AppError(403, "SNS_TOPIC_REJECTED", "Provider topic is not authorized");
  const certificateUrl = validateAwsSnsUrl(message.SigningCertURL, message.TopicArn, { certificate: true });
  if (message.Type !== "Notification") validateAwsSnsUrl(message.SubscribeURL, message.TopicArn);
  const algorithm = message.SignatureVersion === "1" ? "RSA-SHA1" : message.SignatureVersion === "2" ? "RSA-SHA256" : null;
  if (!algorithm) throw new AppError(403, "SNS_SIGNATURE_VERSION_REJECTED", "Provider signature version is not supported");
  const publicKey = await (options.certificateLoader || fetchSigningCertificate)(certificateUrl, message);
  let verified = false;
  try {
    verified = crypto.verify(
      algorithm,
      Buffer.from(canonicalSnsMessage(message), "utf8"),
      publicKey,
      Buffer.from(message.Signature, "base64"),
    );
  } catch {
    verified = false;
  }
  if (!verified) throw new AppError(403, "SNS_SIGNATURE_REJECTED", "Provider signature could not be verified");
  return message;
};

const confirmSnsSubscription = async (message, options = {}) => {
  validateAwsSnsUrl(message.SubscribeURL, message.TopicArn);
  const { region } = parseTopicArn(message.TopicArn);
  const client = options.client || new SNSClient({ region });
  const result = await client.send(new ConfirmSubscriptionCommand({
    TopicArn: message.TopicArn,
    Token: message.Token,
    AuthenticateOnUnsubscribe: "true",
  }));
  return { subscriptionArn: result.SubscriptionArn || null };
};

module.exports = {
  canonicalSnsMessage,
  parseEnvelope,
  parseTopicArn,
  validateAwsSnsUrl,
  fetchSigningCertificate,
  verifySnsMessage,
  confirmSnsSubscription,
};
