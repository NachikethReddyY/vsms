import { emptyField, type FieldSchema } from '../features/screening/fieldSchema';

/** Creatable screening station types. Eye health is clinician-review only. */
export const STATION_TYPE_OPTIONS = [
  { value: 'VISUAL_ACUITY', label: 'Visual acuity' },
  { value: 'REFRACTION', label: 'Refraction' },
  { value: 'COLOUR_VISION', label: 'Colour vision' },
  { value: 'CUSTOM', label: 'Custom' },
] as const;

export type StationType = typeof STATION_TYPE_OPTIONS[number]['value'];
export type CatalogStationType = StationType | 'EYE_HEALTH';

/** Operational / review workflows — not managed in the admin station library. */
export const HIDDEN_LIBRARY_TEMPLATE_KEYS = ['REGISTRATION', 'CLINICAL_REVIEW', 'EYE_HEALTH'] as const;
export type HiddenLibraryTemplateKey = typeof HIDDEN_LIBRARY_TEMPLATE_KEYS[number];

export type StationTemplateRecord = {
  stationTemplateId: string;
  templateKey: string;
  stationType: CatalogStationType | null;
  version: number;
  name: string;
  description?: string | null;
  defaultCapacity: number;
  active: boolean;
  fieldSchema: FieldSchema | null;
};

/** Only CUSTOM schemas drive DynamicStationPage + API validation end to end. */
export const usesEditableFieldSchema = (stationType: CatalogStationType | null | undefined) => (
  stationType === 'CUSTOM'
);

export const isHiddenFromStationLibrary = (template: Pick<StationTemplateRecord, 'templateKey' | 'stationType'>) => (
  HIDDEN_LIBRARY_TEMPLATE_KEYS.includes(template.templateKey as HiddenLibraryTemplateKey)
  || template.stationType === 'EYE_HEALTH'
);

export const labelStationType = (stationType: CatalogStationType | null, templateKey?: string) => {
  if (templateKey === 'EYE_HEALTH' || stationType === 'EYE_HEALTH') return 'Eye health (review only)';
  return STATION_TYPE_OPTIONS.find((item) => item.value === stationType)?.label ?? 'Catalog template';
};

export function filterStationLibraryTemplates(templates: StationTemplateRecord[]) {
  return templates.filter((template) => !isHiddenFromStationLibrary(template));
}

export function sortTemplates(templates: StationTemplateRecord[]) {
  return [...templates].sort((left, right) => {
    if (left.active !== right.active) return left.active ? -1 : 1;
    return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
  });
}

export const blankCustomFieldSchema = (): FieldSchema => [emptyField()];
