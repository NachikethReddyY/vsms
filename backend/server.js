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

const server = env.isProduction
  ? app
  : https.createServer({
      key: fs.readFileSync(path.resolve(__dirname, env.TLS_KEY_PATH)),
      cert: fs.readFileSync(path.resolve(__dirname, env.TLS_CERT_PATH)),
    }, app);

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