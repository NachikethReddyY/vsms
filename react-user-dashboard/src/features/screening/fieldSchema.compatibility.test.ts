import { describe, expect, it } from 'vitest';
import {
  defaultValuesForSchema,
  orderedResultFields,
  resolveCompatibleFieldSchema,
  SYSTEM_FIELD_SCHEMAS,
  validateFieldSchema,
  withCompatibleFieldSchema,
} from './fieldSchema';

describe('compatible station schemas', () => {
  it('opens a built-in station that has no snapshot yet', () => {
    const schema = resolveCompatibleFieldSchema('VISUAL_ACUITY', null);
    expect(schema).toEqual(SYSTEM_FIELD_SCHEMAS.VISUAL_ACUITY);
    expect(defaultValuesForSchema(schema!)).toMatchObject({
      chartDistanceMetres: '3',
      od: { kind: 'FRACTION', denominator: 6 },
      os: { kind: 'FRACTION', denominator: 6 },
    });
  });

  it('normalizes a pre-upgrade offline station before it enters page state', () => {
    const station = withCompatibleFieldSchema({
      stationType: 'VISUAL_ACUITY',
      fieldSchemaSnapshot: null,
    });
    expect(station.fieldSchemaSnapshot).toEqual(SYSTEM_FIELD_SCHEMAS.VISUAL_ACUITY);
    expect(defaultValuesForSchema(station.fieldSchemaSnapshot ?? [])).toMatchObject({
      chartDistanceMetres: '3',
    });
  });

  it('uses frozen administrator labels and order for reviewer fields', () => {
    const fields = orderedResultFields([
      { key: 'screenerComment', label: 'Accommodation needed?', type: 'text' },
      { key: 'chartDistanceMetres', label: 'Testing distance', type: 'number' },
    ], {
      chartDistanceMetres: 6,
      screenerComment: 'Participant needed extra time.',
    });
    expect(fields.map(({ key, label }) => ({ key, label }))).toEqual([
      { key: 'screenerComment', label: 'Accommodation needed?' },
      { key: 'chartDistanceMetres', label: 'Testing distance' },
    ]);
  });

  it('locks clinical options and numeric limits', () => {
    const extraOption = (SYSTEM_FIELD_SCHEMAS.VISUAL_ACUITY ?? []).map((field) => (
      field.key === 'chartDistanceMetres' ? { ...field, options: ['3', '6', '9'] } : field
    ));
    expect(validateFieldSchema(extraOption, 'VISUAL_ACUITY').some((error) => /options/.test(error))).toBe(true);

    const widened = (SYSTEM_FIELD_SCHEMAS.COLOUR_VISION ?? []).map((field) => (
      field.key === 'platesPresented' ? { ...field, min: 1, max: 48 } : field
    ));
    expect(validateFieldSchema(widened, 'COLOUR_VISION').some((error) => /minimum|maximum/.test(error))).toBe(true);
  });
});
