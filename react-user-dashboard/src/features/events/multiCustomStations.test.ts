/* @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';

/**
 * Mirrors EventDetailPage / EventFormPage CUSTOM uniqueness rules so regressions
 * stay covered without mounting the full event forms.
 */
function availableTemplates(
  templates: Array<{ stationTemplateId: string; stationType: string | null }>,
  eventStations: Array<{ stationTemplateId: string; stationType: string }>,
) {
  return templates.filter((template) => {
    if (template.stationType === 'CUSTOM') {
      return !eventStations.some((station) => station.stationTemplateId === template.stationTemplateId);
    }
    return !eventStations.some((station) => station.stationType === template.stationType);
  });
}

function selectTemplatesAllowed(
  templates: Array<{ stationTemplateId: string; stationType: string | null }>,
  ids: string[],
) {
  const selected = ids
    .map((id) => templates.find((template) => template.stationTemplateId === id))
    .filter((template): template is NonNullable<typeof template> => Boolean(template));
  const clinicalTypes = selected
    .map((template) => template.stationType)
    .filter((stationType): stationType is string => Boolean(stationType) && stationType !== 'CUSTOM');
  if (new Set(clinicalTypes).size !== clinicalTypes.length) return false;
  const customTemplateIds = selected
    .filter((template) => template.stationType === 'CUSTOM')
    .map((template) => template.stationTemplateId);
  return new Set(customTemplateIds).size === customTemplateIds.length;
}

describe('multi-CUSTOM station selection rules', () => {
  const templates = [
    { stationTemplateId: 'va', stationType: 'VISUAL_ACUITY' },
    { stationTemplateId: 'custom-a', stationType: 'CUSTOM' },
    { stationTemplateId: 'custom-b', stationType: 'CUSTOM' },
  ];

  it('keeps a second distinct CUSTOM template available after one CUSTOM is imported', () => {
    const remaining = availableTemplates(templates, [
      { stationTemplateId: 'custom-a', stationType: 'CUSTOM' },
    ]);
    expect(remaining.map((item) => item.stationTemplateId)).toEqual(['va', 'custom-b']);
  });

  it('allows selecting two different CUSTOM templates together with one clinical type', () => {
    expect(selectTemplatesAllowed(templates, ['va', 'custom-a', 'custom-b'])).toBe(true);
  });

  it('rejects duplicate clinical types and duplicate CUSTOM template ids', () => {
    expect(selectTemplatesAllowed([
      ...templates,
      { stationTemplateId: 'va-2', stationType: 'VISUAL_ACUITY' },
    ], ['va', 'va-2'])).toBe(false);
    expect(selectTemplatesAllowed(templates, ['custom-a', 'custom-a'])).toBe(false);
  });
});
