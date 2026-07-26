const express = require("express");
const cors = require("cors");
require("dotenv").config();

const swaggerUi = require("swagger-ui-express");
const YAML = require("yamljs");

const authRoutes = require("./routes/authRoutes");
const eventRoutes = require("./routes/eventRoutes");
const participantRoutes = require("./routes/participantRoutes");
const registrationRoutes = require("./routes/registrationRoutes");
const adminRoutes = require("./routes/adminRoutes");
const qrRoutes = require("./routes/qrRoutes");
const requestContext = require("./middlewares/requestContext");
const { notFoundHandler, errorHandler } = require("./middlewares/errorHandler");

const app = express();
const PORT = process.env.PORT || 5000;

const swaggerDocument = YAML.load("./docs/openapi.yaml");

app.use(cors());
app.use(express.json());
app.use(requestContext);

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
app.use("/api/v1/admin", adminRoutes);
app.use("/api/v1/qr", qrRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Swagger docs: http://localhost:${PORT}/api-docs`);
});
