const fs = require("fs");
const https = require("https");
const path = require("path");
const express = require("express");
const cookieParser = require("cookie-parser");
const YAML = require("js-yaml");
const swaggerUi = require("swagger-ui-express");
const { Server } = require("socket.io");
const app = require("./app");
const env = require("./config/env");
const logger = require("./utils/logger/logger");
const cors = require("cors");
const helmet = require("helmet");

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
  swaggerDocument = YAML.load(file);
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
app.options(/(.*)/, cors(corsOptions)); // Safe Express 4 wildcard option handler

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
          "https://localhost:5000",
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
// 3. BODY PARSING, COOKIES & LIMITS
// -----------------------------------------------------------------------------
app.use(cookieParser());
app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ limit: "100kb", extended: true }));

// Payload size error handler middleware
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
// 4. ROUTES & DOCUMENTATION
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
// app.use("/queue", queueRoutes);

// Safe Express 4 fallback catch-all handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Cannot ${req.method} ${req.originalUrl}`,
  });
});

// -----------------------------------------------------------------------------
// 5. SERVER CREATION, SOCKET.IO & LISTENING
// -----------------------------------------------------------------------------
const server = !env.isProduction && env.localHttps
  ? https.createServer({
      key: fs.readFileSync(path.resolve(__dirname, env.TLS_KEY_PATH)),
      cert: fs.readFileSync(path.resolve(__dirname, env.TLS_CERT_PATH)),
    }, app)
  : require("http").createServer(app);

// Attach Socket.io with your existing enterprise CORS policies
const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true,
  },
});

// Make io accessible globally or export it if needed across controllers/routes
app.set("io", io);

io.on("connection", (socket) => {
  logger.info(`Client connected via WebSockets: ${socket.id}`);

  // Example event room join for your active event queues
  socket.on("join-event-queue", (eventId) => {
    socket.join(`event-${eventId}`);
    logger.info(`Socket ${socket.id} joined room: event-${eventId}`);
  });

  socket.on("disconnect", () => {
    logger.info(`Client disconnected: ${socket.id}`);
  });
});

server.on("error", (error) => {
  logger.error("server.failed", { message: error.message, stack: error.stack });
  process.exitCode = 1;
});

if (require.main === module) {
  const port = env.port || Number(process.env.PORT || 5000);
  server.listen(port, () => {
    const protocol = !env.isProduction && env.localHttps ? "https" : "http";
    logger.info(`Server & WebSocket engine running securely on ${protocol}://localhost:${port}`);
  });
}

module.exports = { server, io };
