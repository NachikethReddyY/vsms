import type { ChangeEvent } from 'react';
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, TrashIcon } from '@heroicons/react/24/outline';
import type { DynamicFieldValues, FieldDefinition, FieldSchema, FieldType } from './fieldSchema';
import { emptyField } from './fieldSchema';
import './StationFieldRenderer.css';

type RendererProps = {
  fieldSchema: FieldSchema;
  values: DynamicFieldValues;
  onChange: (key: string, value: unknown) => void;
  errors?: Record<string, string>;
  disabled?: boolean;
};

const fieldId = (key: string, suffix = '') => `dynamic-field-${key.replace(/[^a-zA-Z0-9_-]/g, '-')}${suffix}`;

export function StationFieldRenderer({ fieldSchema, values, onChange, errors = {}, disabled = false }: RendererProps) {
  return <div className="station-field-renderer">
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
];

export function StationFieldBuilder({ fieldSchema, onChange, disabled = false }: {
  fieldSchema: FieldSchema;
  onChange: (schema: FieldSchema) => void;
  disabled?: boolean;
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

  return <section className="station-field-builder" aria-label="Template fields">
    <header><div><h3>Form fields</h3><p>Configure the data this station records.</p></div><button className="secondary compact" type="button" disabled={disabled || fieldSchema.length >= 40} onClick={() => onChange([...fieldSchema, emptyField(fieldSchema.length)])}><PlusIcon />Add field</button></header>
    <div className="station-field-builder-list">
      {fieldSchema.map((field, index) => <article key={`${field.key}-${index}`}>
        <div className="station-field-builder-heading"><strong>Field {index + 1}</strong><div>
          <button type="button" className="icon-button" disabled={disabled || index === 0} aria-label={`Move ${field.label} up`} onClick={() => move(index, -1)}><ArrowUpIcon /></button>
          <button type="button" className="icon-button" disabled={disabled || index === fieldSchema.length - 1} aria-label={`Move ${field.label} down`} onClick={() => move(index, 1)}><ArrowDownIcon /></button>
          <button type="button" className="icon-button" disabled={disabled} aria-label={`Remove ${field.label}`} onClick={() => onChange(fieldSchema.filter((_, fieldIndex) => fieldIndex !== index))}><TrashIcon /></button>
        </div></div>
        <div className="station-field-builder-grid">
          <label><span>Label</span><input required maxLength={100} disabled={disabled} value={field.label} onChange={(event) => update(index, { label: event.target.value })} /></label>
          <label><span>Key</span><input required pattern="[a-zA-Z][a-zA-Z0-9_]*" maxLength={64} disabled={disabled} value={field.key} onChange={(event) => update(index, { key: event.target.value })} /></label>
          <label><span>Type</span><select disabled={disabled} value={field.type} onChange={(event) => changeType(index, event.target.value as FieldType)}>{FIELD_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}</select></label>
          <label className="station-field-required"><input type="checkbox" disabled={disabled} checked={field.required ?? false} onChange={(event) => update(index, { required: event.target.checked })} /><span>Required</span></label>
          {field.type === 'select' && <label className="wide"><span>Options <small>Comma-separated</small></span><input required disabled={disabled} value={(field.options ?? []).join(', ')} onChange={(event) => changeOptions(index, event)} /></label>}
          {field.type === 'eye-pair' && <label><span>Eyes</span><select disabled={disabled} value={field.eyes ?? 'BOTH'} onChange={(event) => update(index, { eyes: event.target.value as FieldDefinition['eyes'] })}><option value="BOTH">OD and OS</option><option value="OD">OD only</option><option value="OS">OS only</option></select></label>}
          {field.type === 'number' && <><label><span>Minimum</span><input type="number" disabled={disabled} value={field.min ?? ''} onChange={(event) => update(index, { min: event.target.value === '' ? undefined : event.target.valueAsNumber })} /></label><label><span>Maximum</span><input type="number" disabled={disabled} value={field.max ?? ''} onChange={(event) => update(index, { max: event.target.value === '' ? undefined : event.target.valueAsNumber })} /></label></>}
          {(field.type === 'number' || field.type === 'eye-pair') && <label><span>Unit <small>Optional</small></span><input maxLength={20} disabled={disabled} value={field.unit ?? ''} onChange={(event) => update(index, { unit: event.target.value || undefined })} /></label>}
        </div>
      </article>)}
    </div>
  </section>;
}
