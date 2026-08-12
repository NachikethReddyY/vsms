const prisma = require("../../prisma/prismaClient");

const recordVisualAcuity = async ({
    registrationId,
    leftEyeVa,
    rightEyeVa,
    pinholeLeft,
    pinholeRight,
    recordedBy,
    client = prisma,
}) => {
    await client.$executeRaw`
        CALL sp_record_visual_acuity(
            ${registrationId},
            ${leftEyeVa},
            ${rightEyeVa},
            ${pinholeLeft},
            ${pinholeRight},
            ${recordedBy}
        )
    `;
};

module.exports = {
    recordVisualAcuity,
};