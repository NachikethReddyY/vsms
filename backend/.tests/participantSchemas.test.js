const {
  participantSearchBody,
  participantUpdateBody,
  registrationHistoryQuery,
} = require("../schemas/participantSchemas");

describe("participant issue 19 request validation", () => {
  const eventId = "20000000-0000-4000-8000-000000000001";

  test("normalizes an exact NRIC/FIN lookup and supplies pagination defaults", () => {
    expect(participantSearchBody.parse({ eventId, nric: " s1234567a " })).toEqual({
      eventId,
      nric: "S1234567A",
      page: 1,
      limit: 20,
    });
  });

  test("requires a search criterion", () => {
    expect(() => participantSearchBody.parse({ eventId })).toThrow(/Provide a name/);
  });

  test("does not allow profile updates to bypass the consent feature", () => {
    expect(() => participantUpdateBody.parse({
      eventId,
      version: 1,
      consentGiven: true,
    })).toThrow();
  });

  test("requires a profile field in addition to event context and version", () => {
    expect(() => participantUpdateBody.parse({ eventId, version: 1 })).toThrow(/At least one participant field/);
  });

  test("coerces registration history pagination from query strings", () => {
    expect(registrationHistoryQuery.parse({ eventId, page: "2", limit: "10" })).toEqual({
      eventId,
      page: 2,
      limit: 10,
    });
  });
});
