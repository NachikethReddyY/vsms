import { ArrowLeftIcon } from '@heroicons/react/24/outline';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AppToast } from '../components/AppToast';
import { defaultValuesForSchema, validateFieldSchema, clinicalLockedKeys, type DynamicFieldValues, type FieldSchema } from '../features/screening/fieldSchema';
import { StationFieldBuilder, StationFieldRenderer } from '../features/screening/StationFieldRenderer';
import apiClient, { getApiError } from '../utils/apiClient';
import {
  blankCustomFieldSchema,
  isHiddenFromStationLibrary,
  labelStationType,
  usesEditableFieldSchema,
  type CatalogStationType,
  type StationTemplateRecord,
} from './stationLibraryShared';
import './StationLibraryPage.css';

type Mode = 'create' | 'edit';

type FormState = {
  name: string;
  description: string;
  defaultCapacity: number;
  active: boolean;
  fieldSchema: FieldSchema;
};

type EditingMeta = {
  stationType: CatalogStationType | null;
  templateKey: string;
  version: number;
};

const blankCreateForm = (): FormState => ({
  name: '',
  description: '',
  defaultCapacity: 3,
  active: true,
  fieldSchema: blankCustomFieldSchema(),
});

const colourVisionExample = (): FormState => ({
  name: 'Colour vision screening',
  description: 'Record Ishihara plate results and flag reduced colour discrimination.',
  defaultCapacity: 10,
  active: true,
  fieldSchema: [
    { key: 'platesPresented', label: 'Plates presented', type: 'number', required: true, min: 1, max: 24 },
    { key: 'platesCorrect', label: 'Plates correct', type: 'number', required: true, min: 0, max: 24, flagRules: [
      { op: 'lte', value: 12, flag: 'REFER', reason: 'Low Ishihara plate score' },
      { op: 'lte', value: 16, flag: 'REVIEW', reason: 'Borderline Ishihara plate score' },
    ] },
    { key: 'notes', label: 'Notes', type: 'text', required: false, flagRules: [
      { op: 'includes', value: 'unable', flag: 'REVIEW', reason: 'Participant was unable to complete the test' },
    ] },
  ],
});

function formFromTemplate(template: StationTemplateRecord): FormState {
  return {
    name: template.name,
    description: template.description ?? '',
    defaultCapacity: template.defaultCapacity,
    active: template.active,
    fieldSchema: template.fieldSchema?.length ? template.fieldSchema : blankCustomFieldSchema(),
  };
}

export default function StationTemplateFormPage({ mode }: { mode: Mode }) {
  const navigate = useNavigate();
  const { stationTemplateId = '' } = useParams();
  const [form, setForm] = useState<FormState>(blankCreateForm);
  const [loading, setLoading] = useState(mode === 'edit');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState('');
  const [previewValues, setPreviewValues] = useState<DynamicFieldValues>(() => defaultValuesForSchema(blankCreateForm().fieldSchema));
  const [editingMeta, setEditingMeta] = useState<EditingMeta | null>(null);

  const fieldsEditable = mode === 'create' || usesEditableFieldSchema(editingMeta?.stationType);
  const lockedFieldKeys = clinicalLockedKeys(editingMeta?.stationType);
  const hiddenCatalog = mode === 'edit' && editingMeta ? isHiddenFromStationLibrary(editingMeta) : false;

  const loadTemplate = useCallback(async () => {
    if (mode !== 'edit' || !stationTemplateId) return;
    setLoading(true);
    setLoadError('');
    try {
      const { data } = await apiClient.get<StationTemplateRecord[]>('/events/station-templates/library');
      const template = data.find((item) => item.stationTemplateId === stationTemplateId);
      if (!template) {
        setLoadError('That station template was not found.');
        return;
      }
      if (isHiddenFromStationLibrary(template)) {
        setEditingMeta({
          stationType: template.stationType,
          templateKey: template.templateKey,
          version: template.version,
        });
        setLoadError('Registration, clinical review, and eye health are not managed in the station library.');
        return;
      }
      setEditingMeta({
        stationType: template.stationType,
        templateKey: template.templateKey,
        version: template.version,
      });
      setForm(formFromTemplate(template));
      setPreviewValues(defaultValuesForSchema(template.fieldSchema?.length ? template.fieldSchema : blankCustomFieldSchema()));
    } catch (cause) {
      setLoadError(getApiError(cause, 'Station template could not be loaded.'));
    } finally {
      setLoading(false);
    }
  }, [mode, stationTemplateId]);

  useEffect(() => { void loadTemplate(); }, [loadTemplate]);

  const updatePreviewValue = (key: string, value: unknown) => {
    setPreviewValues((current) => ({ ...current, [key]: value }));
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (hiddenCatalog) return;
    if (fieldsEditable) {
      if (!form.fieldSchema.length) {
        setError('Add at least one form field for this station.');
        return;
      }
      const schemaErrors = validateFieldSchema(form.fieldSchema, editingMeta?.stationType);
      if (schemaErrors.length) {
        setError(schemaErrors[0]);
        return;
      }
    }
    setSaving(true);
    setError('');
    try {
      if (mode === 'create') {
        await apiClient.post<StationTemplateRecord>('/events/station-templates', {
          stationType: 'CUSTOM',
          name: form.name,
          description: form.description || null,
          defaultCapacity: form.defaultCapacity,
          fieldSchema: form.fieldSchema,
        });
        navigate('/admin/station-templates', { state: { notice: 'Station template created.' } });
        return;
      }
      await apiClient.patch<StationTemplateRecord>(
        `/events/station-templates/items/${stationTemplateId}`,
        {
          name: form.name,
          description: form.description || null,
          defaultCapacity: form.defaultCapacity,
          active: form.active,
          ...(fieldsEditable ? { fieldSchema: form.fieldSchema } : {}),
        },
      );
      navigate('/admin/station-templates', { state: { notice: 'Station template updated.' } });
    } catch (cause) {
      setError(getApiError(cause, mode === 'create' ? 'Station template could not be created.' : 'Station template could not be saved.'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="page-frame station-template-form-page"><div className="center-state" aria-live="polite"><span className="spinner" />Loading template…</div></div>;
  }

  if (mode === 'edit' && loadError) {
    return <div className="page-frame station-template-form-page center-state error-state">
      <h1>{hiddenCatalog ? 'Not in station library' : 'Template unavailable'}</h1>
      <p>{loadError}</p>
      <div className="error-state-actions">
        {!hiddenCatalog && <button className="primary" type="button" onClick={() => void loadTemplate()}>Try again</button>}
        <Link className="secondary" to="/admin/station-templates">Back to library</Link>
      </div>
    </div>;
  }

  return <div className="page-frame station-template-form-page">
    <header className="station-template-form-header">
      <div>
        <Link className="station-template-back" to="/admin/station-templates"><ArrowLeftIcon aria-hidden="true" />Station library</Link>
        <h1>{mode === 'create' ? 'Add station template' : `Edit ${form.name || 'station template'}`}</h1>
        <p>
          {mode === 'create'
            ? 'Create a new custom station with the fields screeners will fill at events.'
            : 'Update the catalog name, capacity, and form fields for this station.'}
        </p>
      </div>
    </header>

    <form className="station-template-form" onSubmit={(event) => void submit(event)} noValidate>
      {error && <p className="form-error" role="alert">{error}</p>}

      <section className="station-template-section" aria-labelledby="station-basics-title">
        <div className="station-template-section-copy">
          <h2 id="station-basics-title">Basics</h2>
          <p>Name and capacity appear in event import pickers and staffing assignment lists.</p>
        </div>
        <div className="station-template-section-body">
          {mode === 'edit' && editingMeta && (
            <label className="station-template-field">
              <span>Station type</span>
              <input disabled value={labelStationType(editingMeta.stationType, editingMeta.templateKey)} />
            </label>
          )}
          <label className="station-template-field">
            <span>Name</span>
            <input
              required
              minLength={2}
              maxLength={100}
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
            />
          </label>
          <label className="station-template-field">
            <span>Description <small>Optional</small></span>
            <textarea
              maxLength={500}
              rows={3}
              value={form.description}
              onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
            />
          </label>
          <label className="station-template-field">
            <span>Default capacity</span>
            <input
              required
              type="number"
              min={1}
              max={1000}
              value={form.defaultCapacity}
              onChange={(event) => setForm((current) => ({ ...current, defaultCapacity: Number(event.target.value) }))}
            />
          </label>
          {mode === 'edit' && (
            <label className="station-library-active-toggle">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(event) => setForm((current) => ({ ...current, active: event.target.checked }))}
              />
              <span>
                <strong>{form.active ? 'Active' : 'Inactive'}</strong>
                <small>{form.active ? 'Available for event import pickers.' : 'Hidden from import pickers until reactivated.'}</small>
              </span>
            </label>
          )}
        </div>
      </section>

      {fieldsEditable && <>
        <section className="station-template-section" aria-labelledby="station-fields-title">
          <div className="station-template-section-copy">
            <h2 id="station-fields-title">Form fields</h2>
            <p>Define the inputs screeners fill at this station. Add flag rules on custom fields so matching values raise REVIEW / REFER / URGENT.</p>
          </div>
          <div className="station-template-section-body">
            {mode === 'create' && <div className="station-template-example"><div><strong>Need test data?</strong><span>Load a complete Colour Vision example with three fields and three flag rules.</span></div><button className="secondary compact" type="button" onClick={() => { const example = colourVisionExample(); setForm(example); setPreviewValues(defaultValuesForSchema(example.fieldSchema)); setError(''); }}>Use example</button></div>}
            <StationFieldBuilder
              fieldSchema={form.fieldSchema}
              lockedKeys={lockedFieldKeys}
              onChange={(fieldSchema) => {
                setForm((current) => ({ ...current, fieldSchema }));
                setPreviewValues(defaultValuesForSchema(fieldSchema));
              }}
              disabled={saving}
            />
          </div>
        </section>

        <section className="station-template-section" aria-labelledby="station-preview-title">
          <div className="station-template-section-copy">
            <h2 id="station-preview-title">Live preview</h2>
            <p>Try the exact controls screeners will use. Values here are only examples and are not saved.</p>
          </div>
          <div className="station-template-section-body">
            <div className="station-field-preview">
              {form.fieldSchema.length
                ? <StationFieldRenderer fieldSchema={form.fieldSchema} values={previewValues} onChange={updatePreviewValue} disabled={saving} />
                : <p className="station-library-schema-note">Add fields above to preview the station form.</p>}
            </div>
          </div>
        </section>
      </>}

      <div className="station-template-form-actions">
        <Link className="secondary" to="/admin/station-templates">Cancel</Link>
        <button className="primary" type="submit" disabled={saving}>
          {saving ? 'Saving…' : mode === 'create' ? 'Create template' : 'Save changes'}
        </button>
      </div>
    </form>

    <AppToast message={notice} onDismiss={() => setNotice('')} />
  </div>;
}
