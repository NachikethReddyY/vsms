const { PrismaClient } = require("@prisma/client");
const { encrypt } = require("../utils/cryptoUtils");
const { logAuditEvent } = require("../utils/auditLogger"); // Audit Helper

const prisma = new PrismaClient();

function maskNric(nric) {
  if (!nric) return "";
  return nric.charAt(0) + "XXXX" + nric.slice(-3);
}

/**
 * Create Participant Record with Encrypted NRIC & Initial Event Registration
 * @param {Object} data - Participant input data
 * @param {string} eventId - UUID of the event
 * @param {string} [userId] - UUID of the staff/user performing registration
 * @param {string} [initialStationId] - Optional initial station UUID for queue entry
 * @param {Object} [req] - Express Request object for logging IP/UA
 */
async function createParticipant(data, eventId, userId, initialStationId, req = null) {
  // STEP A: Guard Against Undefined Inputs
  if (!eventId) {
    throw new Error(
      "createParticipant error: 'eventId' is required but was received as undefined."
    );
  }
  if (!data || !data.nric) {
    throw new Error(
      "createParticipant error: Valid participant 'data' with 'nric' is required."
    );
  }

  const encryptedNric = encrypt(data.nric);
  const maskedNric = maskNric(data.nric);

  // Interactive ACID Transaction
  const result = await prisma.$transaction(async (tx) => {
    // 1. Create the Participant record using normalized address fields
    const participant = await tx.participant.create({
      data: {
        nric: encryptedNric,
        nricMasked: maskedNric,
        firstName: data.firstName,
        lastName: data.lastName,
        dateOfBirth: new Date(data.dateOfBirth),
        gender: data.gender,
        contactNumber: data.contactNumber,
        emergencyContact: data.emergencyContact,
        consentGiven: Boolean(data.consentGiven),
        // Normalized address split
        addressStreet: data.addressStreet || null,
        addressUnit: data.addressUnit || null,
        addressPostalCode: data.addressPostalCode || null,
        // Optional fields
        race: data.race || null,
        nationality: data.nationality || "Singaporean",
        emergencyContactName: data.emergencyContactName || null,
      },
    });

    // 2. Resolve a valid User ID
    let validUserId = userId;
    let existingUser = null;

    if (validUserId) {
      existingUser = await tx.user.findUnique({
        where: { id: validUserId },
      });
    }

    if (!existingUser) {
      const fallbackUser = await tx.user.findFirst();
      if (!fallbackUser) {
        throw new Error(
          "Foreign key constraint error: No user records exist in the database."
        );
      }
      validUserId = fallbackUser.id;
    }

    // 3. Determine current Queue Number for the event
    const registrationCount = await tx.eventRegistration.count({
      where: { eventId: eventId },
    });
    const nextQueueNumber = registrationCount + 1;

    // 4. Create Event Registration entry
    const registration = await tx.eventRegistration.create({
      data: {
        participantId: participant.id,
        eventId: eventId,
        queueNumber: nextQueueNumber,
        registrationStatus: "REGISTERED",
        registeredBy: validUserId,
      },
    });

    // 5. Add to Queue Entry if an initial station ID is provided
    let queueEntry = null;
    if (initialStationId) {
      queueEntry = await tx.queueEntry.create({
        data: {
          registrationId: registration.id,
          stationId: initialStationId,
          queueNumber: nextQueueNumber,
          status: "WAITING",
          enteredAt: new Date(), // Corrected field name from joinedAt -> enteredAt
        },
      });
    }

    return {
      participant: {
        ...participant,
        nric: data.nric, // Return plaintext NRIC to caller for immediate UI response
      },
      registration,
      queueEntry,
      validUserId,
    };
  });

  // Write Audit Log (Post-transaction execution to keep transaction lean)
  await logAuditEvent({
    userId: result.validUserId,
    action: "PARTICIPANT_REGISTERED",
    entityName: "Participant",
    entityId: result.participant.id,
    newValue: {
      participantId: result.participant.id,
      eventId: eventId,
      maskedNric: maskedNric,
    },
    req,
  });

  return {
    participant: result.participant,
    registration: result.registration,
    queueEntry: result.queueEntry,
  };
}

module.exports = {
  createParticipant,
  maskNric,
};