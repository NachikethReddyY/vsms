const fs = require("fs");
const http = require("http");
const https = require("https");
const path = require("path");
const cors = require("cors");
const express = require("express");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
const YAML = require("yamljs");
const swaggerUi = require("swagger-ui-express");
const { Server } = require("socket.io");
const app = require("./app");
const env = require("./config/env");
const logger = require("./utils/logger/logger");

// -----------------------------------------------------------------------------
// 0. BACKGROUND WORKERS (Event-Driven Architecture)
// -----------------------------------------------------------------------------
require("./workers/auditWorker");

// Import Routes
const authRoutes = require("./routes/authRoutes");
const userRoutes = require("./routes/userRoutes");
const qrRoutes = require("./routes/qrRoutes");
const participantRoutes = require("./routes/participantRoutes");
const eventRegistrationRoutes = require("./routes/eventRegistrationRoutes");
const eventRoutes = require("./routes/eventRoutes");
const queueRoutes = require("./routes/queueRoutes");

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
app.options(/(.*)/, cors(corsOptions));

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
app.use("/queues", queueRoutes);

// -----------------------------------------------------------------------------
// 5. GLOBAL ERROR HANDLER
// -----------------------------------------------------------------------------
app.use((err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  logger.error(`[Global Error] ${err.message}`, { 
    stack: err.stack, 
    path: req.originalUrl, 
    method: req.method 
  });

  res.status(statusCode).json({
    success: false,
    message: err.message || "Internal Server Error",
    ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
  });
});

// 404 Handler for undefined routes
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Cannot ${req.method} ${req.originalUrl}`,
  });
});

// -----------------------------------------------------------------------------
// 6. SERVER CREATION, SOCKET.IO & LISTENING
// -----------------------------------------------------------------------------
const useHttps = !env.isProduction && env.localHttps;

let server;
if (useHttps) {
  server = https.createServer(
    {
      key: fs.readFileSync(path.resolve(__dirname, env.TLS_KEY_PATH)),
      cert: fs.readFileSync(path.resolve(__dirname, env.TLS_CERT_PATH)),
    },
    app
  );
} else {
  server = http.createServer(app);
}

const io = new Server(server, { cors: corsOptions });

// Make io accessible globally via Express context
app.set("io", io);

io.on("connection", (socket) => {
  logger.info(`Client connected: ${socket.id}`);
  
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
  const host = env.HOST || "localhost";

  server.listen(port, host, () => {
    const protocol = useHttps ? "https" : "http";
    const serverUrl = `${protocol}://${host}:${port}`;
    
    console.log(`[Server Status] Running successfully on ${serverUrl}`);
    logger.info(`Server & WebSocket engine running securely on ${serverUrl}`);
  });
}

module.exports = { server };