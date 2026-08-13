const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const viteConfig = fs.readFileSync(path.join(root, "react-user-dashboard/vite.config.ts"), "utf8");

test("the PWA build splits large third-party dependencies for precaching", () => {
  assert.match(viteConfig, /manualChunks\(id\)/);
  assert.match(viteConfig, /html5-qrcode/);
  assert.match(viteConfig, /@astryxdesign/);
  assert.match(viteConfig, /react-vendor/);
});
