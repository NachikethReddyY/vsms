const crypto = require("crypto");
const request = require("supertest");
const helpers = require("./helpers");
const app = require("../app");

let managerToken;
let staffToken;
let adminToken;
let manager;
let staffUser;
let administrator;

const createUser = (applicationRole, label = `${applicationRole}-${crypto.randomUUID().slice(0, 8)}`) =>
  helpers.ensureTestUser(applicationRole, label);

beforeAll(async () => {
  manager = await helpers.ensureTestUser("EVENT_MANAGER", "event-manager");
  staffUser = await helpers.ensureTestUser("REGISTRATION_OFFICER", "staff");
  administrator = await helpers.ensureTestUser("ADMINISTRATOR", "event-administrator");
  managerToken = helpers.accessTokenFor(manager);
  staffToken = helpers.accessTokenFor(staffUser);
  adminToken = helpers.accessTokenFor(administrator);
});

afterAll(async () => helpers.prisma.$disconnect());

const newEvent = () => {
  const startsAt = new Date(Date.UTC(2030 + crypto.randomInt(10), crypto.randomInt(12), crypto.randomInt(1, 25), 1));
  const endsAt = new Date(startsAt.getTime() + 6 * 3600000);
  return {
    name: `Integration event ${crypto.randomUUID().slice(0, 8)}`,
    description: "Created by an isolated API integration test.",
    venue: "Integration Hall",
    timezone: "Asia/Singapore",
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    capacity: 90,
    shifts: [{ name: "Main shift", startsAt: startsAt.toISOString(), endsAt: new Date(startsAt.getTime() + 4 * 3600000).toISOString(), requiredStaff: 4 }],
  };
};

describe("event lifecycle", () => {
  test("manager atomically creates a multi-day station and staffing plan", async () => {
    const staff = await createUser("SCREENER");
    const template = await helpers.prisma.stationTemplate.upsert({
      where: { templateKey: "VISUAL_ACUITY" },
      update: { active: true, name: "Clinical screening", defaultCapacity: 12 },
      create: {
        templateKey: "VISUAL_ACUITY",
        version: 1,
        name: "Clinical screening",
        description: "Multi-day wizard test station.",
        defaultCapacity: 12,
        active: true,
      },
    });
    const instant = (date, time) => new Date(`${date}T${time}:00+08:00`).toISOString();
    const payload = {
      name: "Multi-day planning integration",
      description: "Exercises the complete event wizard payload.",
      venue: "Our Tampines Hub",
      address: "1 Tampines Walk, Singapore 528523",
      postalCode: "528523",
      latitude: 1.3526,
      longitude: 103.94,
      locationProvider: "ONEMAP",
      locationReference: `528523:${crypto.randomUUID()}`,
      timezone: "Asia/Singapore",
      startsAt: instant("2048-06-01", "09:00"),
      endsAt: instant("2048-06-02", "18:00"),
      capacity: 500,
      expectedAttendance: 7000,
      eventDays: [
        { date: "2048-06-01", startsAt: instant("2048-06-01", "09:00"), endsAt: instant("2048-06-01", "17:00") },
        { date: "2048-06-02", startsAt: instant("2048-06-02", "10:00"), endsAt: instant("2048-06-02", "18:00") },
      ],
      stations: [{
        stationTemplateId: template.stationTemplateId,
        stationOrder: 1,
        capacity: 12,
        isAvailable: true,
        availabilities: [
          { date: "2048-06-01", isAvailable: true, startsAt: instant("2048-06-01", "09:30"), endsAt: instant("2048-06-01", "16:30"), capacity: 10 },
          { date: "2048-06-02", isAvailable: false, startsAt: null, endsAt: null, capacity: 12 },
        ],
      }],
      shifts: [{
        name: "Day one screeners",
        startsAt: instant("2048-06-01", "09:30"),
        endsAt: instant("2048-06-01", "16:30"),
        requiredStaff: 1,
        assignments: [{
          userId: staff.id,
          assignmentRole: "SCREENER",
          stationTemplateId: template.stationTemplateId,
          notes: "Report to the clinical lead at 09:15.",
        }],
      }],
    };

    const idempotencyKey = `wizard-${crypto.randomUUID()}`;
    const created = await request(app).post("/api/events")
      .set("Authorization", `Bearer ${managerToken}`)
      .set("Idempotency-Key", idempotencyKey)
      .send(payload);
    expect(created.status).toBe(201);
    expect(created.body).toEqual(expect.objectContaining({
      timezone: "Asia/Singapore",
      expectedAttendance: 7000,
      postalCode: "528523",
    }));
    for (const key of ["createIdempotencyKey", "createPayloadHash", "createdByUserId", "cancelledByUserId"]) {
      expect(Object.hasOwn(created.body, key)).toBe(false);
    }
    expect(created.body.eventDays).toHaveLength(2);
    expect(created.body.eventStations).toHaveLength(1);
    expect(created.body.eventStations[0]).toEqual(expect.objectContaining({
      stationTemplateId: template.stationTemplateId,
      name: template.name,
      // Day-level capacity rows may exist in DB; OpenAPI DTO still returns [] until availability wiring lands.
      availabilities: [],
    }));
    expect(created.body.shifts[0].staffAssignments[0]).toEqual(expect.objectContaining({
      assignmentRole: "SCREENER",
      notes: "Report to the clinical lead at 09:15.",
      eventStation: expect.objectContaining({ stationTemplateId: template.stationTemplateId }),
    }));
    const replay = await request(app).post("/api/events")
      .set("Authorization", `Bearer ${managerToken}`)
      .set("Idempotency-Key", idempotencyKey)
      .send(payload);
    expect(replay.status).toBe(201);
    expect(replay.body.eventId).toBe(created.body.eventId);

    const audit = await request(app).get(`/api/events/${created.body.eventId}/audit-log`).set("Authorization", `Bearer ${managerToken}`);
    const snapshotAssignment = audit.body.auditLogs[0].afterSnapshot.shifts[0].staffAssignments[0];
    expect(snapshotAssignment.notes).toBe("[redacted]");
  });

  test("manager creates, updates and publishes an atomically audited event", async () => {
    const artworkDataUrl = `data:image/jpeg;base64,${Buffer.from("custom event artwork").toString("base64")}`;
    const created = await request(app).post("/api/events").set("Authorization", `Bearer ${managerToken}`).send({ ...newEvent(), artworkDataUrl });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe("DRAFT");
    expect(created.body.bannerKey).toBe("COMMUNITY_SCREENING");
    expect(created.body.artworkDataUrl).toBe(artworkDataUrl);
    expect(created.body.shifts).toHaveLength(1);

    const updated = await request(app)
      .patch(`/api/events/${created.body.eventId}`)
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ version: created.body.version, capacity: 100, bannerKey: "LIBRARY_SCREENING", artworkDataUrl: null });
    expect(updated.status).toBe(200);
    expect(updated.body.version).toBe(created.body.version + 1);
    expect(updated.body.bannerKey).toBe("LIBRARY_SCREENING");
    expect(updated.body.artworkDataUrl).toBeNull();

    const stale = await request(app)
      .patch(`/api/events/${created.body.eventId}`)
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ version: created.body.version, capacity: 110 });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe("STALE_EVENT_VERSION");

    const published = await request(app)
      .post(`/api/events/${created.body.eventId}/publish`)
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ version: updated.body.version });
    expect(published.status).toBe(200);
    expect(published.body.status).toBe("PUBLISHED");

    const audit = await request(app).get(`/api/events/${created.body.eventId}/audit-log`).set("Authorization", `Bearer ${managerToken}`);
    expect(audit.status).toBe(200);
    expect(audit.body.auditLogs.map((row) => row.action)).toEqual(expect.arrayContaining(["CREATED", "UPDATED", "PUBLISHED"]));
  });

  test("staff cannot create events", async () => {
    const response = await request(app).post("/api/events").set("Authorization", `Bearer ${staffToken}`).send(newEvent());
    expect(response.status).toBe(403);
  });

  test("event management requires the caller's own active manager assignment and matching account role", async () => {
    const created = await request(app).post("/api/events").set("Authorization", `Bearer ${managerToken}`).send(newEvent());
    const otherManager = await createUser("EVENT_MANAGER");
    const unassignedManager = await createUser("EVENT_MANAGER");
    const otherManagerToken = helpers.accessTokenFor(otherManager);
    const unassignedManagerToken = helpers.accessTokenFor(unassignedManager);
    const shiftId = created.body.shifts[0].shiftId;

    const assignedSupport = await request(app)
      .post(`/api/events/${created.body.eventId}/shifts/${shiftId}/assignments`)
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ version: created.body.version, userId: otherManager.userId, assignmentRole: "SUPPORT" });
    expect(assignedSupport.status).toBe(422);
    expect(assignedSupport.body.code).toBe("STAFF_ROLE_MISMATCH");
    const assignedManagerRole = await request(app)
      .post(`/api/events/${created.body.eventId}/shifts/${shiftId}/assignments`)
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ version: created.body.version, userId: otherManager.userId, assignmentRole: "EVENT_MANAGER" });
    expect(assignedManagerRole.status).toBe(201);

    const visible = await request(app)
      .get(`/api/events/${created.body.eventId}`)
      .set("Authorization", `Bearer ${otherManagerToken}`);
    expect(visible.status).toBe(200);
    expect(visible.body.canManage).toBe(true);

    const denied = await request(app)
      .patch(`/api/events/${created.body.eventId}`)
      .set("Authorization", `Bearer ${unassignedManagerToken}`)
      .send({ version: assignedManagerRole.body.version, capacity: 91 });
    expect(denied.status).toBe(404);

    await helpers.prisma.staffAssignment.updateMany({
      where: { shiftId, userId: otherManager.userId },
      data: { status: "COMPLETED", assignmentStatus: "COMPLETED" },
    });
    const historical = await request(app)
      .get(`/api/events/${created.body.eventId}`)
      .set("Authorization", `Bearer ${otherManagerToken}`);
    expect(historical.status).toBe(404);
  });

  test("manager sees named staff, collected signups, and active venue capacity", async () => {
    const created = await request(app).post("/api/events").set("Authorization", `Bearer ${managerToken}`).send(newEvent());
    const staff = await helpers.prisma.user.findUniqueOrThrow({ where: { email: "staff@tests.vsms.local" } });
    const shift = created.body.shifts[0];

    const assigned = await request(app)
      .post(`/api/events/${created.body.eventId}/shifts/${shift.shiftId}/assignments`)
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ version: created.body.version, userId: staff.id, assignmentRole: "REGISTRATION" });

    expect(assigned.status).toBe(201);
    expect(assigned.body.signupCount).toBe(0);
    expect(assigned.body.activeCapacityCount).toBe(0);
    expect(assigned.body.shifts[0].staffAssignments).toEqual([
      expect.objectContaining({
        assignmentRole: "REGISTRATION",
        user: { userId: staff.id, username: staff.username },
      }),
    ]);

    for (const [index, registrationStatus] of ["SIGNED_UP", "CHECKED_IN", "COMPLETED", "CANCELLED"].entries()) {
      const participant = await helpers.prisma.participant.create({
        data: {
          participantReference: `EVT-${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`,
          firstName: `Capacity${index}`,
          lastName: "Participant",
          dateOfBirth: new Date("1980-01-01T00:00:00.000Z"),
          gender: "U",
          contactNumber: `+65 6000 10${String(index).padStart(2, "0")}`,
          emergencyContact: "+65 6000 2000",
          consentGiven: true,
          createdById: staff.id,
          updatedById: staff.id,
        },
      });
      await helpers.prisma.eventRegistration.create({
        data: {
          eventId: created.body.eventId,
          participantId: participant.id,
          registeredBy: staff.id,
          registrationStatus,
          idempotencyKey: `capacity-${crypto.randomUUID()}`,
          checkedIn: registrationStatus === "CHECKED_IN",
          checkedInAt: registrationStatus === "CHECKED_IN" ? new Date() : null,
        },
      });
    }
    const withRegistrations = await request(app)
      .get(`/api/events/${created.body.eventId}`)
      .set("Authorization", `Bearer ${managerToken}`);

    expect(withRegistrations.body.signupCount).toBe(4);
    expect(withRegistrations.body.activeCapacityCount).toBe(1);

    const assignmentId = assigned.body.shifts[0].staffAssignments[0].staffAssignmentId;
    const removed = await request(app)
      .delete(`/api/events/${created.body.eventId}/shifts/${shift.shiftId}/assignments/${assignmentId}?version=${assigned.body.version}`)
      .set("Authorization", `Bearer ${managerToken}`);

    expect(removed.status).toBe(200);
    expect(removed.body.shifts[0].staffAssignments).toEqual([]);
  });

  test("manager imports and configures screening stations via Station upsert", async () => {
    const payload = newEvent();
    const created = await request(app).post("/api/events").set("Authorization", `Bearer ${managerToken}`).send(payload);
    expect(created.status).toBe(201);

    const templates = await Promise.all(["VISUAL_ACUITY", "REFRACTION"].map((templateKey, index) => helpers.prisma.stationTemplate.upsert({
      where: { templateKey },
      update: { active: true, name: `Integration ${templateKey}`, defaultCapacity: index + 2 },
      create: {
        templateKey,
        version: 1,
        name: `Integration ${templateKey}`,
        description: `Template ${templateKey}`,
        defaultCapacity: index + 2,
        active: true,
      },
    })));
    const registration = await helpers.prisma.stationTemplate.upsert({
      where: { templateKey: "REGISTRATION" },
      update: { active: true },
      create: {
        templateKey: "REGISTRATION",
        version: 1,
        name: "Registration",
        description: "Not a StationType",
        defaultCapacity: 3,
        active: true,
      },
    });

    const skipped = await request(app)
      .post(`/api/events/${created.body.eventId}/stations/import`)
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ version: created.body.version, stationTemplateIds: [registration.stationTemplateId] });
    expect(skipped.status).toBe(422);
    expect(skipped.body.code).toBe("STATION_TEMPLATE_NOT_IMPORTABLE");

    const imported = await request(app)
      .post(`/api/events/${created.body.eventId}/stations/import`)
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ version: created.body.version, stationTemplateIds: templates.map((template) => template.stationTemplateId) });
    expect(imported.status).toBe(201);
    expect(imported.body.eventStations).toHaveLength(2);
    expect(imported.body.eventStations[0]).toEqual(expect.objectContaining({
      name: templates[0].name,
      capacity: templates[0].defaultCapacity,
      stationOrder: 1,
      stationTemplateId: templates[0].stationTemplateId,
    }));

    const reimported = await request(app)
      .post(`/api/events/${created.body.eventId}/stations/import`)
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ version: imported.body.version, stationTemplateIds: [templates[0].stationTemplateId] });
    expect(reimported.status).toBe(201);
    expect(reimported.body.eventStations).toHaveLength(2);

    const secondStation = imported.body.eventStations[1];
    const configured = await request(app)
      .patch(`/api/events/${created.body.eventId}/stations/${secondStation.eventStationId}`)
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ version: reimported.body.version, stationOrder: 1, isAvailable: false });
    expect(configured.status).toBe(200);
    expect(configured.body.eventStations[0]).toEqual(expect.objectContaining({
      eventStationId: secondStation.eventStationId,
      stationOrder: 1,
      isAvailable: false,
    }));

    const denied = await request(app)
      .patch(`/api/events/${created.body.eventId}/stations/${secondStation.eventStationId}`)
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ version: configured.body.version, isAvailable: true });
    expect(denied.status).toBe(404);
  });

  test("schedule conflicts are serialized across events and rechecked on shift edits", async () => {
    const staff = await createUser("SUPPORT");
    const dayStart = new Date("2045-05-12T00:00:00.000Z");
    const morningStart = new Date("2045-05-12T01:00:00.000Z");
    const morningEnd = new Date("2045-05-12T05:00:00.000Z");
    const afternoonStart = new Date("2045-05-12T10:00:00.000Z");
    const afternoonEnd = new Date("2045-05-12T14:00:00.000Z");
    const eventPayload = (name, startsAt, endsAt) => ({
      ...newEvent(),
      name,
      startsAt: dayStart.toISOString(),
      endsAt: new Date("2045-05-12T23:00:00.000Z").toISOString(),
      shifts: [{ name: `${name} shift`, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), requiredStaff: 1 }],
    });
    const [first, second] = await Promise.all([
      request(app).post("/api/events").set("Authorization", `Bearer ${managerToken}`).send(eventPayload("Concurrent A", morningStart, morningEnd)),
      request(app).post("/api/events").set("Authorization", `Bearer ${managerToken}`).send(eventPayload("Concurrent B", morningStart, morningEnd)),
    ]);
    expect([first.status, second.status]).toEqual([201, 201]);

    const results = await Promise.all([first, second].map((created) => request(app)
      .post(`/api/events/${created.body.eventId}/shifts/${created.body.shifts[0].shiftId}/assignments`)
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ version: created.body.version, userId: staff.userId, assignmentRole: "SUPPORT" })));
    expect(results.map(({ status }) => status).sort()).toEqual([201, 409]);
    const conflict = results.find(({ status }) => status === 409);
    expect(conflict.body.code).toBe("STAFF_SCHEDULE_CONFLICT");
    expect(conflict.body.title).toBe("This staff member is already assigned during that time");
    expect(conflict.body.title).not.toContain("Concurrent");

    const afternoon = await request(app)
      .post("/api/events")
      .set("Authorization", `Bearer ${managerToken}`)
      .send(eventPayload("Afternoon", afternoonStart, afternoonEnd));
    const assignedAfternoon = await request(app)
      .post(`/api/events/${afternoon.body.eventId}/shifts/${afternoon.body.shifts[0].shiftId}/assignments`)
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ version: afternoon.body.version, userId: staff.userId, assignmentRole: "SUPPORT" });
    expect(assignedAfternoon.status).toBe(201);

    const editedIntoConflict = await request(app)
      .patch(`/api/events/${afternoon.body.eventId}`)
      .set("Authorization", `Bearer ${managerToken}`)
      .send({
        version: assignedAfternoon.body.version,
        shifts: [{
          shiftId: afternoon.body.shifts[0].shiftId,
          name: afternoon.body.shifts[0].name,
          startsAt: morningStart.toISOString(),
          endsAt: morningEnd.toISOString(),
          requiredStaff: 1,
        }],
      });
    expect(editedIntoConflict.status).toBe(409);
    expect(editedIntoConflict.body.code).toBe("STAFF_SCHEDULE_CONFLICT");
  });

  test("in-progress events allow operational edits while terminal events reject operational fields", async () => {
    const created = await request(app).post("/api/events").set("Authorization", `Bearer ${managerToken}`).send(newEvent());
    const published = await request(app).post(`/api/events/${created.body.eventId}/publish`).set("Authorization", `Bearer ${managerToken}`).send({ version: created.body.version });
    const started = await request(app).post(`/api/events/${created.body.eventId}/start`).set("Authorization", `Bearer ${managerToken}`).send({ version: published.body.version });
    const updated = await request(app).patch(`/api/events/${created.body.eventId}`).set("Authorization", `Bearer ${managerToken}`).send({ version: started.body.version, capacity: 100 });
    expect(updated.status).toBe(200);
    expect(updated.body.capacity).toBe(100);

    const deniedRunningIdentityChange = await request(app).patch(`/api/events/${created.body.eventId}`).set("Authorization", `Bearer ${managerToken}`).send({ version: updated.body.version, name: "Updated while running" });
    expect(deniedRunningIdentityChange.status).toBe(409);
    expect(deniedRunningIdentityChange.body.code).toBe("EVENT_NOT_EDITABLE");

    const completed = await request(app).post(`/api/events/${created.body.eventId}/complete`).set("Authorization", `Bearer ${managerToken}`).send({ version: updated.body.version });
    const denied = await request(app).patch(`/api/events/${created.body.eventId}`).set("Authorization", `Bearer ${managerToken}`).send({ version: completed.body.version, capacity: 101 });
    expect(denied.status).toBe(409);
    expect(denied.body.code).toBe("EVENT_NOT_EDITABLE");
  });

  test("server and database reject invalid ranges", async () => {
    const payload = newEvent();
    payload.endsAt = payload.startsAt;
    const response = await request(app).post("/api/events").set("Authorization", `Bearer ${managerToken}`).send(payload);
    expect(response.status).toBe(422);
  });

  test("event audit rows reject direct update and delete mutation", async () => {
    const row = await helpers.prisma.eventAuditLog.findFirst();
    expect(row).toBeTruthy();
    await expect(helpers.prisma.eventAuditLog.update({ where: { eventAuditLogId: row.eventAuditLogId }, data: { correlationId: crypto.randomUUID() } })).rejects.toThrow(/event audit logs are immutable/);
    await expect(helpers.prisma.eventAuditLog.delete({ where: { eventAuditLogId: row.eventAuditLogId } })).rejects.toThrow(/event audit logs are immutable/);
  });

  test("validated administrator hard-delete uses the exact event audit deletion scope", async () => {
    const created = await request(app)
      .post("/api/v1/events")
      .set("Authorization", `Bearer ${adminToken}`)
      .send(newEvent());
    expect(created.status).toBe(201);

    const registrationId = crypto.randomUUID();
    const syncAction = await helpers.prisma.syncAction.create({
      data: {
        userId: administrator.id,
        eventId: created.body.eventId,
        clientActionId: crypto.randomUUID(),
        requestFingerprint: "a".repeat(64),
        operation: "UPDATE",
        entityType: "ScreeningResult",
        entityId: registrationId,
        payload: { schemaVersion: 1, stationType: "VISUAL_ACUITY" },
        responseSnapshot: { registrationId, overallFlag: "REFER", isFlagged: true },
        status: "APPLIED",
        transitions: { create: { sequence: 0, status: "APPLIED", retryCount: 0 } },
      },
    });
    const unrelatedSyncAction = await helpers.prisma.syncAction.create({
      data: {
        userId: administrator.id,
        eventId: crypto.randomUUID(),
        clientActionId: crypto.randomUUID(),
        requestFingerprint: "b".repeat(64),
        operation: "UPDATE",
        entityType: "ScreeningResult",
        entityId: crypto.randomUUID(),
        payload: { schemaVersion: 1, stationType: "VISUAL_ACUITY" },
        status: "APPLIED",
      },
    });

    const updated = await request(app)
      .patch(`/api/v1/events/${created.body.eventId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ version: created.body.version, capacity: 91 });
    expect(updated.status).toBe(200);
    expect(await helpers.prisma.eventAuditLog.count({ where: { eventId: created.body.eventId } })).toBe(2);

    const published = await request(app)
      .post(`/api/v1/events/${created.body.eventId}/publish`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ version: updated.body.version });
    const started = await request(app)
      .post(`/api/v1/events/${created.body.eventId}/start`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ version: published.body.version });
    const completed = await request(app)
      .post(`/api/v1/events/${created.body.eventId}/complete`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ version: started.body.version });
    expect(completed.status).toBe(200);

    const removed = await request(app)
      .delete(`/api/v1/events/${created.body.eventId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        version: completed.body.version,
        confirmationName: created.body.name,
        acknowledgePermanentDeletion: true,
      });
    expect(removed.status).toBe(200);
    expect(removed.body).toEqual({ eventId: created.body.eventId, deleted: true });
    expect(await helpers.prisma.event.findUnique({ where: { eventId: created.body.eventId } })).toBeNull();
    expect(await helpers.prisma.eventAuditLog.count({ where: { eventId: created.body.eventId } })).toBe(0);
    expect(await helpers.prisma.syncAction.findUnique({ where: { id: syncAction.id } })).toBeNull();
    expect(await helpers.prisma.syncActionTransition.count({ where: { syncActionId: syncAction.id } })).toBe(0);
    expect(await helpers.prisma.syncAction.findUnique({ where: { id: unrelatedSyncAction.id } })).toEqual(expect.objectContaining({ id: unrelatedSyncAction.id }));
    await helpers.prisma.syncAction.delete({ where: { id: unrelatedSyncAction.id } });
    expect(await helpers.prisma.auditLog.count({ where: {
      entityName: "Event",
      entityId: created.body.eventId,
      action: "EVENT_DELETED",
    } })).toBe(1);
  });
});
