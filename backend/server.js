const fs = require("fs");
const https = require("https");
const path = require("path");
const app = require("./app");
const env = require("./config/env");
const logger = require("./utils/logger/logger");

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
  server.listen(env.PORT, env.HOST, () => {
    const protocol = env.isProduction ? "http" : "https";
    logger.info(`Server running on ${protocol}://${env.HOST}:${env.PORT}`);
  });
}

module.exports = { server };
