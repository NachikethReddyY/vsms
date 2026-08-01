const { compareQueueItems, contextVersion, reviewReadiness } = require("../services/reviewService");
const { reviewDecisionBody } = require("../schemas/screeningSchemas");

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
  test.each([
    ["completed normal", [result(stations[0].stationId), result(stations[1].stationId)], true, "SCREENING_COMPLETE"],
    ["completed flagged", [result(stations[0].stationId, "REFER"), result(stations[1].stationId)], true, "SCREENING_COMPLETE"],
    ["incomplete urgent", [result(stations[0].stationId, "URGENT")], true, "URGENT_FLAG"],
    ["incomplete non-urgent", [result(stations[0].stationId, "REVIEW")], false, null],
  ])("evaluates %s registrations", (_name, results, ready, readyReason) => {
    expect(reviewReadiness(stations, results)).toMatchObject({ ready, readyReason });
  });

  test("a zero-station event is never ready", () => {
    expect(reviewReadiness([], [])).toMatchObject({ ready: false, totalStationCount: 0 });
  });

  test("results from inactive stations do not affect readiness or priority", () => {
    expect(reviewReadiness([stations[0]], [result(stations[0].stationId), result(stations[1].stationId, "URGENT")]))
      .toMatchObject({ ready: true, readyReason: "SCREENING_COMPLETE", highestFlag: "NORMAL", flaggedResultCount: 0 });
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
    const common = { contextVersion: "a".repeat(64), confirmed: true, clinicalSummary: "Clear clinical summary" };
    expect(reviewDecisionBody.safeParse({ ...common, outcome: "COMPLETE" }).success).toBe(true);
    expect(reviewDecisionBody.safeParse({ ...common, outcome: "COMPLETE", referral: { destinationName: "Eye clinic", reason: "Follow-up is required" } }).success).toBe(false);
    expect(reviewDecisionBody.safeParse({ ...common, outcome: "REFER", urgency: "PRIORITY" }).success).toBe(false);
    expect(reviewDecisionBody.safeParse({ ...common, outcome: "REFER", urgency: "PRIORITY", referral: { destinationName: "Eye clinic", reason: "Follow-up is required" } }).success).toBe(true);
    expect(reviewDecisionBody.safeParse({ ...common, outcome: "URGENT_ESCALATION", urgency: "URGENT", referral: { destinationName: "Emergency", reason: "Immediate assessment" } }).success).toBe(false);
  });
});
