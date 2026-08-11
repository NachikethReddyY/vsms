const SUPPORTED_SCREENING_STATION_TYPES = Object.freeze([
  "VISUAL_ACUITY",
  "REFRACTION",
  "COLOUR_VISION",
  "CUSTOM",
]);

const CLINICAL_ONE_PER_EVENT_TYPES = Object.freeze([
  "VISUAL_ACUITY",
  "REFRACTION",
  "COLOUR_VISION",
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

/** Clinical types: one template per type in a batch. CUSTOM may repeat different templates. */
const assertImportableBatch = (importable) => {
  const clinicalSeen = new Set();
  const customTemplateIds = new Set();
  for (const { template, stationType } of importable) {
    if (stationType === "CUSTOM") {
      if (customTemplateIds.has(template.stationTemplateId)) {
        const error = new Error("Choose each custom template at most once per import");
        error.code = "DUPLICATE_STATION_TYPE";
        error.status = 422;
        throw error;
      }
      customTemplateIds.add(template.stationTemplateId);
      continue;
    }
    if (clinicalSeen.has(stationType)) {
      const error = new Error("Choose only one template for each screening station type");
      error.code = "DUPLICATE_STATION_TYPE";
      error.status = 422;
      throw error;
    }
    clinicalSeen.add(stationType);
  }
};

const findExistingStation = (stations, { stationType, stationTemplateId }) => {
  if (stationType === "CUSTOM") {
    return stations.find((station) => (
      station.stationType === "CUSTOM" && station.stationTemplateId === stationTemplateId
    ));
  }
  return stations.find((station) => station.stationType === stationType);
};

module.exports = {
  SUPPORTED_SCREENING_STATION_TYPES,
  CLINICAL_ONE_PER_EVENT_TYPES,
  stationTypeForTemplate,
  classifyTemplates,
  assertImportableBatch,
  findExistingStation,
};
