const { after, before, test } = require("node:test");
const { expect } = require("expect");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const request = require("supertest");
const helpers = require("../helpers");
const app = require("../../app");

const prisma = helpers.prisma;
let administrator;

const createManagerEvent = async (label) => {
  const managerA = await helpers.ensureTestUser("EVENT_MANAGER", `${label}-a-${crypto.randomUUID().slice(0, 8)}`);
  const managerB = await helpers.ensureTestUser("EVENT_MANAGER", `${label}-b-${crypto.randomUUID().slice(0, 8)}`);
  const event = await prisma.event.create({
    data: {
      name: `${label} ${crypto.randomUUID()}`,
      venue: "Concurrency Hall",
      startsAt: new Date("2160-01-01T00:00:00.000Z"),
      endsAt: new Date("2160-01-01T06:00:00.000Z"),
      capacity: 10,
      createdByUserId: managerA.id,
    },
  });
  const createMembership = (member) => prisma.eventMembership.create({
    data: {
      eventId: event.eventId,
      userId: member.id,
      addedById: managerA.id,
      roles: { create: { role: "EVENT_MANAGER", assignedById: managerA.id } },
    },
  });
  const [membershipA, membershipB] = await Promise.all([createMembership(managerA), createMembership(managerB)]);
  return { event, managerA, managerB, membershipA, membershipB };
};

before(async () => {
  administrator = await helpers.ensureTestUser("ADMINISTRATOR", "membership-migration-administrator");
});

after(async () => prisma.$disconnect());

test("concurrent managers cannot remove each other's memberships and leave an event unmanaged", async () => {
  const { event, managerA, managerB, membershipA, membershipB } = await createManagerEvent("Membership race");
  const results = await Promise.all([
    request(app)
      .delete(`/api/events/${event.eventId}/memberships/${membershipB.id}`)
      .set("Authorization", `Bearer ${helpers.accessTokenFor(managerA)}`)
      .send({ reason: "Concurrent manager removal test" }),
    request(app)
      .delete(`/api/events/${event.eventId}/memberships/${membershipA.id}`)
      .set("Authorization", `Bearer ${helpers.accessTokenFor(managerB)}`)
      .send({ reason: "Concurrent manager removal test" }),
  ]);

  expect(results.map(({ status }) => status).sort()).toEqual([200, 403]);
  expect(await prisma.eventMembershipRole.count({
    where: { role: "EVENT_MANAGER", membership: { eventId: event.eventId, status: "ACTIVE" } },
  })).toBe(1);
});

test("concurrent managers cannot remove each other's manager roles and leave an event unmanaged", async () => {
  const { event, managerA, managerB, membershipA, membershipB } = await createManagerEvent("Manager role race");
  const results = await Promise.all([
    request(app)
      .delete(`/api/events/${event.eventId}/memberships/${membershipB.id}/roles/EVENT_MANAGER`)
      .set("Authorization", `Bearer ${helpers.accessTokenFor(managerA)}`),
    request(app)
      .delete(`/api/events/${event.eventId}/memberships/${membershipA.id}/roles/EVENT_MANAGER`)
      .set("Authorization", `Bearer ${helpers.accessTokenFor(managerB)}`),
  ]);

  expect(results.map(({ status }) => status).sort()).toEqual([200, 403]);
  expect(await prisma.eventMembershipRole.count({
    where: { role: "EVENT_MANAGER", membership: { eventId: event.eventId, status: "ACTIVE" } },
  })).toBe(1);
});

test("forward membership repair restores final state without changing historical migration checksums", async () => {
  const legacy = await helpers.ensureTestUser("SUPPORT", `legacy-duty-${crypto.randomUUID().slice(0, 8)}`);
  const explicitlyRemoved = await helpers.ensureTestUser("SUPPORT", `explicit-removal-${crypto.randomUUID().slice(0, 8)}`);
  const event = await prisma.event.create({
    data: {
      name: `Migration fixture ${crypto.randomUUID()}`,
      venue: "Migration Hall",
      startsAt: new Date("2162-01-01T00:00:00.000Z"),
      endsAt: new Date("2162-01-01T06:00:00.000Z"),
      capacity: 10,
      createdByUserId: administrator.id,
    },
  });
  const removedAt = new Date();
  const createRemoved = (member, removalReason) => prisma.eventMembership.create({
    data: {
      eventId: event.eventId,
      userId: member.id,
      status: "REMOVED",
      addedById: administrator.id,
      removedById: administrator.id,
      removedAt,
      removalReason,
      roles: { create: { role: "SUPPORT", assignedById: administrator.id } },
    },
  });
  const [legacyMembership, explicitMembership] = await Promise.all([
    createRemoved(legacy, "Historical duties completed or cancelled before membership migration"),
    createRemoved(explicitlyRemoved, "Explicitly removed by an event manager"),
  ]);
  const migration = fs.readFileSync(path.join(
    __dirname,
    "../../prisma/migrations/20260806140000_reactivate_historical_memberships_and_report_jobs/migration.sql",
  ), "utf8");
  const repairStatement = migration.match(/UPDATE "event_memberships"[\s\S]*?;/)?.[0];
  expect(repairStatement).toBeTruthy();
  await prisma.$executeRawUnsafe(repairStatement);

  expect(await prisma.eventMembership.findUnique({ where: { id: legacyMembership.id } })).toEqual(expect.objectContaining({
    status: "ACTIVE",
    removedById: null,
    removedAt: null,
    removalReason: null,
  }));
  expect(await prisma.eventMembership.findUnique({ where: { id: explicitMembership.id } })).toEqual(expect.objectContaining({
    status: "REMOVED",
    removalReason: "Explicitly removed by an event manager",
  }));

  const historicalChecksums = {
    "20260806100000_account_event_foundation": "6a9cef1da49d133f75f46f50c8c06a85bbd362bb7f8ede6f99d78da2c069eebf",
    "20260806110000_harden_account_lifecycle": "81aeffe1dc98fce1d6f15b78f4d73bcb1bf1316da9af4ce0584d16de01357483",
  };
  for (const [migrationName, expectedChecksum] of Object.entries(historicalChecksums)) {
    const historicalMigration = fs.readFileSync(path.join(__dirname, `../../prisma/migrations/${migrationName}/migration.sql`));
    expect(crypto.createHash("sha256").update(historicalMigration).digest("hex")).toBe(expectedChecksum);
  }
});
