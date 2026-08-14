import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { findShiftConflicts } from '../../react-user-dashboard/src/features/events/shiftAvailability';

const assignment = (userId: string, status: 'ASSIGNED' | 'COMPLETED' = 'ASSIGNED') => ({
  staffAssignmentId: `${userId}-assignment`, assignmentRole: 'SCREENER' as const, status,
  user: { userId, fullName: userId }, eventStation: { eventStationId: 'refraction', name: 'Refraction' },
});
const shift = (shiftId: string, startsAt: string, endsAt: string, staffAssignments: ReturnType<typeof assignment>[] = []) => ({
  shiftId, name: shiftId, startsAt, endsAt, requiredStaff: 1, status: 'ACTIVE' as const, staffAssignments,
});

describe('shift staffing availability', () => {
  it('keeps working-hour editing on the Shifts page', () => {
    const source = readFileSync(new URL('../../react-user-dashboard/src/features/events/EventDetailPage.tsx', import.meta.url), 'utf8');
    expect(source).toContain('Edit shift');
    expect(source).toContain("type=\"time\"");
  });

  it('blocks active overlapping duties but permits completed and non-overlapping duties', () => {
    const target = shift('test', '2026-08-14T01:00:00.000Z', '2026-08-14T09:00:00.000Z');
    const conflicts = findShiftConflicts([
      target,
      shift('afternoon', '2026-08-14T05:00:00.000Z', '2026-08-14T09:00:00.000Z', [assignment('Casey')]),
      shift('early', '2026-08-14T00:00:00.000Z', '2026-08-14T01:00:00.000Z', [assignment('Morgan')]),
      shift('done', '2026-08-14T05:00:00.000Z', '2026-08-14T09:00:00.000Z', [assignment('Riley', 'COMPLETED')]),
    ], target, 'visual-main');

    expect([...conflicts.keys()]).toEqual(['Casey']);
  });
});
