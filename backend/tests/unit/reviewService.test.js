const { test, describe } = require("node:test");
const { expect } = require("expect");
const {
  assertReviewOutcomeAllowed,
  compareQueueItems,
  contextVersion,
  reviewReadiness,
  routeStations,
  stopRouteForUrgentReview,
  unfinishedRouteStationIds,
} = require("../../services/screening/reviewService");
const { reviewDecisionBody } = require("../../schemas/screeningSchemas");

const stations = [
  { stationId: "10000000-0000-4000-8000-000000000001" },
  { stationId: "10000000-0000-4000-8000-000000000002" },
];
const result = (stationId, overallFlag = "NORMAL", minute = 0) => ({
  resultId: stationId.replace(/^1/, "2"),
  stationId,
  overallFlag,
  updatedAt: new Date(`2026-07-29T00:${String(minute).padStart(2, "0")}:00.000Z`),
});

describe("clinical review eligibility and ordering", () => {
  const readinessCases = [
    ["completed normal", [result(stations[0].stationId), result(stations[1].stationId)], true, "SCREENING_COMPLETE"],
    ["completed flagged", [result(stations[0].stationId, "REFER"), result(stations[1].stationId)], true, "SCREENING_COMPLETE"],
    ["incomplete urgent", [result(stations[0].stationId, "URGENT")], true, "URGENT_FLAG"],
    ["incomplete non-urgent", [result(stations[0].stationId, "REVIEW")], false, null],
  ];
  for (const [name, results, ready, readyReason] of readinessCases) {
    test(`evaluates ${name} registrations`, () => {
      expect(reviewReadiness(stations, results)).toMatchObject({ ready, readyReason });
    });
  }

  test("a zero-station event is never ready", () => {
    expect(reviewReadiness([], [])).toMatchObject({ ready: false, totalStationCount: 0 });
  });

  test("results from inactive stations do not affect readiness or priority", () => {
    expect(reviewReadiness([stations[0]], [result(stations[0].stationId), result(stations[1].stationId, "URGENT")]))
      .toMatchObject({ ready: true, readyReason: "SCREENING_COMPLETE", highestFlag: "NORMAL", flaggedResultCount: 0 });
  });

  test("uses the persisted registration route rather than current event configuration", () => {
    const registration = {
      routeSteps: [
        { position: 2, station: stations[1] },
        { position: 1, station: stations[0] },
      ],
    };
    expect(routeStations(registration)).toEqual(stations);
    expect(reviewReadiness(routeStations(registration), [result(stations[0].stationId)]))
      .toMatchObject({ ready: false, completedStationCount: 1, totalStationCount: 2 });
  });

  test("incomplete urgent review requires urgent escalation and cancels the active queue", async () => {
    const readiness = reviewReadiness(stations, [result(stations[0].stationId, "URGENT")]);
    expect(() => assertReviewOutcomeAllowed(readiness, "REFER"))
      .toThrow(expect.objectContaining({ code: "URGENT_ESCALATION_REQUIRED" }));
    expect(assertReviewOutcomeAllowed(readiness, "URGENT_ESCALATION")).toBe(true);

    let statement;
    const stopped = await stopRouteForUrgentReview({
      $queryRaw: async (query) => {
        statement = query.strings.join(" ");
        return [{ p_cancelled_count: 1 }];
      },
    }, "10000000-0000-4000-8000-000000000010", "10000000-0000-4000-8000-000000000011", new Date("2026-08-12T12:00:00.000Z"));
    expect(stopped.count).toBe(1);
    expect(statement).toMatch(/sp_vsms_cancel_active_registration_queue/);
    expect(unfinishedRouteStationIds([
      { stationId: stations[1].stationId, position: 2, completedAt: null },
      { stationId: stations[0].stationId, position: 1, completedAt: new Date() },
    ])).toEqual([stations[1].stationId]);
  });

  test("orders severity, queue number with null last, then display name", () => {
    const items = [
      { highestFlag: "NORMAL", queueNumber: 1, participantDisplayName: "Zara" },
      { highestFlag: "URGENT", queueNumber: null, participantDisplayName: "Zed" },
      { highestFlag: "URGENT", queueNumber: 4, participantDisplayName: "Bea" },
      { highestFlag: "URGENT", queueNumber: 4, participantDisplayName: "Ana" },
      { highestFlag: "REFER", queueNumber: 2, participantDisplayName: "Ravi" },
      { highestFlag: "REVIEW", queueNumber: 3, participantDisplayName: "Mina" },
    ];
    expect(items.sort(compareQueueItems).map((item) => item.participantDisplayName))
      .toEqual(["Ana", "Bea", "Zed", "Ravi", "Mina", "Zara"]);
  });
});

describe("clinical review context and request contract", () => {
  test("context changes when an active station or active result changes", () => {
    const results = [result(stations[0].stationId)];
    const original = contextVersion(stations, results);
    expect(contextVersion([...stations, { stationId: "10000000-0000-4000-8000-000000000003" }], results)).not.toBe(original);
    expect(contextVersion(stations, [result(stations[0].stationId, "NORMAL", 1)])).not.toBe(original);
  });

  test("referral fields are accepted only for referral outcomes", () => {
    const eyeHealthObservations = {
      cataractRisk: "NOT_ASSESSED",
      glaucomaRisk: "NONE",
      symptomsNoted: false,
      observations: "Anterior segment quiet; no media opacity noted.",
    };
    const common = {
      contextVersion: "a".repeat(64),
      confirmed: true,
      clinicalSummary: "Clear clinical summary",
      eyeHealthObservations,
      signatureObjectKey: "signatures/10000000-0000-4000-8000-000000000001/review-decision-10000000-0000-4000-8000-000000000002-10000000-0000-4000-8000-000000000003.png",
      signatureSha256: "b".repeat(64),
      signatureMimeType: "image/png",
    };
    expect(reviewDecisionBody.safeParse({ ...common, outcome: "COMPLETE" }).success).toBe(true);
    expect(reviewDecisionBody.safeParse({ ...common, outcome: "COMPLETE", referral: { destinationName: "Eye clinic", reason: "Follow-up is required" } }).success).toBe(false);
    expect(reviewDecisionBody.safeParse({ ...common, outcome: "REFER", urgency: "PRIORITY" }).success).toBe(false);
    expect(reviewDecisionBody.safeParse({ ...common, outcome: "REFER", urgency: "PRIORITY", referral: { destinationName: "Eye clinic", reason: "Follow-up is required" } }).success).toBe(true);
    expect(reviewDecisionBody.safeParse({ ...common, outcome: "URGENT_ESCALATION", urgency: "URGENT", referral: { destinationName: "Emergency", reason: "Immediate assessment" } }).success).toBe(false);
  });

  test("eye-health observations are optional and symptoms need a summary when provided", () => {
    const common = {
      contextVersion: "a".repeat(64),
      confirmed: true,
      clinicalSummary: "Clear clinical summary",
      signatureObjectKey: "signatures/10000000-0000-4000-8000-000000000001/review-decision-10000000-0000-4000-8000-000000000002-10000000-0000-4000-8000-000000000003.png",
      signatureSha256: "b".repeat(64),
      signatureMimeType: "image/png",
      outcome: "COMPLETE",
    };
    expect(reviewDecisionBody.safeParse(common).success).toBe(true);
    expect(reviewDecisionBody.safeParse({
      ...common,
      eyeHealthObservations: {
        cataractRisk: "SUSPECTED",
        glaucomaRisk: "NONE",
        symptomsNoted: true,
        observations: "Lens opacity suspected OD.",
      },
    }).success).toBe(false);
    expect(reviewDecisionBody.safeParse({
      ...common,
      eyeHealthObservations: {
        cataractRisk: "SUSPECTED",
        glaucomaRisk: "NONE",
        symptomsNoted: true,
        symptomSummary: "Blurry vision",
        observations: "Lens opacity suspected OD.",
      },
    }).success).toBe(true);
  });
});
