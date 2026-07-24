require("dotenv").config();
const fs = require("fs");
const https = require("https");
const path = require("path");
const env = require("./config/env");
const app = require("./app");

const server = !env.isProduction && env.localHttps
  ? https.createServer({
    key: fs.readFileSync(path.resolve(__dirname, env.TLS_KEY_PATH)),
    cert: fs.readFileSync(path.resolve(__dirname, env.TLS_CERT_PATH)),
  }, app)
  : app;

server.listen(env.PORT, "127.0.0.1", () => {
  const scheme = !env.isProduction && env.localHttps ? "https" : "http";
  const transport = env.isProduction ? " (private upstream; TLS must terminate at the configured proxy)" : "";
  console.log(`VSMS API listening on ${scheme}://127.0.0.1:${env.PORT}${transport}`);
});
