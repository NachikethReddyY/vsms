"use strict";

const { execFileSync } = require("node:child_process");

const requestedBase = String(process.argv[2] || process.env.MIGRATION_BASE_SHA || "HEAD^").trim();
const base = /^0{40}$/.test(requestedBase) ? "HEAD^" : requestedBase;
const approvedException = process.env.EXPAND_CONTRACT_EXCEPTION === "APPROVED_EXPAND_CONTRACT_EXCEPTION";
const risky = /\b(DROP\s+(?:TABLE|COLUMN|TYPE|INDEX)|TRUNCATE\b|RENAME\s+(?:COLUMN|TABLE)|ALTER\s+COLUMN\b[^;\n]*\bTYPE\b)/i;

let diff;
try {
  diff = execFileSync("git", ["diff", "--unified=0", `${base}...HEAD`, "--", "backend/prisma/migrations/**/migration.sql"], { encoding: "utf8" });
} catch {
  process.stderr.write("Migration safety check failed: MIGRATION_BASE_SHA is not a valid reachable commit.\n");
  process.exit(1);
}

const riskyLines = diff.split(/\r?\n/)
  .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
  .map((line) => line.slice(1).trim())
  .filter((line) => risky.test(line));

if (riskyLines.length && !approvedException) {
  process.stderr.write("Migration safety check failed: destructive or rollback-incompatible SQL requires a reviewed expand-and-contract exception.\n");
  for (const line of riskyLines) process.stderr.write(`- ${line}\n`);
  process.exit(1);
}

process.stdout.write(`${JSON.stringify({ status: "passed", base, riskyStatements: riskyLines.length, exceptionApproved: approvedException })}\n`);
