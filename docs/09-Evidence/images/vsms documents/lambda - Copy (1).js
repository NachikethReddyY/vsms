const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const routes = require("./routes/screening.routes");
const config = require("./config");

const app = express();
app.use(helmet());
app.use(cors({ origin: config.corsOrigin }));
app.use(express.json({ limit: "1mb" }));
app.use(morgan("combined"));

app.get("/health", (req, res) => res.json({ status: "ok" }));
app.use("/api/v1", routes);

app.use((err, req, res, next) => {
  console.error("API error", { name: err.name, message: err.message });
  if (err.name === "ZodError") return res.status(400).json({ success: false, message: "Validation failed", issues: err.errors });
  if (err.name === "ConditionalCheckFailedException") return res.status(409).json({ success: false, message: "Duplicate screening result" });
  return res.status(500).json({ success: false, message: "Internal server error" });
});

module.exports = app;