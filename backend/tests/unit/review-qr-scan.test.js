const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveScannedRegistration } = require('../../services/screening/reviewService');
const { hashToken } = require('../../utils/qrToken');

const urlToken = 'b'.repeat(64);
const qrUrl = `https://app.example.com/participant-status/${urlToken}`;

test('review QR scan is scoped to the active reviewer event', async () => {
  const db = {
    event: { findUnique: async () => ({ eventId: 'event-1', status: 'IN_PROGRESS' }) },
    eventMembership: { findFirst: async () => ({ id: 'membership-1', status: 'ACTIVE', roles: [{ role: 'REVIEWER' }], user: { professionalCategory: 'DOCTOR' } }) },
    staffAssignment: { findFirst: async () => ({ id: 'assignment-1' }) },
    qRCodePass: {
      findFirst: async ({ where }) =>
        where.tokenHash === hashToken(urlToken) && where.registration?.eventId === 'event-1'
          ? { registrationId: 'registration-1' }
          : null,
    },
    eventRegistration: {
      findFirst: async ({ where }) => where.eventId === 'event-1' && where.passToken === 'valid-token'
        ? { registrationId: 'registration-1' }
        : null,
    },
  };
  const user = { userId: 'reviewer-1', roles: ['REVIEWER'], professionalCategory: 'DOCTOR', status: 'ACTIVE', approvalState: 'APPROVED', accessState: 'ENABLED' };

  assert.deepEqual(await resolveScannedRegistration('event-1', 'valid-token', user, db), { registrationId: 'registration-1' });
  await assert.rejects(
    resolveScannedRegistration('event-1', 'wrong-token', user, db),
    (error) => error.code === 'QR_REGISTRATION_NOT_FOUND',
  );
});

test('review QR scan resolves a scanned participant-status URL', async () => {
  const db = {
    event: { findUnique: async () => ({ eventId: 'event-1', status: 'IN_PROGRESS' }) },
    eventMembership: { findFirst: async () => ({ id: 'membership-1', status: 'ACTIVE', roles: [{ role: 'REVIEWER' }], user: { professionalCategory: 'DOCTOR' } }) },
    staffAssignment: { findFirst: async () => ({ id: 'assignment-1' }) },
    qRCodePass: {
      findFirst: async ({ where }) =>
        where.tokenHash === hashToken(urlToken) && where.registration?.eventId === 'event-1'
          ? { registrationId: 'registration-1' }
          : null,
    },
    eventRegistration: { findFirst: async () => null },
  };
  const user = { userId: 'reviewer-1', roles: ['REVIEWER'], professionalCategory: 'DOCTOR', status: 'ACTIVE', approvalState: 'APPROVED', accessState: 'ENABLED' };

  assert.deepEqual(await resolveScannedRegistration('event-1', qrUrl, user, db), { registrationId: 'registration-1' });
  assert.deepEqual(await resolveScannedRegistration('event-1', urlToken, user, db), { registrationId: 'registration-1' });
  assert.deepEqual(await resolveScannedRegistration('event-1', `${urlToken.toUpperCase()}`, user, db), { registrationId: 'registration-1' });
});
