import { describe, expect, it } from 'vitest';
import {
  extraResultData,
  resolveCompatibleFieldSchema,
  SYSTEM_FIELD_SCHEMAS,
  validateFieldSchema,
  withCompatibleFieldSchema,
} from './fieldSchema';

describe('compatible station schemas', () => {
  it('opens a built-in station that has no snapshot yet', () => {
    expect(resolveCompatibleFieldSchema('VISUAL_ACUITY', null)).toEqual(SYSTEM_FIELD_SCHEMAS.VISUAL_ACUITY);
  });

  it('normalizes a pre-upgrade offline station before it enters page state', () => {
    const station = withCompatibleFieldSchema({
      stationType: 'VISUAL_ACUITY',
      fieldSchemaSnapshot: null,
    });
    expect(station.fieldSchemaSnapshot).toEqual(SYSTEM_FIELD_SCHEMAS.VISUAL_ACUITY);
    expect(station.fieldSchemaSnapshot?.map((field) => field.key) ?? []).toContain('chartDistanceMetres');
  });

  it('locks clinical options and numeric limits', () => {
    const extraOption = (SYSTEM_FIELD_SCHEMAS.VISUAL_ACUITY ?? []).map((field) => (
      field.key === 'chartDistanceMetres' ? { ...field, options: ['3', '6', '9'] } : field
    ));
    expect(validateFieldSchema(extraOption, 'VISUAL_ACUITY').some((error) => error.includes('options must stay'))).toBe(true);

    const widened = (SYSTEM_FIELD_SCHEMAS.COLOUR_VISION ?? []).map((field) => (
      field.key === 'platesPresented' ? { ...field, min: 1, max: 48 } : field
    ));
    expect(validateFieldSchema(widened, 'COLOUR_VISION').some((error) => error.includes('minimum must stay') || error.includes('maximum must stay'))).toBe(true);
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
