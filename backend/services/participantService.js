const prisma = require("../prisma/prismaClient");
const AppError = require("../errors/AppError");
const { encrypt, lookupHash } = require("../utils/cryptoUtils");

const ACTIVE_ASSIGNMENT_STATUSES = ["ASSIGNED", "CONFIRMED"];
const PARTICIPANT_ACCESS_ROLES = ["REGISTRATION", "EVENT_MANAGER"];

const normalizeNric = (value) => value.replace(/[\s-]/g, "").toUpperCase();
const maskNric = (value) => value ? `${value.slice(0, 1)}XXXX${value.slice(-3)}` : null;
const maskPhone = (value) => {
  if (!value) return null;
  const visible = value.slice(-4);
  return `${"•".repeat(Math.min(Math.max(value.length - 4, 4), 8))}${visible}`;
};
const maskDate = (value) => value ? `****-**-${String(new Date(value).getUTCDate()).padStart(2, "0")}` : null;
const toIsoDate = (value) => value ? new Date(value).toISOString().slice(0, 10) : null;

const participantSelect = {
  id: true,
  nricMasked: true,
  firstName: true,
  lastName: true,
  dateOfBirth: true,
  gender: true,
  race: true,
  nationality: true,
  addressStreet: true,
  addressUnit: true,
  addressPostalCode: true,
  contactNumber: true,
  emergencyContact: true,
  emergencyContactName: true,
  consentGiven: true,
  version: true,
  createdAt: true,
  updatedAt: true,
};

const publicProfile = (participant) => ({
  participantId: participant.id,
  nricMasked: participant.nricMasked,
  firstName: participant.firstName,
  lastName: participant.lastName,
  displayName: `${participant.firstName} ${participant.lastName}`.trim(),
  dateOfBirth: toIsoDate(participant.dateOfBirth),
  gender: participant.gender,
  race: participant.race,
  nationality: participant.nationality,
  addressStreet: participant.addressStreet,
  addressUnit: participant.addressUnit,
  addressPostalCode: participant.addressPostalCode,
  contactNumber: participant.contactNumber,
  emergencyContact: participant.emergencyContact,
  emergencyContactName: participant.emergencyContactName,
  consentGiven: participant.consentGiven,
  version: participant.version,
  createdAt: participant.createdAt,
  updatedAt: participant.updatedAt,
  registrationCount: participant._count?.eventRegistrations,
});

const audit = (db, actor, action, participantId, eventId, details = {}) => db.auditLog.create({
  data: {
    userId: actor.id,
    action,
    resource: "Participant",
    details: {
      participantId,
      eventId,
      requestId: actor.requestId || null,
      ...details,
    },
    ipAddress: actor.ipAddress ? String(actor.ipAddress).slice(0, 45) : null,
  },
});

const requireEventAccess = async (eventId, actor) => {
  const event = await prisma.event.findUnique({
    where: { eventId },
    select: { eventId: true, createdByUserId: true },
  });
  if (!event) throw new AppError(404, "EVENT_NOT_FOUND", "Event was not found");
  if (actor.systemRole === "ADMIN") return event;
  if (actor.systemRole === "EVENT_MANAGER" && event.createdByUserId === actor.id) return event;

  const assignment = await prisma.staffAssignment.findFirst({
    where: {
      eventId,
      userId: actor.id,
      assignmentRole: { in: PARTICIPANT_ACCESS_ROLES },
      OR: [
        { assignmentStatus: { in: ACTIVE_ASSIGNMENT_STATUSES } },
        { status: { in: ACTIVE_ASSIGNMENT_STATUSES } },
      ],
    },
    select: { id: true },
  });
  if (!assignment) {
    throw new AppError(403, "PARTICIPANT_ACCESS_DENIED", "A registration assignment is required for this event");
  }
  return event;
};

const searchParticipants = async (input, actor) => {
  await requireEventAccess(input.eventId, actor);

  const filters = [];
  if (input.nric) filters.push({ nricLookupHash: lookupHash(normalizeNric(input.nric)) });
  if (input.query) {
    filters.push({
      OR: [
        { firstName: { contains: input.query, mode: "insensitive" } },
        { lastName: { contains: input.query, mode: "insensitive" } },
        { contactNumber: { contains: input.query } },
        { nricMasked: { contains: input.query.toUpperCase() } },
      ],
    });
  }
  if (input.dateOfBirth) filters.push({ dateOfBirth: new Date(`${input.dateOfBirth}T00:00:00.000Z`) });

  const where = { AND: filters };
  const skip = (input.page - 1) * input.limit;
  const [total, participants] = await Promise.all([
    prisma.participant.count({ where }),
    prisma.participant.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      skip,
      take: input.limit,
      select: {
        ...participantSelect,
        eventRegistrations: {
          where: { eventId: input.eventId },
          take: 1,
          select: {
            registrationId: true,
            registrationStatus: true,
            checkedIn: true,
            queueNumber: true,
          },
        },
        _count: { select: { eventRegistrations: true } },
      },
    }),
  ]);

  await audit(prisma, actor, "PARTICIPANT_SEARCHED", null, input.eventId, {
    criteria: {
      text: Boolean(input.query),
      exactIdentifier: Boolean(input.nric),
      dateOfBirth: Boolean(input.dateOfBirth),
    },
    resultCount: participants.length,
  });

  return {
    participants: participants.map((participant) => ({
      participantId: participant.id,
      displayName: `${participant.firstName} ${participant.lastName}`.trim(),
      nricMasked: participant.nricMasked,
      maskedContactNumber: maskPhone(participant.contactNumber),
      maskedDateOfBirth: maskDate(participant.dateOfBirth),
      version: participant.version,
      registrationCount: participant._count.eventRegistrations,
      selectedEventRegistration: participant.eventRegistrations[0] || null,
    })),
    pagination: {
      page: input.page,
      limit: input.limit,
      total,
      totalPages: Math.ceil(total / input.limit),
    },
  };
};

const getParticipantProfile = async (participantId, eventId, actor) => {
  await requireEventAccess(eventId, actor);
  const participant = await prisma.participant.findUnique({
    where: { id: participantId },
    select: {
      ...participantSelect,
      _count: { select: { eventRegistrations: true } },
    },
  });
  if (!participant) throw new AppError(404, "PARTICIPANT_NOT_FOUND", "Participant was not found");

  await audit(prisma, actor, "PARTICIPANT_PROFILE_VIEWED", participantId, eventId);
  return publicProfile(participant);
};

const updateParticipant = async (participantId, input, actor) => {
  await requireEventAccess(input.eventId, actor);
  const { eventId, version, nric, ...fields } = input;
  const data = {
    ...fields,
    ...(fields.dateOfBirth ? { dateOfBirth: new Date(`${fields.dateOfBirth}T00:00:00.000Z`) } : {}),
    ...(nric ? {
      nric: encrypt(normalizeNric(nric)),
      nricMasked: maskNric(normalizeNric(nric)),
      nricLookupHash: lookupHash(normalizeNric(nric)),
    } : {}),
    version: { increment: 1 },
  };

  try {
    return await prisma.$transaction(async (tx) => {
      const existing = await tx.participant.findUnique({
        where: { id: participantId },
        select: { id: true, version: true },
      });
      if (!existing) throw new AppError(404, "PARTICIPANT_NOT_FOUND", "Participant was not found");
      if (existing.version !== version) {
        throw new AppError(409, "PARTICIPANT_VERSION_CONFLICT", "Participant details changed; reload before saving");
      }

      const changed = await tx.participant.updateMany({
        where: { id: participantId, version },
        data,
      });
      if (changed.count !== 1) {
        throw new AppError(409, "PARTICIPANT_VERSION_CONFLICT", "Participant details changed; reload before saving");
      }

      const updated = await tx.participant.findUniqueOrThrow({
        where: { id: participantId },
        select: {
          ...participantSelect,
          _count: { select: { eventRegistrations: true } },
        },
      });
      await audit(tx, actor, "PARTICIPANT_UPDATED", participantId, eventId, {
        changedFields: [...Object.keys(fields), ...(nric ? ["nric"] : [])],
        previousVersion: version,
        newVersion: updated.version,
      });
      return publicProfile(updated);
    });
  } catch (error) {
    if (error?.code === "P2002") {
      throw new AppError(409, "DUPLICATE_PARTICIPANT", "Another participant already uses these identity details");
    }
    throw error;
  }
};

const getRegistrationHistory = async (participantId, input, actor) => {
  await requireEventAccess(input.eventId, actor);
  const participant = await prisma.participant.findUnique({
    where: { id: participantId },
    select: { id: true },
  });
  if (!participant) throw new AppError(404, "PARTICIPANT_NOT_FOUND", "Participant was not found");

  const where = { participantId };
  const skip = (input.page - 1) * input.limit;
  const [total, registrations] = await Promise.all([
    prisma.eventRegistration.count({ where }),
    prisma.eventRegistration.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { registrationId: "asc" }],
      skip,
      take: input.limit,
      select: {
        registrationId: true,
        registrationStatus: true,
        queueNumber: true,
        checkedIn: true,
        createdAt: true,
        updatedAt: true,
        event: {
          select: {
            eventId: true,
            name: true,
            venue: true,
            startsAt: true,
            endsAt: true,
            status: true,
          },
        },
        registeredByUser: {
          select: { id: true, fullName: true },
        },
      },
    }),
  ]);

  await audit(prisma, actor, "PARTICIPANT_REGISTRATION_HISTORY_VIEWED", participantId, input.eventId, {
    resultCount: registrations.length,
  });
  return {
    participantId,
    registrations: registrations.map((registration) => ({
      registrationId: registration.registrationId,
      registrationStatus: registration.registrationStatus,
      queueNumber: registration.queueNumber,
      checkedIn: registration.checkedIn,
      createdAt: registration.createdAt,
      updatedAt: registration.updatedAt,
      event: registration.event,
      registeredBy: {
        userId: registration.registeredByUser.id,
        fullName: registration.registeredByUser.fullName,
      },
    })),
    pagination: {
      page: input.page,
      limit: input.limit,
      total,
      totalPages: Math.ceil(total / input.limit),
    },
  };
};

module.exports = {
  searchParticipants,
  getParticipantProfile,
  updateParticipant,
  getRegistrationHistory,
};
