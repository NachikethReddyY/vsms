const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

async function createParticipant(data) {

    const participant = await prisma.participant.create({
        data: {
            firstName: data.firstName,
            lastName: data.lastName,
            dateOfBirth: new Date(data.dateOfBirth),
            gender: data.gender,
            contactNumber: data.contactNumber,
            emergencyContact: data.emergencyContact,
            consentGiven: data.consentGiven
        }
    });

    return participant;
}

module.exports = {
    createParticipant
};