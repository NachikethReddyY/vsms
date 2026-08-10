/**
 * StationTemplate.templateKey → Station.stationType mapping (#30 / #24).
 * Only screening flows with implemented capture APIs are importable.
 */

const IMPORTABLE_TEMPLATE_KEYS = Object.freeze({
  VISUAL_ACUITY: "VISUAL_ACUITY",
  REFRACTION: "REFRACTION",
  COLOUR_VISION: "COLOUR_VISION",
  EYE_HEALTH: "EYE_HEALTH",
});

const NON_IMPORTABLE_TEMPLATE_KEYS = Object.freeze(["REGISTRATION", "CLINICAL_REVIEW"]);

const stationTypeForTemplateKey = (templateKey) => IMPORTABLE_TEMPLATE_KEYS[templateKey] || null;

const isImportableTemplateKey = (templateKey) => Boolean(stationTypeForTemplateKey(templateKey));

const classifyTemplates = (templates) => {
  const importable = [];
  const skipped = [];
  for (const template of templates) {
    const stationType = stationTypeForTemplateKey(template.templateKey);
    if (stationType) {
      importable.push({ template, stationType });
    } else {
      skipped.push(template);
    }
  }
  return { importable, skipped };
};

module.exports = {
  IMPORTABLE_TEMPLATE_KEYS,
  NON_IMPORTABLE_TEMPLATE_KEYS,
  stationTypeForTemplateKey,
  isImportableTemplateKey,
  classifyTemplates,
};
