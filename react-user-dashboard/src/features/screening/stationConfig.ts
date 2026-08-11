import type { StationType } from './screeningApi';

/** Slugs for station pages that currently have UI routes. */
export const STATION_PATH_SLUG: Partial<Record<StationType, string>> = {
  VISUAL_ACUITY: 'visual-acuity',
  REFRACTION: 'refraction',
  COLOUR_VISION: 'colour-vision',
  EYE_HEALTH: 'eye-health',
};

export const STATION_LABEL: Record<StationType, string> = {
  VISUAL_ACUITY: 'Visual Acuity',
  REFRACTION: 'Refraction',
  COLOUR_VISION: 'Colour Vision',
  EYE_HEALTH: 'Eye Health',
  CUSTOM: 'Custom Station',
};

export function customStationPath(eventId: string, stationId: string, registrationId?: string | null): string {
  const base = `/events/${eventId}/stations/custom/${stationId}`;
  return registrationId ? `${base}?registrationId=${encodeURIComponent(registrationId)}` : base;
}

export function stationPath(
  eventId: string,
  stationType: StationType,
  registrationId?: string | null,
): string | null {
  const slug = STATION_PATH_SLUG[stationType];
  if (!slug) return null;
  const base = `/events/${eventId}/stations/${slug}`;
  if (!registrationId) return base;
  return `${base}?registrationId=${encodeURIComponent(registrationId)}`;
}
