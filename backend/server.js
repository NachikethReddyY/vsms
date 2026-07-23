const express = require("express");
const cors = require("cors");
const helmet = require("helmet"); // Added security middleware
require("dotenv").config();

const swaggerUi = require("swagger-ui-express");
const YAML = require("yamljs");

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
        // Connect-src defines the allowlist for API endpoints / WebSockets
        "connect-src": [
          "'self'",
          "http://localhost:5000",
          "https://api.vsms-screening.org"
        ],
        // Allow scripts required by Swagger UI & application
        "script-src": ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
        // Allow inline styles required by Swagger UI
        "style-src": ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
        // Allow image sources (including data URIs for QR code generation)
        "img-src": ["'self'", "data:", "blob:"],
        // Prevent clickjacking by denying iframe embedding
        "frame-ancestors": ["'none'"],
      },
    },
    // Cross-Origin Resource Policy
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);

// 2. CORS Middleware Configuration
app.use(cors());
app.use(express.json());

// 3. Swagger Documentation Route
app.use(
  "/api-docs",
  swaggerUi.serve,
  swaggerUi.setup(swaggerDocument)
);

// 4. Base Check Route
app.get("/", (req, res) => {
  res.send("Backend is running!");
});

// 5. API Route Mounts
app.use("/auth", authRoutes);
app.use("/users", userRoutes);
app.use("/qr", qrRoutes);
app.use("/participants", participantRoutes);
app.use("/event-registration", eventRegistrationRoutes);
app.use("/events", eventRoutes);

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📄 Swagger Docs: http://localhost:${PORT}/api-docs`);
});