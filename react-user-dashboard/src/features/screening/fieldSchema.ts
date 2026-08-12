export type FieldType = 'text' | 'number' | 'select' | 'boolean' | 'eye-pair';
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

export function emptyField(index = 0): FieldDefinition {
  return {
    key: `field${index + 1}`,
    label: `Field ${index + 1}`,
    type: 'text',
    required: false,
  };
}

export function validateFieldSchema(schema: FieldSchema): string[] {
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
    }
  }
  return errors;
}
