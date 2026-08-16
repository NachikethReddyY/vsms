"use strict";

const fs = require("node:fs");

const [manifestPath, outputKey] = process.argv.slice(2);
if (!manifestPath || !outputKey) {
  process.stderr.write("Usage: node read-stack-output.cjs <outputs.json> <OutputKey>\n");
  process.exit(2);
}

let outputs;
try {
  outputs = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
} catch {
  process.stderr.write("Stack outputs must be valid JSON.\n");
  process.exit(1);
}

const entry = Array.isArray(outputs) && outputs.find((output) => output.OutputKey === outputKey);
if (!entry?.OutputValue) {
  process.stderr.write(`Required CloudFormation output ${outputKey} was not found.\n`);
  process.exit(1);
}

process.stdout.write(String(entry.OutputValue));
