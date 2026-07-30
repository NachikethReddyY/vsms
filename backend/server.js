const fs = require("fs");
const https = require("https");
const path = require("path");
const app = require("./app");
const env = require("./config/env");
const logger = require("./utils/logger/logger");

const server = !env.isProduction && env.localHttps
  ? https.createServer({
      key: fs.readFileSync(path.resolve(__dirname, env.TLS_KEY_PATH)),
      cert: fs.readFileSync(path.resolve(__dirname, env.TLS_CERT_PATH)),
    }, app)
  : app;

server.on("error", (error) => {
  logger.error("server.failed", { message: error.message, stack: error.stack });
  process.exit(1);
});

server.listen(env.PORT, env.HOST, () => {
  const protocol = server instanceof https.Server ? "https" : "http";
  logger.info(`Server running securely on ${protocol}://${env.HOST}:${env.PORT}`);
});
