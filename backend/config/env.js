const crypto = require("crypto");
const { z } = require("zod");
require("dotenv").config();

const optionalEnv = (schema) => z.preprocess((value) => value === "" ? undefined : value, schema.optional());

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.enum(["127.0.0.1", "0.0.0.0"]).default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65535).default(5000),
  DATABASE_URL: z.string().url(),
  JWT_ACCESS_SECRET: z.string().min(32).optional(),
  JWT_ISSUER: z.string().min(1).default("vsms-api"),
  JWT_AUDIENCE: z.string().min(1).default("vsms-dashboard"),
  ACCESS_TOKEN_TTL: z.string().default("15m"),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(7),
  PUBLIC_SIGNUP_ENABLED: z.enum(["true", "false"]).default("false"),
  CORS_ORIGINS: z.string().default("https://localhost:5173,https://127.0.0.1:5173,http://localhost:5173,http://127.0.0.1:5173"),
  CORS_ORIGIN: z.string().optional(),
  TRUST_PROXY: z.enum(["true", "false"]).default("false"),
  LOCAL_HTTPS: z.enum(["true", "false"]).default("false"),
  TLS_KEY_PATH: z.string().default("../react-user-dashboard/certs/localhost-key.pem"),
  TLS_CERT_PATH: z.string().default("../react-user-dashboard/certs/localhost.pem"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error", "silent"]).optional(),
  ONEMAP_BASE_URL: z.string().url().default("https://www.onemap.gov.sg"),
  ONEMAP_API_EMAIL: optionalEnv(z.string().email()),
  ONEMAP_API_PASSWORD: optionalEnv(z.string().min(1)),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  throw new Error(`Invalid environment configuration: ${parsed.error.issues.map((issue) => issue.path.join(".")).join(", ")}`);
}

const values = parsed.data;
if (values.NODE_ENV === "production" && !values.JWT_ACCESS_SECRET) {
  throw new Error("JWT_ACCESS_SECRET is required in production");
}
if (new URL(values.ONEMAP_BASE_URL).origin !== "https://www.onemap.gov.sg") {
  throw new Error("ONEMAP_BASE_URL must use the official https://www.onemap.gov.sg origin");
}
if (Boolean(values.ONEMAP_API_EMAIL) !== Boolean(values.ONEMAP_API_PASSWORD)) {
  throw new Error("ONEMAP_API_EMAIL and ONEMAP_API_PASSWORD must be configured together");
}

const ephemeralAccessSecret = crypto.randomBytes(48).toString("base64url");

module.exports = Object.freeze({
  ...values,
  jwtAccessSecret: values.JWT_ACCESS_SECRET || ephemeralAccessSecret,
  corsOrigins: (values.CORS_ORIGIN || values.CORS_ORIGINS).split(",").map((origin) => origin.trim()).filter(Boolean),
  trustProxy: values.TRUST_PROXY === "true",
  localHttps: values.LOCAL_HTTPS === "true",
  publicSignupEnabled: values.PUBLIC_SIGNUP_ENABLED === "true",
  isProduction: values.NODE_ENV === "production",
});
