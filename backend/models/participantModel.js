const { PrismaClient } = require("@prisma/client");
const { encrypt } = require("../utils/cryptoUtils");

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
 */
async function createParticipant(data, eventId, userId, initialStationId) {
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
  return await prisma.$transaction(async (tx) => {
    // 1. Create the Participant record
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
        // Optional fields if provided:
        race: data.race || null,
        nationality: data.nationality || "Singaporean",
        address: data.address || null,
        emergencyContactName: data.emergencyContactName || null,
      },
    });

    // 2. Resolve a valid User ID (handles local development without auth)
    let validUserId = userId;
    let existingUser = null;

    if (validUserId) {
      existingUser = await tx.user.findUnique({
        where: { id: validUserId },
      });
    }

    // If userId was missing or invalid, grab the first available user in DB
    if (!existingUser) {
      const fallbackUser = await tx.user.findFirst();
      if (!fallbackUser) {
        throw new Error(
          "Foreign key constraint error: No user records exist in the database. Please seed or create at least one user record."
        );
      }
      validUserId = fallbackUser.id;
    }

    // 3. Determine current Queue Number for the event
    const registrationCount = await tx.eventRegistration.count({
      where: { eventId: eventId },
    });
    const nextQueueNumber = registrationCount + 1;

    // 4. Create Event Registration entry (using guaranteed valid user ID)
    const registration = await tx.eventRegistration.create({
      data: {
        participantId: participant.id,
        eventId: eventId,
        queueNumber: nextQueueNumber,
        registrationStatus: "REGISTERED",
        registeredBy: validUserId, // Passes foreign key validation!
      },
    });

    // 5. Add to Queue Entry if an initial station ID is provided
    let queueEntry = null;
    if (initialStationId) {
      queueEntry = await tx.queueEntry.create({
        data: {
          registrationId: registration.id,
          stationId: initialStationId,
          status: "WAITING",
          joinedAt: new Date(),
        },
      });
    }

    // Return response object with plaintext NRIC for immediate UI feedback
    return {
      participant: {
        ...participant,
        nric: data.nric,
      },
      registration,
      queueEntry,
    };
  });
}

module.exports = {
  createParticipant,
  maskNric,
};