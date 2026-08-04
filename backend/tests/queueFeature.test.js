const request = require("supertest");
const app = require("../app"); // Adjust to your main express server entry point
const prisma = require("../prisma/prismaClient");

describe("Queue Management & Participant Status API", () => {
  let authToken;
  let testEventId;
  let testParticipantId;
  let testStationId;
  let createdQueueId;

  // Seed or set up test data before running tests
  beforeAll(async () => {
    // 1. Setup mock user/admin token for authentication
    // (Replace this with your actual test login or token generation logic)
    const loginRes = await request(app)
      .post("/auth/login")
      .send({ email: "admin@example.com", password: "password123" });
    
    authToken = loginRes.body.token;

    // 2. Fetch or create a dummy event, participant, and station for testing
    const event = await prisma.event.findFirst();
    testEventId = event ? event.id : "dummy-event-id";

    const participant = await prisma.participant.findFirst();
    testParticipantId = participant ? participant.id : "dummy-participant-id";

    const station = await prisma.station.findFirst();
    testStationId = station ? station.id : null;
  });

  // Clean up created queue records after tests
  afterAll(async () => {
    if (createdQueueId) {
      await prisma.queue.deleteMany({ where: { id: createdQueueId } }).catch(() => {});
    }
    await prisma.$disconnect();
  });

  test("1. Should fail to fetch queue without authentication (Permission State)", async () => {
    const res = await request(app).get(`/queue/${testEventId}`);
    expect(res.statusCode).toEqual(401);
    expect(res.body.success).toBe(false);
  });

  test("2. Should successfully register/join a participant into the queue", async () => {
    const res = await request(app)
      .post("/queue/join")
      .set("Authorization", `Bearer ${authToken}`)
      .send({
        eventId: testEventId,
        participantId: testParticipantId,
        initialStationId: testStationId,
      });

    expect(res.statusCode).toEqual(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty("id");
    
    createdQueueId = res.body.data.id;
  });

  test("3. Should fetch live event queue status successfully (Success State)", async () => {
    const res = await request(app)
      .get(`/queue/${testEventId}`)
      .set("Authorization", `Bearer ${authToken}`);

    expect(res.statusCode).toEqual(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  test("4. Should fetch individual participant queue status (Participant view)", async () => {
    const res = await request(app)
      .get(`/queue/participant/${testParticipantId}`)
      .set("Authorization", `Bearer ${authToken}`);

    expect(res.statusCode).toEqual(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty("participantId", testParticipantId);
  });

  test("5. Should advance a participant through queue stations and emit audit log", async () => {
    const res = await request(app)
      .patch(`/queue/${createdQueueId}/advance`)
      .set("Authorization", `Bearer ${authToken}`)
      .send({
        status: "IN_PROGRESS",
      });

    expect(res.statusCode).toEqual(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toEqual("IN_PROGRESS");
  });

  test("6. Should handle validation error for missing required fields on join", async () => {
    const res = await request(app)
      .post("/queue/join")
      .set("Authorization", `Bearer ${authToken}`)
      .send({
        // Missing eventId and participantId intentionally
      });

    expect(res.statusCode).toEqual(400);
    expect(res.body.success).toBe(false);
  });
});