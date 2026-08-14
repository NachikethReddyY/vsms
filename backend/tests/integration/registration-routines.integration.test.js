const { after, test } = require("node:test");
const crypto = require("node:crypto");
const { expect } = require("expect");
const helpers = require("../helpers");
const routines = require("../../services/participant/registrationRoutineRepository");

const createParticipant = async ({ eventId, userId, label }) => {
  const participant = await helpers.prisma.participant.create({
    data: {
      participantReference: `PROC-${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`,
      firstName: label,
      lastName: "Routine",
      dateOfBirth: new Date("1980-01-01T00:00:00.000Z"),
      gender: "U",
      contactNumber: "+6590000000",
      createdById: userId,
      updatedById: userId,
      onboardingEventId: eventId,
    },
  });
  await helpers.prisma.participantEmergencyContact.create({
    data: {
      participantId: participant.id,
      contactName: `${label} Contact`,
      relationship: "Family",
      phoneNumber: "+6591111111",
      isPrimary: true,
      createdById: userId,
      updatedById: userId,
    },
  });
  return participant;
};

after(async () => helpers.prisma.$disconnect());

test("registration routines serialize capacity and close the full QR lifecycle", async () => {
  const actor = await helpers.ensureTestUser("REGISTRATION_OFFICER", `procedure-${crypto.randomUUID()}`);
  const startsAt = new Date("2045-08-14T01:00:00.000Z");
  const event = await helpers.prisma.event.create({
    data: {
      name: `Stored routine ${crypto.randomUUID()}`,
      venue: "Procedure Lab",
      timezone: "Asia/Singapore",
      startsAt,
      endsAt: new Date(startsAt.getTime() + 8 * 60 * 60 * 1000),
      capacity: 1,
      status: "PUBLISHED",
      createdByUserId: actor.id,
    },
  });
  const [firstParticipant, secondParticipant] = await Promise.all([
    createParticipant({ eventId: event.eventId, userId: actor.id, label: "First" }),
    createParticipant({ eventId: event.eventId, userId: actor.id, label: "Second" }),
  ]);
  const requests = [
    { participantId: firstParticipant.id, idempotencyKey: `procedure-${crypto.randomUUID()}` },
    { participantId: secondParticipant.id, idempotencyKey: `procedure-${crypto.randomUUID()}` },
  ];

  const operations = await Promise.all([
    routines.registerParticipant(helpers.prisma, {
      ...requests[0],
      eventId: event.eventId,
      registeredBy: actor.id,
    }),
    routines.registerParticipant(helpers.prisma, {
      ...requests[1],
      eventId: event.eventId,
      registeredBy: actor.id,
    }),
  ]);

  expect(operations.map(({ registration_status: status }) => status).sort()).toEqual([
    "SIGNED_UP",
    "WAITLISTED",
  ]);
  const signedUpOperation = operations.find(({ registration_status: status }) => status === "SIGNED_UP");
  const signedUpRequest = requests[operations.indexOf(signedUpOperation)];
  const replay = await routines.registerParticipant(helpers.prisma, {
    ...signedUpRequest,
    eventId: event.eventId,
    registeredBy: actor.id,
  });
  expect(replay.idempotent_replay).toBe(true);

  const registrations = await helpers.prisma.eventRegistration.findMany({
    where: { eventId: event.eventId },
  });
  const signedUp = registrations.find(({ registrationStatus }) => registrationStatus === "SIGNED_UP");
  const waitlisted = registrations.find(({ registrationStatus }) => registrationStatus === "WAITLISTED");
  expect(signedUp).toBeTruthy();
  expect(waitlisted).toBeTruthy();

  const activePass = await helpers.prisma.qRCodePass.create({
    data: {
      registrationId: signedUp.registrationId,
      expiresAt: new Date(startsAt.getTime() + 24 * 60 * 60 * 1000),
    },
  });
  const cancellation = await routines.cancelRegistration(helpers.prisma, {
    registrationId: signedUp.registrationId,
    changedBy: actor.id,
    reason: "  Participant withdrew  ",
  });

  expect(cancellation.cancelled_registration_id).toBe(signedUp.registrationId);
  expect(cancellation.promoted_registration_id).toBe(waitlisted.registrationId);
  expect(cancellation.revoked_qr_count).toBe(1n);
  const revokedPass = await helpers.prisma.qRCodePass.findUniqueOrThrow({
    where: { id: activePass.id },
  });
  expect(revokedPass).toEqual(expect.objectContaining({
    isActive: false,
    revokedBy: actor.id,
    revokedReason: "Registration cancelled",
  }));
  expect(revokedPass.revokedAt?.getTime()).toBe(new Date(cancellation.changed_at).getTime());

  await helpers.prisma.event.update({
    where: { eventId: event.eventId },
    data: { status: "IN_PROGRESS" },
  });
  const checkedIn = await routines.checkInRegistration(helpers.prisma, {
    registrationId: waitlisted.registrationId,
    eventId: event.eventId,
    changedBy: actor.id,
  });
  expect(checkedIn).toEqual(expect.objectContaining({
    registration_status: "CHECKED_IN",
    checked_in: true,
  }));

  const summary = await routines.getEventSummary(helpers.prisma, event.eventId);
  expect(summary).toEqual(expect.objectContaining({
    capacity: 1,
    signed_up_count: 0n,
    waitlisted_count: 0n,
    checked_in_count: 1n,
    cancelled_count: 1n,
    filled_count: 1n,
    remaining_capacity: 0,
  }));
  const history = await helpers.prisma.registrationStatusHistory.findMany({
    where: { registration: { eventId: event.eventId } },
    orderBy: { occurredAt: "asc" },
  });
  expect(history).toHaveLength(5);
  expect(history.map(({ reason }) => reason)).toEqual(expect.arrayContaining([
    "Participant withdrew",
    "Promoted after a registration was cancelled",
    "Manual check-in",
  ]));
});

test("registration routine metadata proves invoker rights, fixed search paths, and documentation", async () => {
  const metadata = await helpers.prisma.$queryRaw`
    SELECT
      procedure.proname AS name,
      procedure.prosecdef AS "securityDefiner",
      procedure.provolatile AS volatility,
      procedure.proconfig AS configuration,
      procedure.proacl::text AS acl,
      pg_catalog.obj_description(procedure.oid, 'pg_proc') AS description
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'public'
      AND procedure.oid IN (
        pg_catalog.to_regprocedure('public.register_participant_for_event(uuid,uuid,uuid,character varying)'),
        pg_catalog.to_regprocedure('public.cancel_event_registration(uuid,uuid,character varying)'),
        pg_catalog.to_regprocedure('public.check_in_event_registration(uuid,uuid,uuid)'),
        pg_catalog.to_regprocedure('public.get_event_registration_summary(uuid)')
      )
    ORDER BY procedure.proname
  `;

  expect(metadata).toHaveLength(4);
  for (const routine of metadata) {
    expect(routine.securityDefiner).toBe(false);
    expect(routine.configuration).toContain("search_path=pg_catalog, public");
    expect(routine.acl).not.toMatch(/(?:^|,)=[^,]*X/);
    expect(routine.description.length).toBeGreaterThan(40);
  }
  expect(metadata.find(({ name }) => name === "get_event_registration_summary")?.volatility).toBe("s");
});
