"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { createArchive } = require("./package-submission.cjs");

const ROOT = path.resolve(__dirname, "..");

function fail(message) {
  throw new Error(message);
}

function args(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || !value) fail(`Expected --name value, received ${key || "end of input"}`);
    values[key.slice(2)] = value;
  }
  return values;
}

function existingFile(value, label) {
  if (!value) fail(`Missing --${label}`);
  const file = path.resolve(ROOT, value);
  if (!fs.statSync(file, { throwIfNoEntry: false })?.isFile()) fail(`${label} does not exist: ${file}`);
  return file;
}

function assertMagic(file, expected, label) {
  const actual = fs.readFileSync(file).subarray(0, expected.length).toString("binary");
  if (actual !== expected) fail(`${label} has the wrong file signature: ${file}`);
}

function zipNames(file) {
  return execFileSync("unzip", ["-Z1", file], { encoding: "utf8" })
    .split("\n").map((entry) => entry.trim()).filter(Boolean);
}

function assertSafeEntries(entries, label) {
  const unsafe = entries.filter((entry) => entry.startsWith("/") || entry.split("/").includes(".."));
  if (unsafe.length) fail(`${label} contains unsafe paths: ${unsafe.join(", ")}`);
}

function main() {
  const options = args(process.argv.slice(2));
  const studentId = options["student-id"];
  const name = options.name;
  if (!studentId || !/^[A-Za-z0-9-]+$/.test(studentId)) fail("--student-id must contain only letters, numbers or hyphens");
  if (!name || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(name)) fail("--name must be the exact filename-safe student name stem");

  const report = existingFile(options.report, "report");
  const database = existingFile(options.database, "database");
  const declaration = existingFile(options.declaration, "declaration");
  const secureReport = existingFile(options["secure-report"] || "docs/secure_coding/final/VSMS_Secure_Coding_Report.pdf", "secure-report");
  const slides = existingFile(options.slides || "docs/secure_coding/final/VSMS_Demonstration.pptx", "slides");
  if (path.extname(database).toLowerCase() !== ".sql") fail("--database must be the authorized PostgreSQL plain SQL backup required by the brief");
  assertMagic(report, "%PDF", "Individual report");
  assertMagic(secureReport, "%PDF", "Secure Coding report");
  assertMagic(declaration, "PK", "Declaration DOCX");
  assertMagic(slides, "PK", "Presentation PPTX");
  if (!zipNames(declaration).includes("word/document.xml")) fail("Declaration is not a valid DOCX");

  const output = path.resolve(ROOT, options.output || `.submission/${studentId}-${name}.zip`);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const stage = fs.mkdtempSync(path.join(path.dirname(output), `.final-${studentId}-${name}-`));
  const codeZip = path.join(stage, `${name}_Code.zip`);
  const dbZip = path.join(stage, `${name}_Db.zip`);
  try {
    createArchive(codeZip);
    execFileSync("zip", ["-q", "-j", dbZip, database]);
    fs.copyFileSync(report, path.join(stage, `${name}_Project2Report.pdf`));
    fs.copyFileSync(declaration, path.join(stage, `${name}_Declaration.docx`));
    fs.copyFileSync(secureReport, path.join(stage, "VSMS_Secure_Coding_Report.pdf"));
    fs.copyFileSync(slides, path.join(stage, "VSMS_Demonstration.pptx"));

    fs.rmSync(output, { force: true });
    execFileSync("zip", ["-q", "-j", output, ...fs.readdirSync(stage).map((entry) => path.join(stage, entry))]);

    const entries = zipNames(output);
    assertSafeEntries(entries, "Final archive");
    const required = [
      `${name}_Project2Report.pdf`, `${name}_Code.zip`, `${name}_Db.zip`,
      `${name}_Declaration.docx`, "VSMS_Secure_Coding_Report.pdf", "VSMS_Demonstration.pptx",
    ];
    const missing = required.filter((entry) => !entries.includes(entry));
    if (missing.length) fail(`Final archive is missing: ${missing.join(", ")}`);

    const databaseEntries = zipNames(dbZip);
    assertSafeEntries(databaseEntries, "Database archive");
    if (databaseEntries.length !== 1 || !databaseEntries[0].endsWith(".sql")) fail("Database archive must contain exactly one SQL backup");
    console.log(`Created ${output}`);
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
}

if (require.main === module) main();

module.exports = { args, assertSafeEntries };
