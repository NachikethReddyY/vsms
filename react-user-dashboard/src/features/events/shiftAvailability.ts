import type { EventRecord } from './eventApi';

export function findShiftConflicts(shifts: EventRecord['shifts'], target: EventRecord['shifts'][number], eventStationId: string) {
  const conflicts = new Map<string, EventRecord['shifts'][number]>();
  shifts.forEach((shift) => {
    const overlaps = shift.shiftId !== target.shiftId
      && new Date(shift.startsAt) < new Date(target.endsAt)
      && new Date(shift.endsAt) > new Date(target.startsAt);
    shift.staffAssignments.filter(({ status }) => ['ASSIGNED', 'CONFIRMED'].includes(status)).forEach((assignment) => {
      const sameSlot = shift.shiftId === target.shiftId
        && (assignment.eventStation?.eventStationId ?? '') === eventStationId;
      if (overlaps || sameSlot) conflicts.set(assignment.user.userId, shift);
    });
  });
  return conflicts;
}
