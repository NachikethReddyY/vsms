const SUPPORTED_SCREENING_STATION_TYPES = Object.freeze([
  "VISUAL_ACUITY",
  "REFRACTION",
  "COLOUR_VISION",
  "EYE_HEALTH",
]);

const stationTypeForTemplate = (template) => (
  SUPPORTED_SCREENING_STATION_TYPES.includes(template?.stationType) ? template.stationType : null
);

const classifyTemplates = (templates) => {
  const importable = [];
  const skipped = [];
  for (const template of templates) {
    const stationType = stationTypeForTemplate(template);
    if (stationType) {
      importable.push({ template, stationType });
    } else {
      skipped.push(template);
    }
  }
  return { importable, skipped };
};

module.exports = {
  SUPPORTED_SCREENING_STATION_TYPES,
  stationTypeForTemplate,
  classifyTemplates,
};
