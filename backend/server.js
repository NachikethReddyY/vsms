const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const swaggerUi = require("swagger-ui-express");
const YAML = require("yaml");

const authRoutes = require("./routes/authRoutes");
const eventRoutes = require("./routes/eventRoutes");
const participantRoutes = require("./routes/participantRoutes");
const registrationRoutes = require("./routes/registrationRoutes");
const adminRoutes = require("./routes/adminRoutes");
const qrRoutes = require("./routes/qrRoutes");
const consentRoutes = require("./routes/consentRoutes");
const emergencyContactRoutes = require("./routes/emergencyContactRoutes");
const signatureRoutes = require("./routes/signatureRoutes");
const requestContext = require("./middlewares/requestContext");
const { notFoundHandler, errorHandler } = require("./middlewares/errorHandler");
const { secureHeaders, rateLimit } = require("./middlewares/security");

const app = express();
const PORT = process.env.PORT || 5000;

const swaggerDocument = YAML.parse(
    fs.readFileSync(path.join(__dirname, "docs", "openapi.yaml"), "utf8")
);

app.use(requestContext);
app.use(secureHeaders);
const allowedOrigins = String(process.env.CORS_ORIGIN || "http://localhost:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
app.use(cors({
    credentials: true,
    origin(origin, callback) {
        if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
        const error = new Error("Origin is not allowed");
        error.statusCode = 403;
        callback(error);
    },
}));
app.use(express.json({ limit: process.env.REQUEST_BODY_LIMIT || "200kb" }));
app.use(rateLimit({ windowMs: 60_000, max: 300 }));

app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerDocument));

app.get("/", (req, res) => {
    res.json({
        message: "Backend is running!",
        requestId: req.context.requestId,
        authProvider: process.env.AUTH_PROVIDER || "cognito",
    });
});

app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/events", eventRoutes);
app.use("/api/v1/participants", participantRoutes);
app.use("/api/v1/registrations", registrationRoutes);
app.use("/api/v1/consent-forms", consentRoutes);
app.use("/api/v1/emergency-contacts", emergencyContactRoutes);
app.use("/api/v1/signatures", signatureRoutes);
app.use("/api/v1/admin", adminRoutes);
app.use("/api/v1/qr", qrRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Server running on http://localhost:${PORT}`);
        console.log(`Swagger docs: http://localhost:${PORT}/api-docs`);
    });
}

module.exports = app;
