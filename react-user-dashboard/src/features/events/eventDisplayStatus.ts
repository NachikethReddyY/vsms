import type { EventStatus } from './eventApi';

export type EventDisplayStatus = EventStatus | 'ENDED';

export function getEventDisplayStatus(status: EventStatus, endsAt: string, now: Date): EventDisplayStatus {
  return status === 'IN_PROGRESS' && new Date(endsAt).getTime() <= now.getTime() ? 'ENDED' : status;
}

export function formatEventTimeRange(startsAt: string, endsAt: string, timeZone: string): string {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  const day = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone });
  const shortDate = new Intl.DateTimeFormat('en-SG', { day: 'numeric', month: 'short', timeZone });
  const time = new Intl.DateTimeFormat('en-SG', { hour: 'numeric', minute: '2-digit', timeZone });
  const endLabel = day.format(start) === day.format(end) ? time.format(end) : `${shortDate.format(end)}, ${time.format(end)}`;
  return `${time.format(start)} – ${endLabel}`.toUpperCase();
}

export function getEventScheduleDays<T extends { startsAt: string; endsAt: string }>(eventDays: T[], startsAt: string, endsAt: string): T[] | Array<{ startsAt: string; endsAt: string }> {
  return eventDays.length ? [...eventDays].sort((a, b) => a.startsAt.localeCompare(b.startsAt)) : [{ startsAt, endsAt }];
}
