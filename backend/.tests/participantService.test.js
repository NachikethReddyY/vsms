const path = require("path");

const servicePath = path.resolve(__dirname, "../services/participantService.js");
const prismaPath = path.resolve(__dirname, "../prisma/prismaClient.js");

const loadService = (prismaMock) => {
  delete require.cache[servicePath];
  require.cache[prismaPath] = {
    id: prismaPath,
    filename: prismaPath,
    loaded: true,
    exports: prismaMock,
    children: [],
    paths: [],
  };
  return require(servicePath);
};

describe("participant issue 19 service boundary", () => {
  const eventId = "20000000-0000-4000-8000-000000000001";
  const participantId = "50000000-0000-4000-8000-000000000001";
  const actor = {
    id: "10000000-0000-4000-8000-000000000003",
    systemRole: "STAFF",
    requestId: "request-1",
    ipAddress: "127.0.0.1",
  };

  afterEach(() => {
    delete require.cache[servicePath];
    delete require.cache[prismaPath];
  });

  test("requires an active registration assignment for the selected event", async () => {
    const prismaMock = {
      event: { findUnique: vi.fn().mockResolvedValue({ eventId, createdByUserId: "another-user" }) },
      staffAssignment: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    const service = loadService(prismaMock);

    await expect(service.searchParticipants({
      eventId,
      query: "Avery",
      page: 1,
      limit: 20,
    }, actor)).rejects.toMatchObject({
      status: 403,
      code: "PARTICIPANT_ACCESS_DENIED",
    });
  });

  test("returns masked search rows and selected-event duplicate state", async () => {
    const prismaMock = {
      event: { findUnique: vi.fn().mockResolvedValue({ eventId, createdByUserId: "another-user" }) },
      staffAssignment: { findFirst: vi.fn().mockResolvedValue({ id: "assignment-1" }) },
      participant: {
        count: vi.fn().mockResolvedValue(1),
        findMany: vi.fn().mockResolvedValue([{
          id: participantId,
          firstName: "Evelyn",
          lastName: "Ng",
          nricMasked: "SXXXX67A",
          contactNumber: "91234567",
          dateOfBirth: new Date("1958-04-19T00:00:00.000Z"),
          version: 3,
          _count: { eventRegistrations: 2 },
          eventRegistrations: [{
            registrationId: "70000000-0000-4000-8000-000000000001",
            registrationStatus: "SIGNED_UP",
            checkedIn: false,
            queueNumber: 12,
          }],
        }]),
      },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const service = loadService(prismaMock);
    const result = await service.searchParticipants({
      eventId,
      nric: "S1234567A",
      page: 1,
      limit: 20,
    }, actor);

    expect(result.participants[0]).toEqual(expect.objectContaining({
      participantId,
      displayName: "Evelyn Ng",
      nricMasked: "SXXXX67A",
      maskedDateOfBirth: "****-**-19",
      registrationCount: 2,
      selectedEventRegistration: expect.objectContaining({ queueNumber: 12 }),
    }));
    expect(result.participants[0].maskedContactNumber).not.toContain("9123");
    expect(prismaMock.participant.findMany.mock.calls[0][0].where.AND[0].nricLookupHash).toMatch(/^[a-f0-9]{64}$/);
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: "PARTICIPANT_SEARCHED" }),
    }));
  });

  test("rejects stale profile updates before writing", async () => {
    const tx = {
      participant: {
        findUnique: vi.fn().mockResolvedValue({ id: participantId, version: 4 }),
        updateMany: vi.fn(),
      },
    };
    const prismaMock = {
      event: { findUnique: vi.fn().mockResolvedValue({ eventId, createdByUserId: actor.id }) },
      staffAssignment: { findFirst: vi.fn() },
      $transaction: vi.fn((callback) => callback(tx)),
    };
    const service = loadService(prismaMock);

    await expect(service.updateParticipant(participantId, {
      eventId,
      version: 3,
      contactNumber: "91234567",
    }, { ...actor, systemRole: "EVENT_MANAGER" })).rejects.toMatchObject({
      status: 409,
      code: "PARTICIPANT_VERSION_CONFLICT",
    });
    expect(tx.participant.updateMany).not.toHaveBeenCalled();
  });
});
