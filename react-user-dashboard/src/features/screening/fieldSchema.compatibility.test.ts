import { describe, expect, it } from 'vitest';
import { defaultValuesForSchema, orderedResultFields, resolveCompatibleFieldSchema, SYSTEM_FIELD_SCHEMAS } from './fieldSchema';

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
});
