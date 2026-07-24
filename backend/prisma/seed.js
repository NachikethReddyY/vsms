require("dotenv").config();
const bcrypt = require("bcrypt");
const prisma = require("./prismaClient");

const DEMO_PASSWORD = process.env.VSMS_DEMO_PASSWORD || "Demo-Only-Change-Me-2026!";
if (process.env.NODE_ENV === "production" && !process.env.VSMS_DEMO_PASSWORD) {
  throw new Error("VSMS_DEMO_PASSWORD is required for production seed execution");
}

const USERS = [
  { userId: "10000000-0000-4000-8000-000000000001", username: "admin", email: "admin@vsms.local", systemRole: "ADMIN" },
  { userId: "10000000-0000-4000-8000-000000000002", username: "manager", email: "manager@vsms.local", systemRole: "EVENT_MANAGER" },
  { userId: "10000000-0000-4000-8000-000000000003", username: "staff", email: "staff@vsms.local", systemRole: "STAFF" },
];

const EVENTS = [
  { eventId: "20000000-0000-4000-8000-000000000001", name: "Northside Community Screening", venue: "Northside Community Hall", startsAt: "2026-08-12T00:00:00.000Z", endsAt: "2026-08-12T08:00:00.000Z", capacity: 180, status: "PUBLISHED" },
  { eventId: "20000000-0000-4000-8000-000000000002", name: "Riverside Vision Day", venue: "Riverside Civic Centre", startsAt: "2026-09-05T01:00:00.000Z", endsAt: "2026-09-05T07:00:00.000Z", capacity: 120, status: "DRAFT" },
  { eventId: "20000000-0000-4000-8000-000000000003", name: "Central Library Screening", venue: "Central Library Atrium", startsAt: "2026-07-22T01:00:00.000Z", endsAt: "2026-07-22T09:00:00.000Z", capacity: 200, status: "IN_PROGRESS" },
  { eventId: "20000000-0000-4000-8000-000000000004", name: "West End Community Check", venue: "West End Activity Centre", startsAt: "2026-06-18T00:00:00.000Z", endsAt: "2026-06-18T07:00:00.000Z", capacity: 150, status: "COMPLETED" },
  { eventId: "20000000-0000-4000-8000-000000000005", name: "Harbour Family Screening", venue: "Harbour Community Room", startsAt: "2026-08-20T00:00:00.000Z", endsAt: "2026-08-20T06:00:00.000Z", capacity: 100, status: "CANCELLED" },
];

const REGISTRATION_COUNTS = [
  { SIGNED_UP: 12, CHECKED_IN: 0, COMPLETED: 0, CANCELLED: 0 },
  { SIGNED_UP: 4, CHECKED_IN: 0, COMPLETED: 0, CANCELLED: 0 },
  { SIGNED_UP: 7, CHECKED_IN: 5, COMPLETED: 9, CANCELLED: 1 },
  { SIGNED_UP: 0, CHECKED_IN: 0, COMPLETED: 30, CANCELLED: 0 },
  { SIGNED_UP: 0, CHECKED_IN: 0, COMPLETED: 0, CANCELLED: 5 },
];

const main = async () => {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);
  for (const user of USERS) {
    await prisma.user.upsert({
      where: { email: user.email },
      update: { username: user.username, passwordHash, systemRole: user.systemRole, status: "ACTIVE" },
      create: { ...user, passwordHash },
    });
  }

  for (const [index, event] of EVENTS.entries()) {
    const cancelled = event.status === "CANCELLED";
    const data = {
      ...event,
      description: "Seeded demonstration event for the issue #7 lifecycle flow.",
      timezone: "Asia/Singapore",
      startsAt: new Date(event.startsAt),
      endsAt: new Date(event.endsAt),
      createdByUserId: USERS[1].userId,
      cancelledByUserId: cancelled ? USERS[0].userId : null,
      cancelledAt: cancelled ? new Date("2026-07-20T04:00:00.000Z") : null,
      cancellationReason: cancelled ? "Venue became unavailable and requires rescheduling." : null,
    };
    const stored = await prisma.event.upsert({
      where: { eventId: event.eventId },
      update: data,
      create: {
        ...data,
        shifts: {
          create: [
            {
              name: "Morning operations",
              startsAt: new Date(event.startsAt),
              endsAt: new Date(new Date(event.startsAt).getTime() + 4 * 3600000),
              requiredStaff: 8,
              status: event.status === "COMPLETED" ? "COMPLETED" : event.status === "IN_PROGRESS" ? "ACTIVE" : event.status === "CANCELLED" ? "CANCELLED" : "PLANNED",
            },
          ],
        },
      },
    });
    const auditId = `30000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
    if (!await prisma.eventAuditLog.findUnique({ where: { eventAuditLogId: auditId } })) {
      await prisma.eventAuditLog.create({
        data: {
          eventAuditLogId: auditId,
          eventId: stored.eventId,
          actorUserId: USERS[1].userId,
          action: "CREATED",
          correlationId: `40000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
          afterSnapshot: { name: stored.name, status: stored.status, capacity: stored.capacity, version: stored.version },
        },
      });
    }

    const statuses = Object.entries(REGISTRATION_COUNTS[index]).flatMap(([status, count]) => Array.from({ length: count }, () => status));
    for (const [registrationIndex, status] of statuses.entries()) {
      const registrationId = `50000000-0000-4000-8000-${String(index * 1000 + registrationIndex + 1).padStart(12, "0")}`;
      await prisma.eventRegistration.upsert({
        where: { registrationId },
        update: { eventId: stored.eventId, status },
        create: { registrationId, eventId: stored.eventId, status },
      });
    }
  }

  console.log(JSON.stringify({ users: USERS.map(({ username, email, systemRole }) => ({ username, email, systemRole })), events: EVENTS.length, demoPasswordSource: process.env.VSMS_DEMO_PASSWORD ? "environment" : "development-only default" }, null, 2));
};

main().finally(() => prisma.$disconnect());
