import { describe, expect, it } from 'vitest';
import {
  extraResultData,
  resolveCompatibleFieldSchema,
  SYSTEM_FIELD_SCHEMAS,
} from './fieldSchema';

describe('compatible station schemas', () => {
  it('opens a built-in station that has no snapshot yet', () => {
    expect(resolveCompatibleFieldSchema('VISUAL_ACUITY', null)).toEqual(SYSTEM_FIELD_SCHEMAS.VISUAL_ACUITY);
  });

  it('keeps extra customized clinical fields for the reviewer', () => {
    const extras = extraResultData('VISUAL_ACUITY', {
      chartDistanceMetres: 6,
      od: { kind: 'FRACTION', denominator: 6 },
      os: { kind: 'FRACTION', denominator: 6 },
      withUsualDistanceGlasses: false,
      screenerComment: 'Participant needed extra time.',
    });
    expect(extras).toEqual({ screenerComment: 'Participant needed extra time.' });
  });
});
