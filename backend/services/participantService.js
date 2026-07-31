const prisma = require("../prisma/prismaClient");

/**
 * Creates a participant for a specific event on the backend
 * @param {string} eventId - Must be a valid UUID string
 * @param {Object} participantData - The participant's form fields (fullName, email, phone)
 */
const createParticipant = async (eventId, participantData) => {
  if (!eventId) {
    throw new Error("A valid eventId (UUID) is required to create a participant.");
  }

  // Ensure the target event exists in the database
  const event = await prisma.event.findUnique({
    where: { id: eventId },
  });

  if (!event) {
    throw new Error("Event not found");
  }

  // Insert the participant record into the database
  const participant = await prisma.participant.create({
    data: {
      eventId: eventId,
      fullName: participantData.fullName,
      email: participantData.email || null,
      phone: participantData.phone || null,
    },
  });

  return participant;
};

module.exports = {
  createParticipant,
};