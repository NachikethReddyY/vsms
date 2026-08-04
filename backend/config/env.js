const crypto = require("crypto");
const { z } = require("zod");
require("dotenv").config();

const optionalEnv = (schema) => z.preprocess((value) => value === "" ? undefined : value, schema.optional());
const httpsUrl = z.string().url().refine((value) => new URL(value).protocol === "https:", "must use HTTPS");
const httpsOrigins = z.string().refine((value) => value.split(",").every((origin) => {
  try {
    return new URL(origin.trim()).protocol === "https:";
  } catch {
    return false;
  }
}), "must contain only HTTPS origins");
const localHostnames = new Set(["localhost", "127.0.0.1", "::1"]);
const snsTopicArn = /^arn:(aws|aws-us-gov|aws-cn):sns:[a-z0-9-]+:\d{12}:[A-Za-z0-9_.-]{1,256}$/;

const resolvePublicAppOrigin = (value, nodeEnv) => {
  if (!value && nodeEnv === "production") {
    throw new Error("PUBLIC_APP_ORIGIN is required in production");
  }

  let url;
  try {
    url = new URL(value || "https://localhost:5173");
  } catch {
    throw new Error("PUBLIC_APP_ORIGIN must be an absolute URL");
  }

  const isLocal = localHostnames.has(url.hostname.toLowerCase());
  const allowsLocalHttp = nodeEnv === "development" && isLocal && url.protocol === "http:";
  if (url.protocol !== "https:" && !allowsLocalHttp) {
    throw new Error("PUBLIC_APP_ORIGIN must use HTTPS outside local development");
  }
  if (nodeEnv === "production" && isLocal) {
    throw new Error("PUBLIC_APP_ORIGIN must not target a local host in production");
  }
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("PUBLIC_APP_ORIGIN must be a bare origin without credentials, path, query, or fragment");
  }
  return url.origin;
};

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOCAL_HTTPS: z.enum(["true", "false"]).default("true"),
  HOST: z.enum(["127.0.0.1", "0.0.0.0"]).default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65535).default(5000),
  DATABASE_URL: z.string().url(),
  JWT_ACCESS_SECRET: z.string().min(32).optional(),
  JWT_ISSUER: z.string().min(1).default("vsms-api"),
  JWT_AUDIENCE: z.string().min(1).default("vsms-dashboard"),
  ACCESS_TOKEN_TTL: z.string().default("15m"),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(7),
  PUBLIC_SIGNUP_ENABLED: z.enum(["true", "false"]).default("false"),
  CORS_ORIGINS: httpsOrigins.default("https://localhost:5173"),
  CORS_ORIGIN: optionalEnv(httpsOrigins),
  PUBLIC_APP_ORIGIN: optionalEnv(z.string().url()),
  TRUST_PROXY: z.enum(["true", "false"]).default("false"),
  TLS_KEY_PATH: z.string().default("../react-user-dashboard/certs/localhost-key.pem"),
  TLS_CERT_PATH: z.string().default("../react-user-dashboard/certs/localhost.pem"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error", "silent"]).optional(),
  ONEMAP_BASE_URL: z.string().url().default("https://www.onemap.gov.sg"),
  ONEMAP_API_EMAIL: optionalEnv(z.string().email()),
  ONEMAP_API_PASSWORD: optionalEnv(z.string().min(1)),
  COGNITO_DOMAIN: optionalEnv(httpsUrl),
  COGNITO_REGION: optionalEnv(z.string().min(1)),
  COGNITO_USER_POOL_ID: optionalEnv(z.string().min(1)),
  COGNITO_REDIRECT_URI: optionalEnv(httpsUrl),
  COGNITO_LOGOUT_URI: optionalEnv(httpsUrl),
  COGNITO_STAFF_SYNC_MODE: z.enum(["required", "local-only"]).default("required"),
  ENCRYPTION_KEY: optionalEnv(z.string().regex(/^[a-fA-F0-9]{64}$/)),
  ENCRYPTION_ACTIVE_KEY_ID: optionalEnv(z.string().regex(/^[A-Za-z0-9_-]{1,32}$/)),
  ENCRYPTION_KEYRING_JSON: optionalEnv(z.string().min(1)),
  SES_FROM_EMAIL: optionalEnv(z.string().email()),
  SES_SNS_TOPIC_ARNS: optionalEnv(z.string().refine(
    (value) => value.split(",").every((topic) => snsTopicArn.test(topic.trim())),
    "must contain only Amazon SNS topic ARNs",
  )),
  AWS_REGION: z.string().min(1).default("us-east-1"),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  throw new Error(`Invalid environment configuration: ${parsed.error.issues.map((issue) => issue.path.join(".")).join(", ")}`);
}

const values = parsed.data;
if (values.NODE_ENV === "production" && !values.JWT_ACCESS_SECRET) {
  throw new Error("JWT_ACCESS_SECRET is required in production");
}
if (values.NODE_ENV === "production" && values.COGNITO_STAFF_SYNC_MODE === "local-only") {
  throw new Error("COGNITO_STAFF_SYNC_MODE=local-only is forbidden in production");
}
if (new URL(values.ONEMAP_BASE_URL).origin !== "https://www.onemap.gov.sg") {
  throw new Error("ONEMAP_BASE_URL must use the official https://www.onemap.gov.sg origin");
}
if (Boolean(values.ONEMAP_API_EMAIL) !== Boolean(values.ONEMAP_API_PASSWORD)) {
  throw new Error("ONEMAP_API_EMAIL and ONEMAP_API_PASSWORD must be configured together");
}
const publicAppOrigin = resolvePublicAppOrigin(values.PUBLIC_APP_ORIGIN, values.NODE_ENV);

let encryptionKeyring = null;
if (values.ENCRYPTION_KEYRING_JSON) {
  try {
    const candidate = JSON.parse(values.ENCRYPTION_KEYRING_JSON);
    if (!candidate || Array.isArray(candidate) || typeof candidate !== "object") throw new Error();
    const entries = Object.entries(candidate);
    if (!entries.length || entries.length > 10) throw new Error();
    if (entries.some(([keyId, key]) => !/^[A-Za-z0-9_-]{1,32}$/.test(keyId) || !/^[a-fA-F0-9]{64}$/.test(key))) throw new Error();
    if (new Set(entries.map(([, key]) => key.toLowerCase())).size !== entries.length) throw new Error();
    encryptionKeyring = Object.freeze(Object.fromEntries(entries.map(([keyId, key]) => [keyId, key.toLowerCase()])));
  } catch {
    throw new Error("ENCRYPTION_KEYRING_JSON must be a JSON object containing 1-10 unique named 256-bit hexadecimal keys");
  }
}
if (Boolean(values.ENCRYPTION_ACTIVE_KEY_ID) !== Boolean(encryptionKeyring)) {
  throw new Error("ENCRYPTION_ACTIVE_KEY_ID and ENCRYPTION_KEYRING_JSON must be configured together");
}
if (values.ENCRYPTION_ACTIVE_KEY_ID && !encryptionKeyring[values.ENCRYPTION_ACTIVE_KEY_ID]) {
  throw new Error("ENCRYPTION_ACTIVE_KEY_ID must identify a key in ENCRYPTION_KEYRING_JSON");
}
if (values.NODE_ENV === "production" && (!values.ENCRYPTION_ACTIVE_KEY_ID || !encryptionKeyring)) {
  throw new Error("Versioned encryption keyring configuration is required in production");
}

const ephemeralAccessSecret = crypto.randomBytes(48).toString("base64url");

module.exports = Object.freeze({
  ...values,
  jwtAccessSecret: values.JWT_ACCESS_SECRET || ephemeralAccessSecret,
  corsOrigins: (values.CORS_ORIGIN || values.CORS_ORIGINS).split(",").map((origin) => origin.trim()).filter(Boolean),
  trustProxy: values.TRUST_PROXY === "true",
  publicSignupEnabled: values.PUBLIC_SIGNUP_ENABLED === "true",
  isProduction: values.NODE_ENV === "production",
  localHttps: values.LOCAL_HTTPS === "true",
  publicAppOrigin,
  encryptionActiveKeyId: values.ENCRYPTION_ACTIVE_KEY_ID || null,
  encryptionKeyring,
  sesSnsTopicArns: (values.SES_SNS_TOPIC_ARNS || "").split(",").map((topic) => topic.trim()).filter(Boolean),
});
