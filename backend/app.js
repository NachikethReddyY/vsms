const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
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
const requestLogger = require("./middlewares/morgan");
const authRoutes = require("./routes/authRoutes");
const userRoutes = require("./routes/userRoutes");
const eventRoutes = require("./routes/eventRoutes");
const locationRoutes = require("./routes/locationRoutes");
const qrRoutes = require("./routes/qrRoutes");
const screeningRoutes = require("./routes/screeningRoutes");
const participantRoutes = require("./routes/participantRoutes");
const registrationRoutes = require("./routes/registrationRoutes");
const adminRoutes = require("./routes/adminRoutes");
const consentRoutes = require("./routes/consentRoutes");
const emergencyContactRoutes = require("./routes/emergencyContactRoutes");
const signatureRoutes = require("./routes/signatureRoutes");
const { notFound, errorHandler } = require("./middlewares/errorHandler");

// -----------------------------------------------------------------------------
// OPTIONAL STARTUP CODE SIGNING VERIFICATION (Deployment Integrity Guard)
// -----------------------------------------------------------------------------
if (env.isProduction) {
  try {
    const codePath = __filename; 
    const sigPath = path.join(__dirname, "../dist/server.js.sig");
    const pubKeyPath = path.join(__dirname, "../public.pem");

    if (fs.existsSync(sigPath) && fs.existsSync(pubKeyPath)) {
      const codeBuffer = fs.readFileSync(codePath);
      const signature = fs.readFileSync(sigPath);
      const publicKey = fs.readFileSync(pubKeyPath, "utf8");

      const verifier = crypto.createVerify("SHA256");
      verifier.update(codeBuffer);
      verifier.end();

      if (!verifier.verify(publicKey, signature)) {
        console.error("FATAL: Code signature verification failed! Artifact has been modified.");
        process.exit(1); 
      }
      console.log("🔒 Code signature successfully verified.");
    }
  } catch (err) {
    console.error("Code integrity verification check failed with error:", err.message);
    process.exit(1);
  }
}

const app = express();
if (env.trustProxy) app.set("trust proxy", 1);
app.disable("x-powered-by");

app.use(requestContext);
app.use(requestLogger);
app.use((req, _res, next) => {
  if (env.isProduction && !req.secure) return next(new AppError(426, "HTTPS_REQUIRED", "HTTPS is required"));
  return next();
});

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:"],
    },
  },
}));

app.use(cors({
  credentials: true,
  origin(origin, callback) {
    if (!origin || env.corsOrigins.includes(origin)) return callback(null, true);
    return callback(new AppError(403, "ORIGIN_NOT_ALLOWED", "Request origin is not allowed"));
  },
  methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Authorization",
    "Content-Type",
    "X-CSRF-Token",
    "X-Request-Id",
    "X-Requested-With",
    "X-Device-Id",
    "X-Device-Name",
    "Idempotency-Key",
  ],
}));

app.use(cookieParser());
app.use(express.json({ limit: "256kb", strict: true, type: "application/json" }));

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
app.use("/api/v1/users", userRoutes);
app.use("/api/v1/events", (req, res, next) => ["POST", "PATCH", "PUT", "DELETE"].includes(req.method) ? mutationLimiter(req, res, next) : next(), eventRoutes);
app.use("/api/v1/locations", locationRoutes);
app.use("/api/v1/events", (req, res, next) => ["POST", "PATCH", "PUT", "DELETE"].includes(req.method) ? mutationLimiter(req, res, next) : next(), screeningRoutes);
app.use("/api/v1/participants", participantRoutes);
app.use("/api/v1/registrations", registrationRoutes);
app.use("/api/v1/consent-forms", consentRoutes);
app.use("/api/v1/emergency-contacts", emergencyContactRoutes);
app.use("/api/v1/signatures", signatureRoutes);
app.use("/api/v1/admin", adminRoutes);
app.use("/api/v1/qr", mutationLimiter, qrRoutes);

app.use("/api/auth", authLimiter, authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/events", (req, res, next) => ["POST", "PATCH", "PUT", "DELETE"].includes(req.method) ? mutationLimiter(req, res, next) : next(), eventRoutes);
app.use("/api/locations", locationRoutes);
app.use("/api/events", (req, res, next) => ["POST", "PATCH", "PUT", "DELETE"].includes(req.method) ? mutationLimiter(req, res, next) : next(), screeningRoutes);
app.use("/api/qr", mutationLimiter, qrRoutes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
