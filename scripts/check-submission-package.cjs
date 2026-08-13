"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const { args: parseFinalArgs, assertSafeEntries } = require("./package-final-submission.cjs");
const {
  archiveNames,
  ARCHIVE_PREFIX,
  REQUIRED_FILES,
  SOURCE_ONLY_NOTICE,
  shouldInclude,
  validateEntryNames,
} = (() => {
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
  ["docs/images/vsms documents/VSMS Backend Practical Guide.docx", true],
  ["docs/images/vsms documents/lambda - Copy (1).js", false],
  ["docs/ai-transcripts/2026-chat.md", false],
  ["docs/ai-transcripts/DECLARATION_TEMPLATE.md", true],
  ["docs/design-preview.html", false],
  ["docs/logs.md", false],
  ["docs/secure_coding/diagrams/draft.md", false],
  ["docs/vsms-next-work-visual-plan.html", false],
  ["docs/secure_coding/report.md", true],
  ["docs/secure_coding/final/VSMS_Secure_Coding_Report.pdf", false],
  ["docs/secure_coding/final/VSMS_Demonstration.pptx", false],
];

for (const [file, expected] of cases) assert.equal(shouldInclude(file), expected, file);
for (const phrase of ["source-only", "database backup", "declaration", "slides", "final combined submission package"]) {
  assert.match(SOURCE_ONLY_NOTICE, new RegExp(phrase, "i"), phrase);
}

const safeNames = REQUIRED_FILES.map((file) => `${ARCHIVE_PREFIX}${file}`);
assert.equal(validateEntryNames(safeNames).length, safeNames.length);
assert.throws(
  () => validateEntryNames([...safeNames, `${ARCHIVE_PREFIX}backend/.env`]),
  /excluded or unsafe paths/,
);
assert.deepEqual(parseFinalArgs(["--student-id", "123", "--name", "Student"]), {
  "student-id": "123",
  name: "Student",
});
assert.doesNotThrow(() => assertSafeEntries(["Student_Code.zip", "Student_Db.zip"]));
assert.throws(() => assertSafeEntries(["../outside.sql"]), /unsafe paths/);
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
