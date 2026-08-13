const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const test = require('node:test');

test('create mode does not read a version from a nonexistent event', () => {
  const source = readFileSync('react-user-dashboard/src/features/events/EventFormPage.tsx', 'utf8');
  const createBranch = source.slice(source.indexOf("const saved = mode === 'create'"), source.indexOf('navigate(`/events/${saved.eventId}`'));

  assert.match(createBranch, /\? await eventApi\.create\(payload, createIdempotencyKey\.current\)/);
  assert.doesNotMatch(createBranch.split(': await eventApi.update')[0], /existing!\.version/);
});
