/**
 * ============================================================================
 * APPLICATION ENTRY POINT & MIDDLEWARE CONFIGURATION
 * Visual Screening Management System (VSMS) Backend API
 * ============================================================================
 */

// Core Node.js & Framework Modules
const path = require("path");
const fs = require("fs");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
const { rateLimit } = require("./middlewares/rateLimiter");
const swaggerUi = require("swagger-ui-express");
const YAML = require("yaml");

// Environment Configuration & Error Handling
const env = require("./config/env");
const AppError = require("./errors/AppError");
const logger = require("./utils/logger/logger");

// Custom Middlewares
const requestContext = require("./middlewares/requestContext");
const httpLogger = require("./middlewares/httpLogger");
const csrf = require("./middlewares/csrf");
const authenticate = require("./middlewares/authenticate");
const { notFound, errorHandler } = require("./middlewares/errorHandler");

// Route Modules
const authRoutes = require("./routes/authRoutes");
const accountRoutes = require("./routes/accountRoutes");
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
const queueRoutes = require("./routes/queueRoutes");

// Initialize Express App
const app = express();

/**
 * ============================================================================
 * 1. CORE SERVER SETTINGS & PROXY CONFIG
 * ============================================================================
 */
if (env.trustProxy) {
  app.set("trust proxy", 1);
}

// Disable Express fingerprinting header for security hardening
app.disable("x-powered-by");

// Attach baseline tracking context to incoming requests
app.use(requestContext);
app.use(httpLogger);

/**
 * ============================================================================
 * 2. SECURITY HEADERS & PROTOCOL ENFORCEMENT
 * ============================================================================
 */

// Enforce HTTPS redirection in production environments
app.use((req, _res, next) => {
  if (env.isProduction && !req.secure) {
    return next(
      new AppError(426, "HTTPS_REQUIRED", "HTTPS is required")
    );
  }
  next();
});

// Comprehensive security header hardening via Helmet
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: env.isProduction ? ["'self'"] : ["'self'", "'unsafe-inline'"],
        styleSrc: env.isProduction ? ["'self'"] : ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"]
      }
    },
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true
    },
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    frameguard: { action: "deny" },
    noSniff: true,
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: { policy: "same-origin" },
    crossOriginResourcePolicy: { policy: "same-origin" }
  })
);

// Granular browser permissions policy control
app.use((_req, res, next) => {
  res.set(
    "Permissions-Policy",
    "camera=(self), microphone=(), geolocation=()"
  );
  next();
});

/**
 * ============================================================================
 * 3. CORS & RATE LIMITERS CONFIGURATION
 * ============================================================================
 */

// Strict CORS Policy Configuration
app.use(
  cors({
    credentials: true,
    origin(origin, callback) {
      if (!origin || env.corsOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(
        new AppError(403, "ORIGIN_NOT_ALLOWED", "Request origin is not allowed")
      );
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
      "Idempotency-Key"
    ]
  })
);

// Dedicated Rate Limiters
const mutationLimiter = rateLimit({
  name: "mutation",
  windowMs: 60000,
  limit: 60,
  standardHeaders: "draft-8",
  legacyHeaders: false
});

const qrLimiter = rateLimit({
  name: "qr",
  windowMs: 60000,
  limit: 30,
  standardHeaders: "draft-8",
  legacyHeaders: false
});

const providerEventLimiter = rateLimit({
  name: "provider-events",
  windowMs: 60000,
  limit: 120,
  standardHeaders: "draft-8",
  legacyHeaders: false
});

/**
 * ============================================================================
 * 4. BODY PARSERS & GLOBAL MIDDLEWARES
 * ============================================================================
 */

// Unprotected Webhook / Provider Routes (must mount before body parsers if signature verification requires raw bodies)
app.use("/api/v1/webhooks/ses", providerEventLimiter, providerEventRoutes);

// Cookie Parser Middleware
app.use(cookieParser());

// JSON Body Parser with strict payload size limits
app.use(
  express.json({
    limit: env.requestBodyLimit,
    strict: true,
    type: "application/json"
  })
);

// Global CSRF Protection on Mutative API Requests (POST, PUT, PATCH, DELETE)
app.use(["/api/v1", "/api"], (req, res, next) => {
  if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
    return csrf(req, res, next);
  }
  next();
});

/**
 * ============================================================================
 * 5. UTILITY & SYSTEM ENDPOINTS
 * ============================================================================
 */

app.get("/favicon.ico", (_req, res) => res.status(204).end());

app.get("/health", (_req, res) =>
  res.json({
    status: "ok",
    environment: env.isProduction ? "production" : "development"
  })
);

// Swagger API Documentation UI (Non-Production Only)
if (!env.isProduction) {
  try {
    const openApiPath = path.resolve(__dirname, "docs/openapi.yaml");
    if (fs.existsSync(openApiPath)) {
      const fileContents = fs.readFileSync(openApiPath, "utf8");
      const swaggerDocument = YAML.parse(fileContents);

      app.get("/api-docs/openapi.json", (_req, res) =>
        res.set("Cache-Control", "no-store").json(swaggerDocument)
      );

      app.use(
        "/api-docs",
        swaggerUi.serve,
        swaggerUi.setup(swaggerDocument, {
          customSiteTitle: "VSMS API Documentation",
          swaggerOptions: {
            displayRequestDuration: true,
            filter: true,
            persistAuthorization: true,
            tryItOutEnabled: true
          }
        })
      );
    }
  } catch {
    logger.error("swagger.load_failed", {
      event: "swagger.load_failed",
      code: "SWAGGER_LOAD_FAILED",
    });
  }
}

/**
 * ============================================================================
 * 6. API ROUTE MOUNTING
 * ============================================================================
 */

// Authentication & Public Routes
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/account", accountRoutes);
app.use("/api/v1/public/events", publicEventRoutes);

// Core Entity Routes
app.use("/api/v1/users", userRoutes);
app.use("/api/v1/locations", locationRoutes);
app.use("/api/v1/participants", participantRoutes);
app.use("/api/v1/registrations", registrationRoutes);
app.use("/api/v1/consent-forms", consentRoutes);
app.use("/api/v1/emergency-contacts", emergencyContactRoutes);
app.use("/api/v1/signatures", signatureRoutes);
app.use("/api/v1/admin", adminRoutes);

// Specialized Rate-Limited & Authenticated Routes
app.use("/api/v1/qr", qrLimiter, qrRoutes);

app.use(
  "/api/v1/events",
  (req, res, next) => {
    if (["POST", "PATCH", "PUT", "DELETE"].includes(req.method)) {
      return mutationLimiter(req, res, next);
    }
    next();
  },
  authenticate,
  eventRoutes,
  screeningRoutes
);

app.use(
  "/api/v1/queues",
  (req, res, next) => {
    if (["POST", "PATCH", "PUT", "DELETE"].includes(req.method)) {
      return mutationLimiter(req, res, next);
    }
    next();
  },
  queueRoutes
);

// Legacy API Route Aliases (backward compatibility; new code should use /api/v1)
app.use("/api/users", userRoutes);
app.use("/api/public/events", publicEventRoutes);
app.use(
  "/api/events",
  (req, res, next) => {
    if (["POST", "PATCH", "PUT", "DELETE"].includes(req.method)) {
      return mutationLimiter(req, res, next);
    }
    next();
  },
  authenticate,
  eventRoutes,
  screeningRoutes
);
app.use("/api/locations", locationRoutes);
app.use("/api/qr", qrLimiter, qrRoutes);

/**
 * ============================================================================
 * 7. ERROR HANDLING MIDDLEWARES
 * ============================================================================
 */
app.use(notFound);
app.use(errorHandler);

// Export Application Instance
module.exports = app;
