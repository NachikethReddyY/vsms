const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveScannedRegistration } = require('../services/reviewService');

test('review QR scan is scoped to the active reviewer event', async () => {
  const db = {
    event: { findUnique: async () => ({ eventId: 'event-1', status: 'IN_PROGRESS' }) },
    staffAssignment: { findFirst: async () => ({ id: 'assignment-1' }) },
    eventRegistration: {
      findFirst: async ({ where }) => where.eventId === 'event-1' && where.passToken === 'valid-token'
        ? { registrationId: 'registration-1' }
        : null,
    },
  };
  const user = { userId: 'reviewer-1', roles: ['REVIEWER'] };

  assert.deepEqual(await resolveScannedRegistration('event-1', 'valid-token', user, db), { registrationId: 'registration-1' });
  await assert.rejects(
    resolveScannedRegistration('event-1', 'wrong-token', user, db),
    (error) => error.code === 'QR_REGISTRATION_NOT_FOUND',
  );
});
