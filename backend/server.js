require("dotenv").config();
const fs = require("fs");
const https = require("https");
const path = require("path");
const env = require("./config/env");
const app = require("./app");
const logger = require("./utils/logger/logger");

const server = !env.isProduction && env.localHttps
  ? https.createServer({
    key: fs.readFileSync(path.resolve(__dirname, env.TLS_KEY_PATH)),
    cert: fs.readFileSync(path.resolve(__dirname, env.TLS_CERT_PATH)),
  }, app)
  : app;

server.listen(env.PORT, env.HOST, () => {
  const scheme = !env.isProduction && env.localHttps ? "https" : "http";
  logger.info("server.started", {
    environment: env.NODE_ENV,
    url: `${scheme}://${env.HOST}:${env.PORT}`,
    ...(env.isProduction ? { tls: "terminated by configured proxy" } : { swaggerPath: "/api-docs" }),
  });
});

server.on("error", (error) => {
  logger.error("server.failed", { message: error.message, stack: error.stack });
  process.exit(1);
});
