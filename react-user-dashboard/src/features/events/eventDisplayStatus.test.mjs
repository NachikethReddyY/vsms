import { test } from 'vitest';
import assert from 'node:assert/strict';
import { formatEventTimeRange, getEventDisplayStatus, getEventScheduleDays } from './eventDisplayStatus.ts';

test('an in-progress event is ended after its scheduled end', () => {
  assert.equal(getEventDisplayStatus('IN_PROGRESS', '2026-08-03T23:00:00.000Z', new Date('2026-08-04T01:00:00.000Z')), 'ENDED');
});

test('an in-progress event remains live before its scheduled end', () => {
  assert.equal(getEventDisplayStatus('IN_PROGRESS', '2026-08-04T03:00:00.000Z', new Date('2026-08-04T01:00:00.000Z')), 'IN_PROGRESS');
});

test('a schedule crossing midnight includes the end date', () => {
  assert.equal(formatEventTimeRange('2026-08-03T00:00:00.000Z', '2026-08-03T23:00:00.000Z', 'Asia/Singapore'), '8:00 AM – 4 AUG, 7:00 AM');
});

test('multi-day schedules use each event day in date order', () => {
  const days = [
    { startsAt: '2026-08-15T01:00:00.000Z', endsAt: '2026-08-15T09:00:00.000Z' },
    { startsAt: '2026-08-14T01:00:00.000Z', endsAt: '2026-08-14T09:00:00.000Z' },
  ];
  assert.deepEqual(getEventScheduleDays(days, '', ''), [days[1], days[0]]);
});
