export type FieldType = 'text' | 'number' | 'select' | 'boolean' | 'eye-pair' | 'va-eye' | 'refraction-eye';
export type FieldEyes = 'OD' | 'OS' | 'BOTH';
export type FlagLevel = 'REVIEW' | 'REFER' | 'URGENT';
export type FlagOp = 'eq' | 'neq' | 'lt' | 'lte' | 'gt' | 'gte' | 'includes' | 'isTrue' | 'isFalse' | 'isEmpty' | 'notEmpty';

export type FieldFlagRule = {
  op: FlagOp;
  value?: string | number | boolean;
  flag: FlagLevel;
  reason: string;
};

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
  flagRules?: FieldFlagRule[];
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

export type TemplateFlagEvaluation = {
  overallFlag: 'NORMAL' | FlagLevel;
  isFlagged: boolean;
  flagSummary: string | null;
  ruleVersion: string;
  reasons: Array<{ flag: 'NORMAL' | FlagLevel; reason: string }>;
};

const FLAG_RANK: Record<string, number> = { NORMAL: 0, REVIEW: 1, REFER: 2, URGENT: 3 };
export const TEMPLATE_FLAG_RULE_VERSION = 'TEMPLATE-FLAG-1.0';

export const FLAG_OP_OPTIONS: Array<{ value: FlagOp; label: string; needsValue: boolean }> = [
  { value: 'eq', label: 'Equals', needsValue: true },
  { value: 'neq', label: 'Does not equal', needsValue: true },
  { value: 'lt', label: 'Less than', needsValue: true },
  { value: 'lte', label: 'Less than or equal', needsValue: true },
  { value: 'gt', label: 'Greater than', needsValue: true },
  { value: 'gte', label: 'Greater than or equal', needsValue: true },
  { value: 'includes', label: 'Text includes', needsValue: true },
  { value: 'isTrue', label: 'Is yes / true', needsValue: false },
  { value: 'isFalse', label: 'Is no / false', needsValue: false },
  { value: 'isEmpty', label: 'Is empty', needsValue: false },
  { value: 'notEmpty', label: 'Is not empty', needsValue: false },
];

/** Required medical fields clinical evaluators need. Labels may change; key/type/required may not. */
export const CLINICAL_FIELD_CONTRACTS: Partial<Record<string, Array<{ key: string; type: FieldType }>>> = {
  VISUAL_ACUITY: [
    { key: 'chartDistanceMetres', type: 'select' },
    { key: 'od', type: 'va-eye' },
    { key: 'os', type: 'va-eye' },
    { key: 'withUsualDistanceGlasses', type: 'select' },
  ],
  REFRACTION: [
    { key: 'measurementStatus', type: 'select' },
    { key: 'wearsDistanceGlasses', type: 'select' },
    { key: 'od', type: 'refraction-eye' },
    { key: 'os', type: 'refraction-eye' },
    { key: 'notes', type: 'text' },
  ],
  COLOUR_VISION: [
    { key: 'testKit', type: 'select' },
    { key: 'platesPresented', type: 'number' },
    { key: 'odCorrect', type: 'number' },
    { key: 'osCorrect', type: 'number' },
  ],
};

export function clinicalLockedKeys(stationType: string | null | undefined): Set<string> {
  const contract = stationType ? CLINICAL_FIELD_CONTRACTS[stationType] : null;
  return new Set((contract ?? []).map((field) => field.key));
}

export function supportsFieldFlagRules(field: Pick<FieldDefinition, 'type'>): boolean {
  return field.type === 'text' || field.type === 'number' || field.type === 'select' || field.type === 'boolean';
}

export function emptyField(index = 0): FieldDefinition {
  return {
    key: `field${index + 1}`,
    label: `Field ${index + 1}`,
    type: 'text',
    required: false,
  };
}

export function emptyFlagRule(): FieldFlagRule {
  return { op: 'eq', value: '', flag: 'REVIEW', reason: '' };
}

export function validateFieldSchema(schema: FieldSchema, stationType?: string | null): string[] {
  const errors: string[] = [];
  const keys = new Set<string>();
  const locked = clinicalLockedKeys(stationType);
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
    if (field.flagRules?.length) {
      if (locked.has(field.key)) errors.push(`${name} is a clinical field and cannot define template flag rules.`);
      if (!supportsFieldFlagRules(field)) errors.push(`${name} type cannot define template flag rules.`);
      if (field.flagRules.length > 10) errors.push(`${name} can have at most 10 flag rules.`);
      field.flagRules.forEach((rule, ruleIndex) => {
        if (!rule.reason.trim()) errors.push(`${name} flag rule ${ruleIndex + 1} needs a reason.`);
        const opMeta = FLAG_OP_OPTIONS.find((item) => item.value === rule.op);
        if (opMeta?.needsValue && (rule.value === undefined || rule.value === '')) {
          errors.push(`${name} flag rule ${ruleIndex + 1} needs a comparison value.`);
        }
      });
    }
  });
  const contract = stationType ? CLINICAL_FIELD_CONTRACTS[stationType] : null;
  if (contract) {
    for (const required of contract) {
      const field = schema.find((item) => item.key === required.key);
      if (!field) errors.push(`Keep the required clinical field "${required.key}".`);
      else if (field.type !== required.type) errors.push(`Clinical field "${required.key}" must stay type ${required.type}.`);
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

export function defaultValuesForSchema(schema: FieldSchema): DynamicFieldValues {
  return Object.fromEntries(schema.map((field) => [field.key, defaultValueForField(field)]));
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

function matchesFlagRule(value: unknown, rule: FieldFlagRule): boolean {
  switch (rule.op) {
    case 'isEmpty':
      return isBlank(value);
    case 'notEmpty':
      return !isBlank(value);
    case 'isTrue':
      return value === true || value === 'yes';
    case 'isFalse':
      return value === false || value === 'no';
    case 'eq':
      return value === rule.value || String(value) === String(rule.value);
    case 'neq':
      return value !== rule.value && String(value) !== String(rule.value);
    case 'includes':
      return typeof value === 'string' && typeof rule.value === 'string' && value.toLowerCase().includes(String(rule.value).toLowerCase());
    case 'lt':
    case 'lte':
    case 'gt':
    case 'gte': {
      const left = typeof value === 'number' ? value : Number(value);
      const right = typeof rule.value === 'number' ? rule.value : Number(rule.value);
      if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
      if (rule.op === 'lt') return left < right;
      if (rule.op === 'lte') return left <= right;
      if (rule.op === 'gt') return left > right;
      return left >= right;
    }
    default:
      return false;
  }
}

export function evaluateTemplateFlagRules(resultData: DynamicFieldValues, fieldSchema: FieldSchema = []): TemplateFlagEvaluation {
  const reasons: Array<{ flag: FlagLevel; reason: string }> = [];
  for (const field of fieldSchema) {
    for (const rule of field.flagRules ?? []) {
      if (matchesFlagRule(resultData[field.key], rule)) {
        reasons.push({ flag: rule.flag, reason: rule.reason });
      }
    }
  }
  const overallFlag = reasons.reduce<'NORMAL' | FlagLevel>(
    (worst, item) => (FLAG_RANK[item.flag] > FLAG_RANK[worst] ? item.flag : worst),
    'NORMAL',
  );
  return {
    overallFlag,
    isFlagged: overallFlag !== 'NORMAL',
    flagSummary: reasons.length ? reasons.map((item) => item.reason).join('; ') : null,
    ruleVersion: TEMPLATE_FLAG_RULE_VERSION,
    reasons,
  };
}

export function mergeFlagEvaluations(...evaluations: Array<Pick<TemplateFlagEvaluation, 'overallFlag' | 'isFlagged' | 'flagSummary' | 'ruleVersion' | 'reasons'> | null | undefined>): TemplateFlagEvaluation {
  const present = evaluations.filter((evaluation): evaluation is NonNullable<typeof evaluation> => Boolean(evaluation));
  const reasons = present.flatMap((evaluation) => evaluation.reasons ?? []);
  const overallFlag = present.reduce<'NORMAL' | FlagLevel>((worst, evaluation) => {
    const flag = evaluation.overallFlag ?? 'NORMAL';
    return FLAG_RANK[flag] > FLAG_RANK[worst] ? flag : worst;
  }, 'NORMAL');
  const clinical = present.find((evaluation) => String(evaluation.ruleVersion || '').startsWith('VSMS-'));
  const template = present.find((evaluation) => evaluation.ruleVersion === TEMPLATE_FLAG_RULE_VERSION);
  let ruleVersion = clinical?.ruleVersion || template?.ruleVersion || TEMPLATE_FLAG_RULE_VERSION;
  // Keep under ScreeningResult.ruleVersion VarChar(20).
  if (clinical?.ruleVersion && template?.reasons?.length) {
    ruleVersion = `${clinical.ruleVersion}+TF`.slice(0, 20);
  }
  return {
    overallFlag,
    isFlagged: overallFlag !== 'NORMAL',
    flagSummary: reasons.length
      ? reasons.map((item) => item.reason).join('; ')
      : present.find((evaluation) => evaluation.flagSummary)?.flagSummary ?? null,
    ruleVersion,
    reasons,
  };
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

/** Keep configured labels and order when displaying a frozen station result. */
export function orderedResultFields(schema: FieldSchema | null | undefined, data: Record<string, unknown>) {
  const configured = new Map((schema ?? []).map((field) => [field.key, field]));
  const orderedKeys = [
    ...(schema ?? []).map((field) => field.key).filter((key) => key in data),
    ...Object.keys(data).filter((key) => !configured.has(key)),
  ];
  return orderedKeys.map((key) => ({
    key,
    label: configured.get(key)?.label ?? key
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/_/g, ' ')
      .replace(/^\w/, (letter: string) => letter.toUpperCase()),
    value: data[key],
  }));
}

/** Open pre-upgrade stations that have no snapshot yet. */
export function resolveCompatibleFieldSchema(
  stationType: string | null | undefined,
  snapshot: FieldSchema | null | undefined,
): FieldSchema | null {
  if (Array.isArray(snapshot) && snapshot.length) return snapshot;
  return (stationType && SYSTEM_FIELD_SCHEMAS[stationType]) || null;
}
