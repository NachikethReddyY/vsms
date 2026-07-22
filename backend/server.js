const express = require("express");
const cors = require("cors");
require("dotenv").config();

const swaggerUi = require("swagger-ui-express");
const YAML = require("yamljs");

const authRoutes = require("./routes/authRoutes");
const userRoutes = require("./routes/userRoutes");
const qrRoutes = require("./routes/qrRoutes"); // ✅ Add this

const app = express();
const PORT = process.env.PORT || 5000;

// Load OpenAPI YAML
const swaggerDocument = YAML.load("./docs/openapi.yaml");

// Middleware
app.use(cors());
app.use(express.json());

// Swagger Documentation
app.use(
    "/api-docs",
    swaggerUi.serve,
    swaggerUi.setup(swaggerDocument)
);

// Home Route
app.get("/", (req, res) => {
    res.send("Backend is running!");
});

// Register Routes
app.use("/auth", authRoutes);
app.use("/users", userRoutes);
app.use("/qr", qrRoutes); // ✅ Add this


// Start Server
app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`📄 Swagger Docs: http://localhost:${PORT}/api-docs`);
});