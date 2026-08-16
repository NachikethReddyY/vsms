"use strict";

const productionMarkers = [process.env.NODE_ENV, process.env.DEPLOY_ENVIRONMENT]
  .map((value) => String(value || "").trim().toLowerCase());

if (productionMarkers.includes("production")) {
  process.stderr.write("Refusing to run a destructive/demo database command in production. Use the approved one-off migration task with `pnpm deploy:migrate`.\n");
  process.exit(1);
}
