import { type ChangeEvent } from 'react';
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, TrashIcon } from '@heroicons/react/24/outline';
import type {
  DynamicFieldValues,
  FieldDefinition,
  FieldFlagRule,
  FieldSchema,
  FieldType,
  RefractionEyeValue,
  VaEyeValue,
} from './fieldSchema';
import {
  emptyField,
  emptyFlagRule,
  FLAG_OP_OPTIONS,
  supportsFieldFlagRules,
} from './fieldSchema';

type RendererProps = {
  fieldSchema: FieldSchema;
  values: DynamicFieldValues;
  onChange: (key: string, value: unknown) => void;
  errors?: Record<string, string>;
  disabled?: boolean;
};

const EXCEPTION_CODES = ['CF', 'HM', 'LP', 'NLP', 'NOT_TESTABLE'] as const;
const DENOMINATORS = [6, 9, 12, 15, 18, 24, 36, 60];

const fieldId = (key: string, suffix = '') => `dynamic-field-${key.replace(/[^a-zA-Z0-9_-]/g, '-')}${suffix}`;

function VaEyeFields({
  id,
  label,
  required,
  value,
  disabled,
  error,
  onChange,
}: {
  id: string;
  label: string;
  required?: boolean;
  value: VaEyeValue;
  disabled?: boolean;
  error?: string;
  onChange: (next: VaEyeValue) => void;
}) {
  const isFraction = value.kind === 'FRACTION';
  return (
    <fieldset className="va-eye-card station-eye-pair" aria-describedby={error ? `${id}-error` : undefined}>
      <legend>{label}{required ? ' *' : ''}</legend>
      <div className="va-fraction">
        <span>6 /</span>
        <select
          id={id}
          value={isFraction ? String(value.denominator) : ''}
          disabled={disabled || !isFraction}
          onChange={(event) => onChange({ kind: 'FRACTION', denominator: Number(event.target.value) })}
        >
          <option value="" disabled>Select line</option>
          {DENOMINATORS.map((line) => <option key={line} value={line}>{line}</option>)}
        </select>
      </div>
      <div className="va-exceptions">
        {EXCEPTION_CODES.map((code) => (
          <button
            key={code}
            type="button"
            className={`secondary compact ${!isFraction && value.code === code ? 'is-selected' : ''}`}
            disabled={disabled}
            onClick={() => onChange({ kind: 'EXCEPTION', code })}
          >
            {code === 'NOT_TESTABLE' ? 'Not testable' : code}
          </button>
        ))}
        {!isFraction && (
          <button type="button" className="secondary compact" disabled={disabled} onClick={() => onChange({ kind: 'FRACTION', denominator: 6 })}>
            Use chart line
          </button>
        )}
      </div>
      {error && <span className="field-error" id={`${id}-error`}>{error}</span>}
    </fieldset>
  );
}

function RefractionEyeFields({
  id,
  label,
  required,
  value,
  disabled,
  error,
  onChange,
}: {
  id: string;
  label: string;
  required?: boolean;
  value: RefractionEyeValue;
  disabled?: boolean;
  error?: string;
  onChange: (next: RefractionEyeValue) => void;
}) {
  const needsAxis = Math.abs(value.cylinder) >= 0.25;
  return (
    <fieldset className="va-eye-card station-eye-pair" aria-describedby={error ? `${id}-error` : undefined}>
      <legend>{label}{required ? ' *' : ''}</legend>
      <label>
        Sphere (SPH)
        <input
          id={`${id}-sphere`}
          type="number"
          step="0.25"
          min={-20}
          max={20}
          disabled={disabled}
          value={value.sphere}
          onChange={(event) => onChange({ ...value, sphere: Number(event.target.value) })}
        />
      </label>
      <label>
        Cylinder (CYL)
        <input
          id={`${id}-cylinder`}
          type="number"
          step="0.25"
          min={-10}
          max={10}
          disabled={disabled}
          value={value.cylinder}
          onChange={(event) => {
            const cylinder = Number(event.target.value);
            onChange({
              ...value,
              cylinder,
              axis: Math.abs(cylinder) < 0.25 ? null : (value.axis ?? 90),
            });
          }}
        />
      </label>
      <label>
        Axis
        <input
          id={`${id}-axis`}
          type="number"
          step="1"
          min={0}
          max={180}
          disabled={disabled || !needsAxis}
          value={needsAxis ? (value.axis ?? '') : ''}
          placeholder={needsAxis ? '0–180' : 'N/A'}
          onChange={(event) => onChange({
            ...value,
            axis: event.target.value === '' ? null : Number(event.target.value),
          })}
        />
      </label>
      {error && <span className="field-error" id={`${id}-error`}>{error}</span>}
    </fieldset>
  );
}

export function StationFieldRenderer({ fieldSchema, values, onChange, errors = {}, disabled = false }: RendererProps) {
  return <div className="station-field-renderer grid gap-3.5 [&>label]:grid [&>label]:gap-1.5">
    {fieldSchema.map((field) => {
      const id = fieldId(field.key);
      const error = errors[field.key];
      const describedBy = error ? `${id}-error` : undefined;
      if (field.type === 'boolean') {
        return <label className="decision-confirm" key={field.key}>
          <input type="checkbox" checked={values[field.key] === true} disabled={disabled} onChange={(event) => onChange(field.key, event.target.checked)} />
          <span><strong>{field.label}{field.required ? ' *' : ''}</strong>{field.unit && <small>{field.unit}</small>}</span>
          {error && <small className="field-error" id={`${id}-error`}>{error}</small>}
        </label>;
      }
      if (field.type === 'va-eye') {
        const value = (values[field.key] as VaEyeValue | undefined) ?? { kind: 'FRACTION', denominator: 6 };
        return <VaEyeFields key={field.key} id={id} label={field.label} required={field.required} value={value} disabled={disabled} error={error} onChange={(next) => onChange(field.key, next)} />;
      }
      if (field.type === 'refraction-eye') {
        const value = (values[field.key] as RefractionEyeValue | undefined) ?? { sphere: 0, cylinder: 0, axis: null };
        return <RefractionEyeFields key={field.key} id={id} label={field.label} required={field.required} value={value} disabled={disabled} error={error} onChange={(next) => onChange(field.key, next)} />;
      }
      if (field.type === 'eye-pair') {
        const eyes = field.eyes ?? 'BOTH';
        const pair = (values[field.key] ?? {}) as { od?: string | number; os?: string | number };
        const singleValue = typeof values[field.key] === 'string' || typeof values[field.key] === 'number' ? values[field.key] : '';
        return <fieldset className="va-eye-card station-eye-pair" key={field.key} aria-describedby={describedBy}>
          <legend>{field.label}{field.required ? ' *' : ''}{field.unit ? ` (${field.unit})` : ''}</legend>
          {eyes === 'BOTH' ? <div className="va-eye-grid">
            <label>Right eye (OD)<input id={`${id}-od`} required={field.required} disabled={disabled} value={pair.od ?? ''} onChange={(event) => onChange(field.key, { ...pair, od: event.target.value })} /></label>
            <label>Left eye (OS)<input id={`${id}-os`} required={field.required} disabled={disabled} value={pair.os ?? ''} onChange={(event) => onChange(field.key, { ...pair, os: event.target.value })} /></label>
          </div> : <label>{eyes === 'OD' ? 'Right eye (OD)' : 'Left eye (OS)'}<input id={id} required={field.required} disabled={disabled} value={singleValue as string | number} onChange={(event) => onChange(field.key, event.target.value)} /></label>}
          {error && <span className="field-error" id={`${id}-error`}>{error}</span>}
        </fieldset>;
      }
      return <label key={field.key}>
        {field.label}{field.required ? ' *' : ''}{field.unit ? ` (${field.unit})` : ''}
        {field.type === 'select' ? <select id={id} required={field.required} disabled={disabled} value={String(values[field.key] ?? '')} aria-invalid={Boolean(error)} aria-describedby={describedBy} onChange={(event) => onChange(field.key, event.target.value)}>
          <option value="">Choose an option</option>
          {(field.options ?? []).map((option) => <option key={option} value={option}>{option}</option>)}
        </select> : <input
          id={id}
          type={field.type}
          required={field.required}
          min={field.min}
          max={field.max}
          disabled={disabled}
          value={(values[field.key] ?? '') as string | number}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy}
          onChange={(event) => onChange(field.key, field.type === 'number' ? (event.target.value === '' ? '' : event.target.valueAsNumber) : event.target.value)}
        />}
        {error && <span className="field-error" id={`${id}-error`}>{error}</span>}
      </label>;
    })}
  </div>;
}

const FIELD_TYPES: Array<{ value: FieldType; label: string }> = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'select', label: 'Select' },
  { value: 'boolean', label: 'Yes / no' },
  { value: 'eye-pair', label: 'Eye value' },
  { value: 'va-eye', label: 'Visual acuity eye' },
  { value: 'refraction-eye', label: 'Refraction eye' },
];

export function StationFieldBuilder({ fieldSchema, onChange, disabled = false, lockedKeys = new Set<string>() }: {
  fieldSchema: FieldSchema;
  onChange: (schema: FieldSchema) => void;
  disabled?: boolean;
  lockedKeys?: Set<string>;
}) {
  const update = (index: number, changes: Partial<FieldDefinition>) => onChange(fieldSchema.map((field, fieldIndex) => fieldIndex === index ? { ...field, ...changes } : field));
  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= fieldSchema.length) return;
    const next = [...fieldSchema];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };
  const changeType = (index: number, type: FieldType) => {
    const field: FieldDefinition = { ...fieldSchema[index], type };
    if (type === 'select' && !field.options?.length) field.options = ['Option 1'];
    if (type === 'eye-pair' && !field.eyes) field.eyes = 'BOTH';
    update(index, field);
  };
  const changeOptions = (index: number, event: ChangeEvent<HTMLInputElement>) => update(index, {
    options: event.target.value.split(',').map((option) => option.trim()).filter(Boolean),
  });
  const changeLabel = (index: number, label: string) => {
    const field = fieldSchema[index];
    const generatedKey = label.trim().replace(/[^a-zA-Z0-9]+(.)/g, (_, letter: string) => letter.toUpperCase()).replace(/^[^a-zA-Z]+/, '');
    update(index, { label, ...(!field.key || /^field\d+$/.test(field.key) ? { key: generatedKey } : {}) });
  };

  return <section className="station-field-builder" aria-label="Template fields">
    <header>
      <div>
        <h3>Form fields</h3>
        <p>{lockedKeys.size
          ? 'Clinical fields stay required for medical flagging. You can rename labels, reorder, and add extra fields.'
          : 'Configure the data this station records.'}</p>
      </div>
      <button className="secondary compact" type="button" disabled={disabled || fieldSchema.length >= 40} onClick={() => onChange([...fieldSchema, emptyField(fieldSchema.length)])}><PlusIcon />Add field</button>
    </header>
    <div className="station-field-builder-list">
      {fieldSchema.map((field, index) => {
        const locked = lockedKeys.has(field.key);
        return <article key={`${field.key}-${index}`}>
          <div className="station-field-builder-heading">
            <strong>Field {index + 1}{locked ? ' · clinical' : ''}</strong>
            <div>
              <button type="button" className="icon-button" disabled={disabled || index === 0} aria-label={`Move ${field.label} up`} onClick={() => move(index, -1)}><ArrowUpIcon /></button>
              <button type="button" className="icon-button" disabled={disabled || index === fieldSchema.length - 1} aria-label={`Move ${field.label} down`} onClick={() => move(index, 1)}><ArrowDownIcon /></button>
              <button type="button" className="icon-button" disabled={disabled || locked} aria-label={`Remove ${field.label}`} onClick={() => onChange(fieldSchema.filter((_, fieldIndex) => fieldIndex !== index))}><TrashIcon /></button>
            </div>
          </div>
          <div className="station-field-builder-grid">
            <label><span>Label</span><input required maxLength={100} disabled={disabled} value={field.label} onChange={(event) => changeLabel(index, event.target.value)} /></label>
            <label><span>Key <small>Generated automatically</small></span><input required pattern="[a-zA-Z][a-zA-Z0-9_]*" maxLength={64} disabled={disabled || locked} value={field.key} onChange={(event) => update(index, { key: event.target.value })} /></label>
            <label><span>Type</span><select disabled={disabled || locked} value={field.type} onChange={(event) => changeType(index, event.target.value as FieldType)}>{FIELD_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}</select></label>
            <label className="station-field-required"><input type="checkbox" disabled={disabled || locked} checked={field.required ?? false} onChange={(event) => update(index, { required: event.target.checked })} /><span>Required</span></label>
            {field.type === 'select' && <label className="wide"><span>Options <small>Comma-separated</small></span><input required disabled={disabled || locked} value={(field.options ?? []).join(', ')} onChange={(event) => changeOptions(index, event)} /></label>}
            {field.type === 'eye-pair' && <label><span>Eyes</span><select disabled={disabled || locked} value={field.eyes ?? 'BOTH'} onChange={(event) => update(index, { eyes: event.target.value as FieldDefinition['eyes'] })}><option value="BOTH">OD and OS</option><option value="OD">OD only</option><option value="OS">OS only</option></select></label>}
            {field.type === 'number' && <><label><span>Minimum</span><input type="number" disabled={disabled || locked} value={field.min ?? ''} onChange={(event) => update(index, { min: event.target.value === '' ? undefined : event.target.valueAsNumber })} /></label><label><span>Maximum</span><input type="number" disabled={disabled || locked} value={field.max ?? ''} onChange={(event) => update(index, { max: event.target.value === '' ? undefined : event.target.valueAsNumber })} /></label></>}
            {(field.type === 'number' || field.type === 'eye-pair') && <label><span>Unit <small>Optional</small></span><input maxLength={20} disabled={disabled} value={field.unit ?? ''} onChange={(event) => update(index, { unit: event.target.value || undefined })} /></label>}
          </div>
          {!locked && supportsFieldFlagRules(field) && (
            <div className="station-field-flag-rules">
              <div className="station-field-builder-heading">
                <strong>Flag rules · {field.flagRules?.length ?? 0} of 10</strong>
                <button
                  type="button"
                  className="secondary compact"
                  disabled={disabled || (field.flagRules?.length ?? 0) >= 10}
                  onClick={() => update(index, { flagRules: [...(field.flagRules ?? []), emptyFlagRule()] })}
                >
                  <PlusIcon />Add rule
                </button>
              </div>
              <p className="station-library-schema-note">When this field matches a rule, the station result is flagged.</p>
              {(field.flagRules ?? []).map((rule, ruleIndex) => {
                const needsValue = FLAG_OP_OPTIONS.find((item) => item.value === rule.op)?.needsValue ?? true;
                const updateRule = (changes: Partial<FieldFlagRule>) => {
                  const nextRules = [...(field.flagRules ?? [])];
                  nextRules[ruleIndex] = { ...nextRules[ruleIndex], ...changes };
                  update(index, { flagRules: nextRules });
                };
                return <div className="station-field-builder-grid station-flag-rule-row" key={`${field.key}-rule-${ruleIndex}`}>
                  <label>
                    <span>When</span>
                    <select disabled={disabled} value={rule.op} onChange={(event) => updateRule({ op: event.target.value as FieldFlagRule['op'], value: FLAG_OP_OPTIONS.find((item) => item.value === event.target.value)?.needsValue ? rule.value ?? '' : undefined })}>
                      {FLAG_OP_OPTIONS.map((op) => <option key={op.value} value={op.value}>{op.label}</option>)}
                    </select>
                  </label>
                  {needsValue && (
                    <label>
                      <span>Value</span>
                      <input
                        disabled={disabled}
                        type={field.type === 'number' ? 'number' : 'text'}
                        value={rule.value === undefined || rule.value === null ? '' : String(rule.value)}
                        onChange={(event) => updateRule({
                          value: field.type === 'number'
                            ? (event.target.value === '' ? '' : event.target.valueAsNumber)
                            : event.target.value,
                        })}
                      />
                    </label>
                  )}
                  <label>
                    <span>Flag</span>
                    <select disabled={disabled} value={rule.flag} onChange={(event) => updateRule({ flag: event.target.value as FieldFlagRule['flag'] })}>
                      <option value="REVIEW">REVIEW</option>
                      <option value="REFER">REFER</option>
                      <option value="URGENT">URGENT</option>
                    </select>
                  </label>
                  <label className="wide">
                    <span>Reason</span>
                    <input required maxLength={200} disabled={disabled} value={rule.reason} onChange={(event) => updateRule({ reason: event.target.value })} />
                  </label>
                  <button
                    type="button"
                    className="icon-button"
                    disabled={disabled}
                    aria-label={`Remove flag rule ${ruleIndex + 1}`}
                    onClick={() => update(index, { flagRules: (field.flagRules ?? []).filter((_, itemIndex) => itemIndex !== ruleIndex) })}
                  >
                    <TrashIcon />
                  </button>
                </div>;
              })}
            </div>
          )}
        </article>;
      })}
    </div>
  </section>;
}
