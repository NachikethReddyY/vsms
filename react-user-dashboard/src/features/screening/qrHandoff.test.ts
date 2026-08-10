import { describe, expect, it } from 'vitest';
import { HANDOFF_STATION_OPTIONS, stationHandoffUrl } from './qrHandoff';

describe('QR station handoff', () => {
  it('loads the routed station configuration without a circular dependency', () => {
    expect(HANDOFF_STATION_OPTIONS).toEqual([
      'VISUAL_ACUITY',
      'REFRACTION',
      'COLOUR_VISION',
      'EYE_HEALTH',
    ]);
    expect(stationHandoffUrl('event-1', 'registration/1', 'REFRACTION')).toBe(
      '/events/event-1/stations/refraction?registrationId=registration%2F1',
    );
  });
});
