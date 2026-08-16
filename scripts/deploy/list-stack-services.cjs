"use strict";

const fs = require("node:fs");

const outputs = JSON.parse(fs.readFileSync(process.argv[2] || "stack-outputs.json", "utf8"));
const serviceKeys = [
  "ApiServiceName",
  "ReportWorkerServiceName",
  "DomainEventWorkerServiceName",
  "LifecycleEmailWorkerServiceName",
];

const services = serviceKeys
  .map((key) => outputs.find((output) => output.OutputKey === key)?.OutputValue)
  .filter(Boolean);

if (services.length < 3) {
  process.stderr.write("The stack must export the API, report, and domain-event services.\n");
  process.exit(1);
}

process.stdout.write(`${services.join("\n")}\n`);
