const express = require("express");
const cors = require("cors");
const helmet = require("helmet"); // Added security middleware
const morgan = require("morgan"); // HTTP Logger Middleware
require("dotenv").config();

const swaggerUi = require("swagger-ui-express");
const YAML = require("yamljs");

const logger = require("./utils/logger/logger.js"); // Winston Logger

const authRoutes = require("./routes/authRoutes");
const userRoutes = require("./routes/userRoutes");
const qrRoutes = require("./routes/qrRoutes");
const participantRoutes = require("./routes/participantRoutes");
const eventRegistrationRoutes = require("./routes/eventRegistrationRoutes");
const eventRoutes = require("./routes/eventRoutes");

const app = express();
const PORT = process.env.PORT || 5000;

// Load OpenAPI YAML
const swaggerDocument = YAML.load("./docs/openapi.yaml");

// 1. Configure Content Security Policy (CSP) & HTTP Security Headers using Helmet
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "default-src": ["'self'"],
        "connect-src": [
          "'self'",
          "http://localhost:5000",
          "https://api.vsms-screening.org"
        ],
        "script-src": ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
        "style-src": ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
        "img-src": ["'self'", "data:", "blob:"],
        "frame-ancestors": ["'none'"],
      },
    },
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);

// 2. HTTP Request Logging Middleware (Streams HTTP logs directly to Winston)
const morganFormat = ":remote-addr - :method :url :status :response-time ms";
app.use(
  morgan(morganFormat, {
    stream: {
      write: (message) => logger.info(message.trim())
    }
  })
);

// 3. CORS Middleware Configuration
app.use(cors());

// 4. Payload Size Limits (Prevents Arbitrary Large Input DoS Attacks)
app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ limit: "100kb", extended: true }));

// 5. Catch Payload Too Large (HTTP 413) Errors
app.use((err, req, res, next) => {
  if (err.type === "entity.too.large" || err.status === 413) {
    logger.warn(`Payload Limit Exceeded from IP: ${req.ip}`);
    return res.status(413).json({
      success: false,
      message: "Payload size too large. Requests are strictly limited to 100KB."
    });
  }
  next(err);
});

// 6. Swagger Documentation Route
app.use(
  "/api-docs",
  swaggerUi.serve,
  swaggerUi.setup(swaggerDocument)
);

// 7. Base Check Route
app.get("/", (req, res) => {
  res.send("Backend is running!");
});

// 8. API Route Mounts
app.use("/auth", authRoutes);
app.use("/users", userRoutes);
app.use("/qr", qrRoutes);
app.use("/participants", participantRoutes);
app.use("/event-registrations", eventRegistrationRoutes);
app.use("/events", eventRoutes);

// 9. Global Unhandled Error Handler
app.use((err, req, res, next) => {
  // Log error stack trace to rotating error log
  logger.error(`${err.status || 500} - ${err.message} - ${req.originalUrl} - ${req.method} - ${req.ip}`, {
    stack: err.stack
  });

  return res.status(err.status || 500).json({
    success: false,
    message: err.message || "An unexpected internal server error occurred."
  });
});

// Start server
app.listen(PORT, () => {
  logger.info(`🚀 Server running on http://localhost:${PORT}`);
  logger.info(`📄 Swagger Docs: http://localhost:${PORT}/api-docs`);
});