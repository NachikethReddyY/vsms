const path = require("path");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
const { rateLimit } = require("express-rate-limit");
const swaggerUi = require("swagger-ui-express");
const YAML = require("yamljs");
const env = require("./config/env");
const AppError = require("./errors/AppError");
const requestContext = require("./middlewares/requestContext");
const requestLogger = require("./middlewares/morgan");
const authRoutes = require("./routes/authRoutes");
const userRoutes = require("./routes/userRoutes");
const eventRoutes = require("./routes/eventRoutes");
const locationRoutes = require("./routes/locationRoutes");
const qrRoutes = require("./routes/qrRoutes");
const { notFound, errorHandler } = require("./middlewares/errorHandler");

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
  allowedHeaders: ["Authorization", "Content-Type", "X-CSRF-Token", "X-Request-Id", "Idempotency-Key"],
}));
app.use(cookieParser());
app.use(express.json({ limit: "256kb", strict: true, type: "application/json" }));

const authLimiter = rateLimit({ windowMs: 15 * 60000, limit: 20, standardHeaders: "draft-8", legacyHeaders: false });
const mutationLimiter = rateLimit({ windowMs: 60000, limit: 60, standardHeaders: "draft-8", legacyHeaders: false });

app.get("/health", (_req, res) => res.json({ status: "ok" }));
if (!env.isProduction) {
  const swaggerDocument = YAML.load(path.join(__dirname, "docs/openapi.yaml"));
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
app.use("/auth", authLimiter, authRoutes);
app.use("/users", userRoutes);
app.use("/api/events", (req, res, next) => ["POST", "PATCH", "PUT", "DELETE"].includes(req.method) ? mutationLimiter(req, res, next) : next(), eventRoutes);
app.use("/api/locations", locationRoutes);
app.use("/api/qr", mutationLimiter, qrRoutes);
app.use(notFound);
app.use(errorHandler);

module.exports = app;
