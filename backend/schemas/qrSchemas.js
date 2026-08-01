const { z } = require("zod");

const participantParams = z.object({ participantId: z.string().uuid() }).strict();
const tokenBody = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/) }).strict();

module.exports = { participantParams, tokenBody };
