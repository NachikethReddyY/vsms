const crypto = require("crypto");
const { z } = require("zod");
require("dotenv").config();

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(5050),
  DATABASE_URL: z.string().url(),
  JWT_ACCESS_SECRET: z.string().min(32).optional(),
  JWT_ISSUER: z.string().min(1).default("vsms-api"),
  JWT_AUDIENCE: z.string().min(1).default("vsms-dashboard"),
  ACCESS_TOKEN_TTL: z.string().default("15m"),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(7),
  PUBLIC_SIGNUP_ENABLED: z.enum(["true", "false"]).default("false"),
  CORS_ORIGINS: z.string().default("https://localhost:5173"),
  TRUST_PROXY: z.enum(["true", "false"]).default("false"),
  LOCAL_HTTPS: z.enum(["true", "false"]).default("true"),
  TLS_KEY_PATH: z.string().default("../react-user-dashboard/certs/localhost-key.pem"),
  TLS_CERT_PATH: z.string().default("../react-user-dashboard/certs/localhost.pem"),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  throw new Error(`Invalid environment configuration: ${parsed.error.issues.map((issue) => issue.path.join(".")).join(", ")}`);
}

const values = parsed.data;
if (values.NODE_ENV === "production" && !values.JWT_ACCESS_SECRET) {
  throw new Error("JWT_ACCESS_SECRET is required in production");
}

const ephemeralAccessSecret = crypto.randomBytes(48).toString("base64url");

module.exports = Object.freeze({
  ...values,
  jwtAccessSecret: values.JWT_ACCESS_SECRET || ephemeralAccessSecret,
  corsOrigins: values.CORS_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean),
  trustProxy: values.TRUST_PROXY === "true",
  localHttps: values.LOCAL_HTTPS === "true",
  publicSignupEnabled: values.PUBLIC_SIGNUP_ENABLED === "true",
  isProduction: values.NODE_ENV === "production",
});
