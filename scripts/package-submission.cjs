"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const ARCHIVE_PREFIX = "vsms-submission/";
const DEFAULT_OUTPUT = path.join(ROOT, ".submission", "vsms-submission.zip");
const SOURCE_ONLY_NOTICE =
  "Source-only archive: it contains repository source and editable documentation only. It does not create or include a database backup, a completed academic declaration/signature, presentation slides, or a final combined submission package.";
const HUMAN_TEMPLATES = new Set([
  "docs/ai-transcripts/DECLARATION_TEMPLATE.md",
  "docs/ai-transcripts/EXTERNAL_AI_CHAT_LINKS.md",
]);
const SOURCE_BRIEF_FILES = new Set([
  "docs/images/vsms documents/AY2627s1 ST0528 DBSP Project2 Brief v1.pdf",
  "docs/images/vsms documents/DBSP SCP - Project 2 Common Project Specification V1 (2).docx",
  "docs/images/vsms documents/SCP Project2AY2627S1 Deliverables V1 (1).docx",
  "docs/images/vsms documents/VSMS Backend Practical Guide.docx",
]);
const EXCLUDED_DRAFT_DOCUMENTS = new Set([
  "docs/design-preview.html",
  "docs/logs.md",
  "docs/progress-report-2026-08-03-to-2026-08-05.html",
  "docs/secure_coding/diagrams/draft.md",
  "docs/vsms-next-work-visual-plan.html",
]);
const REQUIRED_FILES = [
  "README.md",
  "package.json",
  "pnpm-lock.yaml",
  "backend/package.json",
  "backend/pnpm-lock.yaml",
  "backend/docs/openapi.yaml",
  "react-user-dashboard/package.json",
  "react-user-dashboard/pnpm-lock.yaml",
  ...SOURCE_BRIEF_FILES,
  "docs/vsms-client-brief.md",
  "docs/vsms-participant-flow.md",
  "docs/vsms-project-2-guide.html",
  "docs/vsms-project-2-work-split.md",
  "docs/secure_coding/report.md",
  "docs/secure_coding/api-requirement-map.md",
  "docs/secure_coding/demo-outline.md",
  "docs/secure_coding/diagrams/ComponentDiagram.md",
  "docs/secure_coding/diagrams/ContextDiagram.md",
  "docs/secure_coding/diagrams/OfflineSynchronization.md",
  "docs/secure_coding/diagrams/PostgreSQL_ERD_Design.md",
  "docs/secure_coding/diagrams/RelationalAccessComparison.md",
  "docs/secure_coding/diagrams/SecureApiDesign.md",
  "docs/secure_coding/diagrams/SecurityArchitecture.md",
  "docs/secure_coding/diagrams/SequenceDiagram.md",
  "docs/secure_coding/diagrams/UseCaseDiagram.md",
  "docs/secure_coding/diagrams/deploymentDiagram.md",
  "docs/ai-transcripts/DECLARATION_TEMPLATE.md",
  "docs/ai-transcripts/EXTERNAL_AI_CHAT_LINKS.md",
  "scripts/check-submission-package.cjs",
  "scripts/package-submission.cjs",
];

function normalized(value) {
  return value.split(path.sep).join("/");
}

function shouldInclude(file) {
  const name = normalized(file).replace(/^\.\//, "");
  const base = name.split("/").pop();
  if (HUMAN_TEMPLATES.has(name)) return true;
  if (EXCLUDED_DRAFT_DOCUMENTS.has(name)) return false;
  if (name.startsWith("docs/ai-transcripts/")) return false;
  if (name.startsWith("docs/images/")) return SOURCE_BRIEF_FILES.has(name);
  if (name === "amplify.yml" || base === "bun.lock") return false;
  if (/(^|\/)\.(?:git|agents|codex|claude|impeccable)(?:\/|$)/.test(name)) return false;
  if (/(^|\/)node_modules(?:\/|$)/.test(name)) return false;
  if (/(^|\/)\.env(?:\.[^/]+)?$/.test(name) && base !== ".env.example") return false;
  if (/(^|\/)(?:logs?|certs?|secure-data|backups|coverage|test-results|playwright-report|\.repo-index|\.local-plan-preview)(?:\/|$)/.test(name)) return false;
  if (/(^|\/)(?:dist|build|out)(?:\/|$)/.test(name)) return false;
  if (/(^|\/)(?:secrets?|private)(?:\/|$)/i.test(name)) return false;
  if (/\.(?:pem|key|crt|cer|p12|pfx|log|zip|dump|backup|pgdump|sqlite|db)$/i.test(base)) return false;
  if (/^(?:gitleaks-report|semgrep-report)\.json$/.test(base)) return false;
  return true;
}

function trackedFiles() {
  return execFileSync("git", ["ls-files", "-z"], { cwd: ROOT })
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .map(normalized);
}

function assertCleanWorktree() {
  const status = execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], { cwd: ROOT })
    .toString("utf8")
    .trim();
  if (status) {
    throw new Error("Package from a clean committed worktree; commit or remove local changes first.");
  }
}

function validateEntryNames(names, requiredFiles = REQUIRED_FILES) {
  const files = names
    .map((name) => normalized(name))
    .filter((name) => !name.endsWith("/"));
  const invalid = files.filter((name) => {
    if (!name.startsWith(ARCHIVE_PREFIX)) return true;
    const source = name.slice(ARCHIVE_PREFIX.length);
    return !source || source.startsWith("/") || source.includes("../") || !shouldInclude(source);
  });
  if (invalid.length) throw new Error(`Archive contains excluded or unsafe paths: ${invalid.join(", ")}`);
  const missing = requiredFiles.filter((file) => !files.includes(`${ARCHIVE_PREFIX}${file}`));
  if (missing.length) throw new Error(`Archive is missing required files: ${missing.join(", ")}`);
  return files;
}

function archiveNames(archive) {
  return execFileSync("unzip", ["-Z1", archive], { cwd: ROOT })
    .toString("utf8")
    .split("\n")
    .map((name) => name.trim())
    .filter(Boolean);
}

function createArchive(output = DEFAULT_OUTPUT) {
  assertCleanWorktree();
  const included = trackedFiles().filter(shouldInclude);
  const missing = REQUIRED_FILES.filter((file) => !included.includes(file));
  if (missing.length) throw new Error(`Tracked source is missing required files: ${missing.join(", ")}`);

  const destination = path.resolve(ROOT, output);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.rmSync(destination, { force: true });
  execFileSync("git", [
    "archive",
    "--format=zip",
    "--prefix=" + ARCHIVE_PREFIX,
    "--mtime=0",
    "-9",
    "--output=" + destination,
    "HEAD",
    "--",
    ...included,
  ], { cwd: ROOT, stdio: "inherit" });
  validateEntryNames(archiveNames(destination));
  return { destination, fileCount: included.length };
}

if (require.main === module) {
  const result = createArchive(process.argv[2] || DEFAULT_OUTPUT);
  console.log(SOURCE_ONLY_NOTICE);
  console.log(`Created source-only archive ${result.destination} (${result.fileCount} source files)`);
}

module.exports = {
  ARCHIVE_PREFIX,
  DEFAULT_OUTPUT,
  EXCLUDED_DRAFT_DOCUMENTS,
  HUMAN_TEMPLATES,
  REQUIRED_FILES,
  SOURCE_BRIEF_FILES,
  SOURCE_ONLY_NOTICE,
  shouldInclude,
  validateEntryNames,
  createArchive,
};
