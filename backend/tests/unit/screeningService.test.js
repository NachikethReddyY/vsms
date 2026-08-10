const test = require("node:test");
const assert = require("node:assert/strict");
const {
  evaluateVisualAcuity,
  evaluateRefraction,
  evaluateColourVision,
  evaluateEyeHealth,
  VA_RULE_VERSION,
  REF_RULE_VERSION,
  CV_RULE_VERSION,
  EH_RULE_VERSION,
} = require("../../services/screening/screeningService");
const {
  saveRefractionBody,
  saveColourVisionBody,
  saveEyeHealthBody,
  previewRefractionBody,
  previewColourVisionBody,
  previewEyeHealthBody,
} = require("../../schemas/screeningSchemas");

test("visual acuity rule version and normal reading", () => {
  const result = evaluateVisualAcuity({
    chartDistanceMetres: 6,
    od: { kind: "FRACTION", denominator: 6 },
    os: { kind: "FRACTION", denominator: 9 },
    withUsualDistanceGlasses: true,
  });
  assert.equal(result.ruleVersion, VA_RULE_VERSION);
  assert.equal(result.overallFlag, "NORMAL");
  assert.equal(result.isFlagged, false);
});

test("refraction flags high cylinder, out-of-range sphere, and anisometropia", () => {
  const highCyl = evaluateRefraction({
    measurementStatus: "COMPLETED",
    wearsDistanceGlasses: false,
    od: { sphere: -1, cylinder: -0.5, axis: 90 },
    os: { sphere: -1.25, cylinder: -3.5, axis: 180 },
  });
  assert.equal(highCyl.ruleVersion, REF_RULE_VERSION);
  assert.equal(highCyl.overallFlag, "REVIEW");
  assert.match(highCyl.flagSummary, /high astigmatism/i);

  const highSph = evaluateRefraction({
    measurementStatus: "COMPLETED",
    wearsDistanceGlasses: null,
    od: { sphere: -7, cylinder: 0, axis: null },
    os: { sphere: -1, cylinder: 0, axis: null },
  });
  assert.equal(highSph.overallFlag, "REFER");

  const unable = evaluateRefraction({
    measurementStatus: "UNABLE_TO_MEASURE",
    wearsDistanceGlasses: null,
    notes: "Poor fixation",
  });
  assert.equal(unable.overallFlag, "REVIEW");
});

test("colour vision flags bilateral fail as review and asymmetry as urgent", () => {
  const normal = evaluateColourVision({
    testKit: "ISHIHARA",
    platesPresented: 11,
    odCorrect: 11,
    osCorrect: 10,
  });
  assert.equal(normal.ruleVersion, CV_RULE_VERSION);
  assert.equal(normal.overallFlag, "NORMAL");

  const bilateral = evaluateColourVision({
    testKit: "ISHIHARA",
    platesPresented: 11,
    odCorrect: 6,
    osCorrect: 5,
  });
  assert.equal(bilateral.overallFlag, "REVIEW");

  const asymmetric = evaluateColourVision({
    testKit: "ISHIHARA",
    platesPresented: 11,
    odCorrect: 11,
    osCorrect: 2,
  });
  assert.equal(asymmetric.overallFlag, "URGENT");
});

test("eye health flags present risk as refer and suspected or symptoms as review", () => {
  const normal = evaluateEyeHealth({
    cataractRisk: "NONE",
    glaucomaRisk: "NOT_ASSESSED",
    symptomsNoted: false,
    observations: "Anterior segment quiet.",
  });
  assert.equal(normal.ruleVersion, EH_RULE_VERSION);
  assert.equal(normal.overallFlag, "NORMAL");

  const suspected = evaluateEyeHealth({
    cataractRisk: "SUSPECTED",
    glaucomaRisk: "NONE",
    symptomsNoted: false,
    observations: "Lens opacity suspected OD.",
  });
  assert.equal(suspected.overallFlag, "REVIEW");

  const present = evaluateEyeHealth({
    cataractRisk: "PRESENT",
    glaucomaRisk: "NONE",
    symptomsNoted: false,
    observations: "Dense cataract OD.",
  });
  assert.equal(present.overallFlag, "REFER");

  const symptoms = evaluateEyeHealth({
    cataractRisk: "NONE",
    glaucomaRisk: "NONE",
    symptomsNoted: true,
    symptomSummary: "Halos at night",
    observations: "Participant reports halos.",
  });
  assert.equal(symptoms.overallFlag, "REVIEW");
});

test("refraction and colour vision schemas accept valid save bodies", () => {
  const refraction = saveRefractionBody.parse({
    registrationId: "11111111-1111-4111-8111-111111111111",
    idempotencyKey: "abcdef12",
    acknowledged: true,
    resultData: {
      measurementStatus: "COMPLETED",
      wearsDistanceGlasses: true,
      od: { sphere: -1.25, cylinder: -0.5, axis: 90 },
      os: { sphere: -1.5, cylinder: 0, axis: null },
    },
  });
  assert.equal(refraction.resultData.measurementStatus, "COMPLETED");

  const colour = saveColourVisionBody.parse({
    registrationId: "11111111-1111-4111-8111-111111111111",
    idempotencyKey: "abcdef12",
    acknowledged: false,
    resultData: {
      testKit: "ISHIHARA",
      platesPresented: 11,
      odCorrect: 11,
      osCorrect: 11,
    },
  });
  assert.equal(colour.resultData.testKit, "ISHIHARA");

  const eyeHealth = saveEyeHealthBody.parse({
    registrationId: "11111111-1111-4111-8111-111111111111",
    idempotencyKey: "abcdef12",
    acknowledged: false,
    resultData: {
      cataractRisk: "NONE",
      glaucomaRisk: "NOT_ASSESSED",
      symptomsNoted: false,
      observations: "Anterior segment quiet.",
    },
  });
  assert.equal(eyeHealth.resultData.cataractRisk, "NONE");

  assert.throws(() => previewEyeHealthBody.parse({
    resultData: {
      cataractRisk: "SUSPECTED",
      glaucomaRisk: "NONE",
      symptomsNoted: true,
      observations: "Symptoms noted without summary.",
    },
  }));

  assert.throws(() => previewRefractionBody.parse({
    resultData: {
      measurementStatus: "COMPLETED",
      wearsDistanceGlasses: null,
      od: { sphere: -1.1, cylinder: 0, axis: null },
      os: { sphere: 0, cylinder: 0, axis: null },
    },
  }));

  assert.throws(() => previewColourVisionBody.parse({
    resultData: {
      testKit: "ISHIHARA",
      platesPresented: 11,
      odCorrect: 12,
      osCorrect: 11,
    },
  }));
});
