"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const { archiveNames, ARCHIVE_PREFIX, REQUIRED_FILES, shouldInclude, validateEntryNames } = (() => {
  const packageScript = require("./package-submission.cjs");
  return {
    ...packageScript,
    archiveNames(archive) {
      const { execFileSync } = require("node:child_process");
      return execFileSync("unzip", ["-Z1", archive]).toString("utf8").split("\n").filter(Boolean);
    },
  };
})();

const cases = [
  ["backend/.env", false],
  ["backend/.env.production", false],
  ["backend/.env.example", true],
  ["backend/node_modules/express/index.js", false],
  ["backend/logs/combined.log", false],
  ["react-user-dashboard/certs/localhost-key.pem", false],
  ["backend/backups/test.sql", false],
  ["docs/images/private.zip", false],
  ["docs/ai-transcripts/2026-chat.md", false],
  ["docs/ai-transcripts/DECLARATION_TEMPLATE.md", true],
  ["docs/secure_coding/report.md", true],
];

for (const [file, expected] of cases) assert.equal(shouldInclude(file), expected, file);

const safeNames = REQUIRED_FILES.map((file) => `${ARCHIVE_PREFIX}${file}`);
assert.equal(validateEntryNames(safeNames).length, safeNames.length);
assert.throws(
  () => validateEntryNames([...safeNames, `${ARCHIVE_PREFIX}backend/.env`]),
  /excluded or unsafe paths/,
);
assert.throws(
  () => validateEntryNames([...safeNames, "../outside.txt"]),
  /excluded or unsafe paths/,
);

const archive = process.argv[2];
if (archive) {
  assert.ok(fs.existsSync(archive), `Archive does not exist: ${archive}`);
  validateEntryNames(archiveNames(archive));
  console.log(`Validated ${archive}`);
} else {
  console.log("Submission package exclusion checks passed");
}
