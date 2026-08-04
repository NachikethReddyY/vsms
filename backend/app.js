const path = require("path");
const fs = require("fs");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
const { rateLimit } = require("express-rate-limit");
const swaggerUi = require("swagger-ui-express");
const YAML = require("yaml");
const env = require("./config/env");
const AppError = require("./errors/AppError");
const requestContext = require("./middlewares/requestContext");
const csrf = require("./middlewares/csrf");
const authRoutes = require("./routes/authRoutes");
const userRoutes = require("./routes/userRoutes");
const eventRoutes = require("./routes/eventRoutes");
const publicEventRoutes = require("./routes/publicEventRoutes");
const locationRoutes = require("./routes/locationRoutes");
const qrRoutes = require("./routes/qrRoutes");
const screeningRoutes = require("./routes/screeningRoutes");
const participantRoutes = require("./routes/participantRoutes");
const registrationRoutes = require("./routes/registrationRoutes");
const adminRoutes = require("./routes/adminRoutes");
const consentRoutes = require("./routes/consentRoutes");
const emergencyContactRoutes = require("./routes/emergencyContactRoutes");
const signatureRoutes = require("./routes/signatureRoutes");
const providerEventRoutes = require("./routes/providerEventRoutes");
const { notFound, errorHandler } = require("./middlewares/errorHandler");
const authenticate = require("./middlewares/authenticate");

const app = express();
if (env.trustProxy) app.set("trust proxy", 1);
app.disable("x-powered-by");

app.use(requestContext);
app.use((req, _res, next) => {
  if (env.isProduction && !req.secure) return next(new AppError(426, "HTTPS_REQUIRED", "HTTPS is required"));
  return next();
});

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: env.isProduction ? ["'self'"] : ["'self'", "'unsafe-inline'"],
      styleSrc: env.isProduction ? ["'self'"] : ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:"],
      frameAncestors: ["'none'"],
    },
  },
}));
app.use((_req, res, next) => {
  res.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
});

app.use(cors({
  credentials: true,
  origin(origin, callback) {
    if (!origin || env.corsOrigins.includes(origin)) return callback(null, true);
    return callback(new AppError(403, "ORIGIN_NOT_ALLOWED", "Request origin is not allowed"));
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Authorization",
    "Content-Type",
    "X-CSRF-Token",
    "X-Request-Id",
    "X-Requested-With",
    "X-Device-Id",
    "X-Device-Name",
    "X-Event-Id",
    "Idempotency-Key",
  ],
}));

// Provider callbacks are authenticated with the signed SNS envelope rather
// than a browser cookie/CSRF token. Mount this one route before browser CSRF.
const providerEventLimiter = rateLimit({ windowMs: 60000, limit: 120, standardHeaders: "draft-8", legacyHeaders: false });
app.use("/api/v1/webhooks/ses", providerEventLimiter, providerEventRoutes);

app.use(cookieParser());
app.use(express.json({ limit: "256kb", strict: true, type: "application/json" }));
app.use(["/api/v1", "/api"], (req, res, next) =>
  ["POST", "PUT", "PATCH", "DELETE"].includes(req.method) ? csrf(req, res, next) : next());

const authLimiter = rateLimit({ windowMs: 15 * 60000, limit: 20, standardHeaders: "draft-8", legacyHeaders: false });
const mutationLimiter = rateLimit({ windowMs: 60000, limit: 60, standardHeaders: "draft-8", legacyHeaders: false });

app.get("/health", (_req, res) => res.json({ status: "ok" }));

if (!env.isProduction) {
  const swaggerDocument = YAML.parse(fs.readFileSync(path.join(__dirname, "docs/openapi.yaml"), "utf8"));
  app.get("/api-docs/openapi.json", (_req, res) => res.set("Cache-Control", "no-store").json(swaggerDocument));
  app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerDocument, {
    customCss: "",
    customSiteTitle: "VSMS API documentation",
    swaggerOptions: {
      displayRequestDuration: true,
      filter: true,
      persistAuthorization: true,
      tryItOutEnabled: true,
    },
  }));
}

// FIX: Updated route mapping with consistent /api namespaces and isolated paths
// Versioned routes are the canonical integration surface. Selected legacy
// aliases remain available for the existing event UI during the transition.
app.use("/api/v1/auth", authLimiter, authRoutes);
app.use("/api/v1/public/events", publicEventRoutes);
app.use("/api/v1/users", userRoutes);
app.use("/api/v1/events", (req, res, next) => ["POST", "PATCH", "PUT", "DELETE"].includes(req.method) ? mutationLimiter(req, res, next) : next(), authenticate, eventRoutes, screeningRoutes);
app.use("/api/v1/locations", locationRoutes);
app.use("/api/v1/participants", participantRoutes);
app.use("/api/v1/registrations", registrationRoutes);
app.use("/api/v1/consent-forms", consentRoutes);
app.use("/api/v1/emergency-contacts", emergencyContactRoutes);
app.use("/api/v1/signatures", signatureRoutes);
app.use("/api/v1/admin", adminRoutes);
app.use("/api/v1/qr", mutationLimiter, qrRoutes);

app.use("/api/users", userRoutes);
app.use("/api/public/events", publicEventRoutes);
app.use("/api/events", (req, res, next) => ["POST", "PATCH", "PUT", "DELETE"].includes(req.method) ? mutationLimiter(req, res, next) : next(), authenticate, eventRoutes, screeningRoutes);
app.use("/api/locations", locationRoutes);
app.use("/api/qr", mutationLimiter, qrRoutes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
