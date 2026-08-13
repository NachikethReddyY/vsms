const {
  blindIndex,
  decrypt,
  encrypt,
  encryptionContext,
} = require("./cryptoUtils");
const { maskNric } = require("../validation/validation");

const participantNricContext = (participantId) => encryptionContext("Participant", participantId, "nric");
const nricLookupHash = (nric) => blindIndex(nric, "participant-nric");

const protectParticipantNric = (participantId, nric) => ({
  nric: null,
  nricCiphertext: encrypt(nric, participantNricContext(participantId)),
  nricLookupHash: nricLookupHash(nric),
  nricEncryptionVersion: 2,
  nricMasked: maskNric(nric),
});

const revealParticipantNric = (participant) => {
  if (participant?.nricCiphertext) {
    return decrypt(participant.nricCiphertext, participantNricContext(participant.id));
  }
  return participant?.nric || null;
};

module.exports = {
  nricLookupHash,
  protectParticipantNric,
  revealParticipantNric,
};
