/**
 * @fileoverview Threat Model Validator
 * @description Validates docs/threat-model/threat-model.yaml
 */

const fs = require("fs");
const path = require("path");
const yaml = require("yaml");

const threatModelPath = path.join(
  __dirname,
  "../docs/threat-model/threat-model.yaml"
);

try {
  if (!fs.existsSync(threatModelPath)) {
    console.error("❌ Threat model file not found.");
    process.exit(1);
  }

  const file = fs.readFileSync(threatModelPath, "utf8");
  const model = yaml.parse(file);

  let errors = 0;

  console.log("\n========== VSMS Threat Model Validation ==========\n");

  // ------------------------
  // System
  // ------------------------

  if (!model.system) {
    console.error("❌ Missing 'system' section.");
    errors++;
  } else {
    console.log(`✓ System: ${model.system.name}`);
    console.log(`✓ Version: ${model.system.version}`);
  }

  // ------------------------
  // Assets
  // ------------------------

  if (!Array.isArray(model.assets) || model.assets.length === 0) {
    console.error("❌ No assets defined.");
    errors++;
  } else {
    console.log(`✓ Assets: ${model.assets.length}`);
  }

  // ------------------------
  // Components
  // ------------------------

  if (!Array.isArray(model.components) || model.components.length === 0) {
    console.error("❌ No components defined.");
    errors++;
  } else {
    console.log(`✓ Components: ${model.components.length}`);
  }

  // ------------------------
  // Threats
  // ------------------------

  if (!Array.isArray(model.threats) || model.threats.length === 0) {
    console.error("❌ No threats defined.");
    errors++;
  } else {
    console.log(`✓ Threats: ${model.threats.length}\n`);

    model.threats.forEach((threat) => {
      if (!threat.id) {
        console.error("❌ Threat missing id.");
        errors++;
      }

      if (!threat.category) {
        console.error(`❌ ${threat.id}: Missing category.`);
        errors++;
      }

      if (!threat.asset) {
        console.error(`❌ ${threat.id}: Missing asset.`);
        errors++;
      }

      if (!threat.risk) {
        console.error(`❌ ${threat.id}: Missing risk.`);
        errors++;
      }

      if (
        !Array.isArray(threat.mitigation) ||
        threat.mitigation.length === 0
      ) {
        console.error(`❌ ${threat.id}: No mitigation defined.`);
        errors++;
      } else {
        console.log(
          `✓ ${threat.id} (${threat.category}) - ${threat.mitigation.length} mitigation(s)`
        );
      }
    });
  }

  // ------------------------
  // Summary
  // ------------------------

  console.log("\n========================================");

  if (errors > 0) {
    console.error(`❌ Validation failed (${errors} error(s)).`);
    process.exit(1);
  }

  console.log("✅ Threat model validation passed.");
  process.exit(0);

} catch (err) {
  console.error("❌ Failed to parse threat model.");
  console.error(err.message);
  process.exit(1);
}