const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan"); // <--- 1. Import morgan package first
const fs = require("fs");
const https = require("https");
const path = require("path");
const YAML = require("yaml");
const cookieParser = require("cookie-parser");
const swaggerUi = require("swagger-ui-express");
require("dotenv").config();

const env = require("./config/env");
const logger = require("./utils/logger/logger");

const app = express();
const PORT = process.env.PORT || 5000;

// HTTPS Server setup for local development
const server = !env.isProduction && env.localHttps
  ? https.createServer({
      key: fs.readFileSync(path.resolve(__dirname, env.TLS_KEY_PATH)),
      cert: fs.readFileSync(path.resolve(__dirname, env.TLS_CERT_PATH)),
    }, app)
  : app;

// Import Routes
const authRoutes = require("./routes/authRoutes");
const userRoutes = require("./routes/userRoutes");
const qrRoutes = require("./routes/qrRoutes");
const participantRoutes = require("./routes/participantRoutes");
const eventRegistrationRoutes = require("./routes/eventRegistrationRoutes");
const eventRoutes = require("./routes/eventRoutes");

// Load Swagger / OpenAPI Document securely using standard file streams
let swaggerDocument;
try {
  const file = fs.readFileSync("./docs/openapi.yaml", "utf8");
  swaggerDocument = YAML.parse(file);
} catch (error) {
  logger.error("Failed to load or parse ./docs/openapi.yaml", { error: error.message });
}

// -----------------------------------------------------------------------------
// 1. CORS CONFIGURATION
// -----------------------------------------------------------------------------
const allowedOrigins = [
  "http://localhost:5173",
  "https://localhost:5173",
  "http://127.0.0.1:5173",
  "https://127.0.0.1:5173",
];

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`CORS Error: Origin ${origin} is not allowed.`));
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-CSRF-Token",
    "X-Requested-With",
    "Accept",
  ],
  exposedHeaders: ["X-CSRF-Token"],
};

app.use(cors(corsOptions));
app.options("/*splat", cors(corsOptions));

// -----------------------------------------------------------------------------
// 2. HELMET SECURITY HEADERS & CLICKJACKING PROTECTION
// -----------------------------------------------------------------------------
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "default-src": ["'self'"],
        "frame-ancestors": ["'none'"],
        "connect-src": [
          "'self'",
          "http://localhost:5000",
          "https://localhost:5173",
          "http://localhost:5173",
        ],
        "script-src": ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
        "script-src-attr": ["'unsafe-inline'"],
        "style-src": ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
        "img-src": ["'self'", "data:", "blob:", "https://validator.swagger.io"],
      },
    },
    frameguard: { action: "deny" },
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);

// -----------------------------------------------------------------------------
// 3. HTTP LOGGING
// -----------------------------------------------------------------------------
const morganFormat = ":remote-addr - :method :url :status :response-time ms";
app.use(
  morgan(morganFormat, {
    stream: {
      write: (message) => logger.info(message.trim()),
    },
  })
);

// -----------------------------------------------------------------------------
// 4. BODY PARSING, COOKIES & LIMITS
// -----------------------------------------------------------------------------
app.use(cookieParser());
app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ limit: "100kb", extended: true }));

app.use((err, req, res, next) => {
  if (err.type === "entity.too.large" || err.status === 413) {
    logger.warn(`Payload Limit Exceeded from IP: ${req.ip}`);
    return res.status(413).json({
      success: false,
      message: "Payload size too large. Requests are strictly limited to 100KB.",
    });
  }
  next(err);
});

// -----------------------------------------------------------------------------
// 5. ROUTES
// -----------------------------------------------------------------------------
if (swaggerDocument) {
  app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerDocument));
}

app.get("/", (req, res) => {
  res.send("Backend API is running securely!");
});

app.use("/auth", authRoutes);
app.use("/users", userRoutes);
app.use("/qr", qrRoutes);
app.use("/participants", participantRoutes);
app.use("/event-registrations", eventRegistrationRoutes);
app.use("/events", eventRoutes);

// Express 5 catch-all for undefined routes
app.all("/*splat", (req, res) => {
  res.status(404).json({
    success: false,
    message: `Cannot ${req.method} ${req.originalUrl}`,
  });
});

server.on("error", (error) => {
  logger.error("server.failed", { message: error.message, stack: error.stack });
  process.exit(1);
});

server.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
});