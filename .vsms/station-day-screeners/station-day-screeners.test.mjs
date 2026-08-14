import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const page = readFileSync(new URL('../../react-user-dashboard/src/features/events/EventDetailPage.tsx', import.meta.url), 'utf8');

test('station days assign only event members with the screener role', () => {
  assert.match(page, /membership\.status === 'ACTIVE'/);
  assert.match(page, /role === 'SCREENER'/);
  assert.match(page, /assignmentRole: 'SCREENER'/);
  assert.match(page, /dateKey\(shift\.startsAt/);
  assert.match(page, /station-person-tag/);
  assert.match(page, /addDayShift/);
  assert.match(page, /Add shift/);
  assert.match(page, /deleteShift/);
  assert.match(page, /Delete \$\{shift\.name\}/);
});
