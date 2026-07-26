const fs = require("fs");
const https = require("https");
const path = require("path");
require("dotenv").config();

const env = require("./config/env");
const app = require("./app");
const logger = require("./utils/logger/logger");

const server = !env.isProduction && env.localHttps
  ? https.createServer({
      key: fs.readFileSync(path.resolve(__dirname, env.TLS_KEY_PATH)),
      cert: fs.readFileSync(path.resolve(__dirname, env.TLS_CERT_PATH)),
    }, app)
  : app;

if (require.main === module) {
  const port = env.port || Number(process.env.PORT || 5000);
  server.listen(port, () => {
    logger.info("server.started", {
      port,
      protocol: !env.isProduction && env.localHttps ? "https" : "http",
    });
  });

  server.on("error", (error) => {
    logger.error("server.failed", { message: error.message, stack: error.stack });
    process.exitCode = 1;
  });
}

module.exports = server;
