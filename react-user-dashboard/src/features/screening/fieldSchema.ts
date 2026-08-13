export type FieldType = 'text' | 'number' | 'select' | 'boolean' | 'eye-pair' | 'va-eye' | 'refraction-eye';
export type FieldEyes = 'OD' | 'OS' | 'BOTH';

export type FieldDefinition = {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: string[];
  min?: number;
  max?: number;
  unit?: string;
  eyes?: FieldEyes;
};

export type FieldSchema = FieldDefinition[];
export type DynamicFieldValues = Record<string, unknown>;

export type VaEyeValue =
  | { kind: 'FRACTION'; denominator: number }
  | { kind: 'EXCEPTION'; code: 'CF' | 'HM' | 'LP' | 'NLP' | 'NOT_TESTABLE' };

export type RefractionEyeValue = {
  sphere: number;
  cylinder: number;
  axis: number | null;
};

type ClinicalFieldContract = {
  key: string;
  type: FieldType;
  required?: boolean;
  options?: string[];
  min?: number;
  max?: number;
};

/** Required medical fields clinical evaluators need. Labels may change; key/type/required/options/limits may not. */
export const CLINICAL_FIELD_CONTRACTS: Partial<Record<string, ClinicalFieldContract[]>> = {
  VISUAL_ACUITY: [
    { key: 'chartDistanceMetres', type: 'select', required: true, options: ['3', '6'] },
    { key: 'od', type: 'va-eye', required: true },
    { key: 'os', type: 'va-eye', required: true },
    { key: 'withUsualDistanceGlasses', type: 'select', required: true, options: ['yes', 'no', 'unknown'] },
  ],
  REFRACTION: [
    { key: 'measurementStatus', type: 'select', required: true, options: ['COMPLETED', 'UNABLE_TO_MEASURE', 'REPEAT_REQUIRED'] },
    { key: 'wearsDistanceGlasses', type: 'select', required: true, options: ['yes', 'no', 'unknown'] },
    { key: 'od', type: 'refraction-eye' },
    { key: 'os', type: 'refraction-eye' },
    { key: 'notes', type: 'text' },
  ],
  COLOUR_VISION: [
    { key: 'testKit', type: 'select', required: true, options: ['ISHIHARA'] },
    { key: 'platesPresented', type: 'number', required: true, min: 8, max: 24 },
    { key: 'odCorrect', type: 'number', required: true, min: 0, max: 24 },
    { key: 'osCorrect', type: 'number', required: true, min: 0, max: 24 },
  ],
};

export function clinicalLockedKeys(stationType: string | null | undefined): Set<string> {
  const contract = stationType ? CLINICAL_FIELD_CONTRACTS[stationType] : null;
  return new Set((contract ?? []).map((field) => field.key));
}

export function emptyField(index = 0): FieldDefinition {
  return {
    key: `field${index + 1}`,
    label: `Field ${index + 1}`,
    type: 'text',
    required: false,
  };
}

export function validateFieldSchema(schema: FieldSchema, stationType?: string | null): string[] {
  const errors: string[] = [];
  const keys = new Set<string>();
  if (!schema.length) errors.push('Add at least one field.');
  if (schema.length > 40) errors.push('A template can contain at most 40 fields.');
  schema.forEach((field, index) => {
    const name = field.label.trim() || `Field ${index + 1}`;
    if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(field.key)) errors.push(`${name} needs a key that starts with a letter and uses only letters, numbers, or underscores.`);
    if (keys.has(field.key)) errors.push(`Field key "${field.key}" is duplicated.`);
    keys.add(field.key);
    if (!field.label.trim()) errors.push(`Field ${index + 1} needs a label.`);
    if (field.type === 'select' && !field.options?.some((option) => option.trim())) errors.push(`${name} needs at least one option.`);
    if (field.min != null && field.max != null && field.min > field.max) errors.push(`${name} has a minimum greater than its maximum.`);
  });
  const contract = stationType ? CLINICAL_FIELD_CONTRACTS[stationType] : null;
  if (contract) {
    for (const required of contract) {
      const field = schema.find((item) => item.key === required.key);
      const name = field?.label.trim() || required.key;
      if (!field) errors.push(`Keep the required clinical field "${required.key}".`);
      else if (field.type !== required.type) errors.push(`Clinical field "${required.key}" must stay type ${required.type}.`);
      else if (required.options) {
        const options = field.options ?? [];
        const same = required.options.length === options.length && required.options.every((option) => options.includes(option));
        if (!same) errors.push(`${name} options must stay ${required.options.join(', ')}.`);
      } else if (required.min != null && field.min !== required.min) {
        errors.push(`${name} minimum must stay ${required.min}.`);
      } else if (required.max != null && field.max !== required.max) {
        errors.push(`${name} maximum must stay ${required.max}.`);
      }
    }
  }
  return errors;
}

function isBlank(value: unknown) {
  return value == null || value === '';
}

export function validateFieldValues(schema: FieldSchema, values: DynamicFieldValues): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const field of schema) {
    const value = values[field.key];
    if (isBlank(value)) {
      if (field.required) errors[field.key] = `${field.label} is required.`;
      continue;
    }
    if (field.type === 'number') {
      const number = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(number)) errors[field.key] = `${field.label} must be a number.`;
      else if (field.min != null && number < field.min) errors[field.key] = `${field.label} must be at least ${field.min}.`;
      else if (field.max != null && number > field.max) errors[field.key] = `${field.label} must be at most ${field.max}.`;
    } else if (field.type === 'select' && !field.options?.includes(String(value))) {
      errors[field.key] = `Choose a valid ${field.label} option.`;
    } else if (field.type === 'eye-pair' && (field.eyes ?? 'BOTH') === 'BOTH') {
      const pair = value as { od?: unknown; os?: unknown } | null;
      if (!pair || isBlank(pair.od) || isBlank(pair.os)) errors[field.key] = `${field.label} requires OD and OS values.`;
    } else if (field.type === 'va-eye') {
      const eye = value as VaEyeValue | null;
      if (!eye || (eye.kind === 'FRACTION' && !eye.denominator) || (eye.kind === 'EXCEPTION' && !eye.code)) {
        errors[field.key] = `${field.label} needs a chart line or exception code.`;
      }
    } else if (field.type === 'refraction-eye') {
      const eye = value as RefractionEyeValue | null;
      if (!eye || !Number.isFinite(eye.sphere) || !Number.isFinite(eye.cylinder)) {
        errors[field.key] = `${field.label} needs sphere and cylinder values.`;
      } else if (Math.abs(eye.cylinder) >= 0.25 && eye.axis == null) {
        errors[field.key] = `${field.label} needs an axis when cylinder is non-zero.`;
      }
    }
  }
  return errors;
}

export function defaultValueForField(field: FieldDefinition): unknown {
  if (field.type === 'va-eye') return { kind: 'FRACTION', denominator: 6 } satisfies VaEyeValue;
  if (field.type === 'refraction-eye') return { sphere: 0, cylinder: 0, axis: null } satisfies RefractionEyeValue;
  if (field.type === 'boolean') return false;
  if (field.type === 'number') return field.min ?? 0;
  if (field.type === 'select') return field.options?.[0] ?? '';
  if (field.type === 'eye-pair') return (field.eyes ?? 'BOTH') === 'BOTH' ? { od: '', os: '' } : '';
  return '';
}

function triStateToNullableBoolean(value: unknown) {
  if (value === 'yes' || value === true) return true;
  if (value === 'no' || value === false) return false;
  return null;
}

/** Map schema form values into clinical evaluator payload shapes. Extra template fields stay attached. */
export function normalizeClinicalResultData(stationType: string | null | undefined, resultData: DynamicFieldValues): DynamicFieldValues {
  if (stationType === 'VISUAL_ACUITY') {
    return {
      ...resultData,
      chartDistanceMetres: Number(resultData.chartDistanceMetres),
      withUsualDistanceGlasses: triStateToNullableBoolean(resultData.withUsualDistanceGlasses),
    };
  }
  if (stationType === 'REFRACTION') {
    const { measurementStatus, wearsDistanceGlasses, od, os, notes, ...extras } = resultData;
    const base: DynamicFieldValues = {
      ...extras,
      measurementStatus,
      wearsDistanceGlasses: triStateToNullableBoolean(wearsDistanceGlasses),
      ...(notes !== undefined ? { notes } : {}),
    };
    if (measurementStatus === 'COMPLETED') {
      return { ...base, od, os };
    }
    return base;
  }
  return resultData;
}

export const SYSTEM_FIELD_SCHEMAS: Partial<Record<string, FieldSchema>> = {
  VISUAL_ACUITY: [
    { key: 'chartDistanceMetres', label: 'Chart distance (m)', type: 'select', required: true, options: ['3', '6'] },
    { key: 'od', label: 'Right eye (OD)', type: 'va-eye', required: true },
    { key: 'os', label: 'Left eye (OS)', type: 'va-eye', required: true },
    { key: 'withUsualDistanceGlasses', label: 'With usual distance glasses', type: 'select', required: true, options: ['yes', 'no', 'unknown'] },
  ],
  REFRACTION: [
    { key: 'measurementStatus', label: 'Measurement status', type: 'select', required: true, options: ['COMPLETED', 'UNABLE_TO_MEASURE', 'REPEAT_REQUIRED'] },
    { key: 'wearsDistanceGlasses', label: 'Wears distance glasses', type: 'select', required: true, options: ['yes', 'no', 'unknown'] },
    { key: 'od', label: 'Right eye (OD)', type: 'refraction-eye', required: false },
    { key: 'os', label: 'Left eye (OS)', type: 'refraction-eye', required: false },
    { key: 'notes', label: 'Notes', type: 'text', required: false },
  ],
  COLOUR_VISION: [
    { key: 'testKit', label: 'Test kit', type: 'select', required: true, options: ['ISHIHARA'] },
    { key: 'platesPresented', label: 'Plates presented', type: 'number', required: true, min: 8, max: 24 },
    { key: 'odCorrect', label: 'OD plates correct', type: 'number', required: true, min: 0, max: 24 },
    { key: 'osCorrect', label: 'OS plates correct', type: 'number', required: true, min: 0, max: 24 },
  ],
};

const CLINICAL_RESULT_KEYS: Record<string, string[]> = {
  VISUAL_ACUITY: ['chartDistanceMetres', 'od', 'os', 'withUsualDistanceGlasses'],
  REFRACTION: ['measurementStatus', 'wearsDistanceGlasses', 'od', 'os', 'notes'],
  COLOUR_VISION: ['testKit', 'platesPresented', 'odCorrect', 'osCorrect'],
  EYE_HEALTH: ['cataractRisk', 'glaucomaRisk', 'symptomsNoted', 'symptomSummary', 'observations', 'deviceFindings'],
};

/** Fields a reviewer should still see after clinical display of known medical keys. */
export function extraResultData(stationType: string | null | undefined, data: Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (!data) return {};
  const known = new Set(stationType ? CLINICAL_RESULT_KEYS[stationType] || [] : []);
  if (!known.size) return data;
  return Object.fromEntries(Object.entries(data).filter(([key]) => !known.has(key)));
}

/** Open pre-upgrade stations that have no snapshot yet. */
export function resolveCompatibleFieldSchema(
  stationType: string | null | undefined,
  snapshot: FieldSchema | null | undefined,
): FieldSchema | null {
  if (Array.isArray(snapshot) && snapshot.length) return snapshot;
  return (stationType && SYSTEM_FIELD_SCHEMAS[stationType]) || null;
}

export function withCompatibleFieldSchema<T extends { stationType: string; fieldSchemaSnapshot?: FieldSchema | null }>(
  station: T,
): Omit<T, 'fieldSchemaSnapshot'> & { fieldSchemaSnapshot: FieldSchema | null } {
  return {
    ...station,
    fieldSchemaSnapshot: resolveCompatibleFieldSchema(station.stationType, station.fieldSchemaSnapshot),
  };
}
