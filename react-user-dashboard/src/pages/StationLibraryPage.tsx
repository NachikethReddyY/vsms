import { ArrowPathIcon, PencilSquareIcon, PlusIcon, Squares2X2Icon } from '@heroicons/react/24/outline';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { AppDialog } from '../components/AppDialog';
import { AppToast } from '../components/AppToast';
import { emptyField, validateFieldSchema, type DynamicFieldValues, type FieldSchema } from '../features/screening/fieldSchema';
import { StationFieldBuilder, StationFieldRenderer } from '../features/screening/StationFieldRenderer';
import apiClient, { getApiError } from '../utils/apiClient';
import './StationLibraryPage.css';

/** Creatable screening station types. Eye health is clinician-review only. */
export const STATION_TYPE_OPTIONS = [
  { value: 'VISUAL_ACUITY', label: 'Visual acuity' },
  { value: 'REFRACTION', label: 'Refraction' },
  { value: 'COLOUR_VISION', label: 'Colour vision' },
  { value: 'CUSTOM', label: 'Custom' },
] as const;

type StationType = typeof STATION_TYPE_OPTIONS[number]['value'];
type CatalogStationType = StationType | 'EYE_HEALTH';

type StationTemplateRecord = {
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

type CreateDraft = {
  stationType: StationType;
  name: string;
  description: string;
  defaultCapacity: number;
  fieldSchema: FieldSchema;
};

type EditDraft = {
  name: string;
  description: string;
  defaultCapacity: number;
  active: boolean;
  fieldSchema: FieldSchema;
};

const usesEditableFieldSchema = (stationType: CatalogStationType | null | undefined) => stationType === 'CUSTOM';

const emptyCreateDraft = (): CreateDraft => ({
  stationType: 'VISUAL_ACUITY',
  name: '',
  description: '',
  defaultCapacity: 3,
  fieldSchema: [],
});

const toEditDraft = (template: StationTemplateRecord): EditDraft => ({
  name: template.name,
  description: template.description ?? '',
  defaultCapacity: template.defaultCapacity,
  active: template.active,
  fieldSchema: usesEditableFieldSchema(template.stationType) ? (template.fieldSchema ?? [emptyField()]) : [],
});

const labelStationType = (stationType: CatalogStationType | null) => {
  if (stationType === 'EYE_HEALTH') return 'Eye health (review only)';
  return STATION_TYPE_OPTIONS.find((item) => item.value === stationType)?.label ?? 'Legacy catalog only';
};

function sortTemplates(templates: StationTemplateRecord[]) {
  return [...templates].sort((left, right) => {
    if (left.active !== right.active) return left.active ? -1 : 1;
    return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
  });
}

function SchemaPreview({
  fieldSchema,
  values,
  onValuesChange,
  onSchemaChange,
  disabled,
}: {
  fieldSchema: FieldSchema;
  values: DynamicFieldValues;
  onValuesChange: (key: string, value: unknown) => void;
  onSchemaChange: (fieldSchema: FieldSchema) => void;
  disabled?: boolean;
}) {
  return <>
    <StationFieldBuilder fieldSchema={fieldSchema} onChange={onSchemaChange} disabled={disabled} />
    <section className="station-field-preview">
      <h3>Preview</h3>
      {fieldSchema.length
        ? <StationFieldRenderer fieldSchema={fieldSchema} values={values} onChange={onValuesChange} disabled={disabled} />
        : <p className="station-library-schema-note">Add fields above to preview the station form.</p>}
    </section>
  </>;
}

export default function StationLibraryPage() {
  const [templates, setTemplates] = useState<StationTemplateRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dialogMode, setDialogMode] = useState<'create' | 'edit' | null>(null);
  const [editing, setEditing] = useState<StationTemplateRecord | null>(null);
  const [createDraft, setCreateDraft] = useState<CreateDraft>(emptyCreateDraft);
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [previewValues, setPreviewValues] = useState<DynamicFieldValues>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await apiClient.get<StationTemplateRecord[]>('/events/station-templates/library');
      setTemplates(sortTemplates(data));
    } catch (cause) {
      setError(getApiError(cause, 'Station templates could not be loaded.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const openCreate = () => {
    setEditing(null);
    setCreateDraft(emptyCreateDraft());
    setEditDraft(null);
    setFormError('');
    setPreviewValues({});
    setDialogMode('create');
  };

  const openEdit = (template: StationTemplateRecord) => {
    setEditing(template);
    setEditDraft(toEditDraft(template));
    setFormError('');
    setPreviewValues({});
    setDialogMode('edit');
  };

  const closeDialog = (open: boolean) => {
    if (open || saving) return;
    setDialogMode(null);
    setFormError('');
  };

  const submitCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const custom = usesEditableFieldSchema(createDraft.stationType);
    if (custom) {
      if (!createDraft.fieldSchema.length) {
        setFormError('Add at least one form field for this custom station.');
        return;
      }
      const schemaErrors = validateFieldSchema(createDraft.fieldSchema);
      if (schemaErrors.length) {
        setFormError(schemaErrors[0]);
        return;
      }
    }
    setSaving(true);
    setFormError('');
    try {
      const { data } = await apiClient.post<StationTemplateRecord>('/events/station-templates', {
        stationType: createDraft.stationType,
        name: createDraft.name,
        description: createDraft.description || null,
        defaultCapacity: createDraft.defaultCapacity,
        ...(custom ? { fieldSchema: createDraft.fieldSchema } : {}),
      });
      setTemplates((current) => sortTemplates([...current, data]));
      setDialogMode(null);
      setNotice('Station template created.');
    } catch (cause) {
      setFormError(getApiError(cause, 'Station template could not be created.'));
    } finally {
      setSaving(false);
    }
  };

  const submitEdit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editing || !editDraft) return;
    const custom = usesEditableFieldSchema(editing.stationType);
    if (custom) {
      if (!editDraft.fieldSchema.length) {
        setFormError('Add at least one form field for this custom station.');
        return;
      }
      const schemaErrors = validateFieldSchema(editDraft.fieldSchema);
      if (schemaErrors.length) {
        setFormError(schemaErrors[0]);
        return;
      }
    }
    setSaving(true);
    setFormError('');
    try {
      const { data } = await apiClient.patch<StationTemplateRecord>(
        `/events/station-templates/items/${editing.stationTemplateId}`,
        {
          name: editDraft.name,
          description: editDraft.description || null,
          defaultCapacity: editDraft.defaultCapacity,
          active: editDraft.active,
          ...(custom ? { fieldSchema: editDraft.fieldSchema } : {}),
        },
      );
      setTemplates((current) => sortTemplates(current.map((item) => item.stationTemplateId === data.stationTemplateId ? data : item)));
      setDialogMode(null);
      setNotice('Station template updated.');
    } catch (cause) {
      setFormError(getApiError(cause, 'Station template could not be saved.'));
    } finally {
      setSaving(false);
    }
  };

  const activeCount = templates.filter((template) => template.active).length;
  const updatePreviewValue = (key: string, value: unknown) => {
    setPreviewValues((current) => ({ ...current, [key]: value }));
  };

  return <div className="page-frame station-library-page">
    <header className="station-library-header">
      <div>
        <h1>Station library</h1>
        <p>Manage reusable station templates that event managers import into live events. Custom templates define their forms; built-in clinical stations keep fixed screener UIs.</p>
      </div>
      <div className="station-library-actions">
        <span className="station-library-count"><Squares2X2Icon aria-hidden="true" />{activeCount} active / {templates.length} total</span>
        <button className="secondary compact station-library-refresh" type="button" disabled={loading} onClick={() => void load()} aria-label="Refresh station list" title="Refresh station list"><ArrowPathIcon className={loading ? 'is-spinning' : ''} aria-hidden="true" /></button>
        <button className="primary" type="button" onClick={openCreate}><PlusIcon aria-hidden="true" />Add template</button>
      </div>
    </header>

    {error && <div className="alert error" role="alert"><span>{error}</span><button className="secondary compact" type="button" onClick={() => void load()}>Try again</button></div>}

    <section className="station-library-body" aria-label="Station template library">
      {loading ? <div className="station-library-loading" aria-live="polite" aria-label="Loading station templates"><span /><span /><span /><span /></div> : templates.length ? <div className="station-library-grid">{templates.map((template) => <article className="station-library-card" key={template.stationTemplateId}>
        <header><span className="station-library-card-icon"><Squares2X2Icon aria-hidden="true" /></span><span className={`station-library-access ${template.active ? 'active' : 'inactive'}`}><i aria-hidden="true" />{template.active ? 'Active' : 'Inactive'}</span></header>
        <div><p className="station-library-key">{labelStationType(template.stationType)} · v{template.version}</p><h2>{template.name}</h2><p>{template.description || 'No description.'}</p></div>
        <footer><span><strong>{template.defaultCapacity}</strong> capacity · v{template.version}{usesEditableFieldSchema(template.stationType) ? ` · ${template.fieldSchema?.length ?? 0} fields` : ' · fixed clinical form'}</span><button className="secondary compact station-library-edit-button" type="button" onClick={() => openEdit(template)}><PencilSquareIcon aria-hidden="true" />Edit</button></footer>
      </article>)}</div> : <div className="quiet-empty station-library-empty"><Squares2X2Icon aria-hidden="true" /><h2>No station templates yet</h2><p>Default station templates have not been installed. Run the database migrations, then refresh this page.</p></div>}
    </section>

    <AppDialog
      open={dialogMode === 'create'}
      onOpenChange={closeDialog}
      title="Add station template"
      description="Create a reusable screening-station catalog entry."
      dismissible={!saving}
      className="station-library-dialog"
    >
      <form className="app-dialog-form station-library-form" onSubmit={submitCreate} noValidate>
        {formError && <p className="app-dialog-error" role="alert">{formError}</p>}
        <label className="app-dialog-field">
          <span>Station type</span>
          <select required value={createDraft.stationType} onChange={(event) => {
            const stationType = event.target.value as StationType;
            setCreateDraft((current) => ({
              ...current,
              stationType,
              fieldSchema: usesEditableFieldSchema(stationType) ? [emptyField()] : [],
            }));
            setPreviewValues({});
          }}>
            {STATION_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label className="app-dialog-field"><span>Name</span><input required minLength={2} maxLength={100} value={createDraft.name} onChange={(event) => setCreateDraft((current) => ({ ...current, name: event.target.value }))} /></label>
        <label className="app-dialog-field"><span>Description <small>Optional</small></span><textarea maxLength={500} rows={3} value={createDraft.description} onChange={(event) => setCreateDraft((current) => ({ ...current, description: event.target.value }))} /></label>
        <label className="app-dialog-field"><span>Default capacity</span><input required type="number" min={1} max={1000} value={createDraft.defaultCapacity} onChange={(event) => setCreateDraft((current) => ({ ...current, defaultCapacity: Number(event.target.value) }))} /></label>
        {usesEditableFieldSchema(createDraft.stationType) ? (
          <SchemaPreview
            fieldSchema={createDraft.fieldSchema}
            values={previewValues}
            onValuesChange={updatePreviewValue}
            onSchemaChange={(fieldSchema) => { setCreateDraft((current) => ({ ...current, fieldSchema })); setPreviewValues({}); }}
            disabled={saving}
          />
        ) : (
          <p className="station-library-schema-note" role="note">
            Built-in {labelStationType(createDraft.stationType).toLowerCase()} stations use the fixed clinical screener form and rule engine. Only custom stations define editable field schemas.
          </p>
        )}
        <div className="app-dialog-actions"><button className="secondary" type="button" disabled={saving} onClick={() => closeDialog(false)}>Cancel</button><button className="primary" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Create template'}</button></div>
      </form>
    </AppDialog>

    <AppDialog
      open={dialogMode === 'edit' && Boolean(editing && editDraft)}
      onOpenChange={closeDialog}
      title={editing ? `Edit ${editing.name}` : 'Edit station template'}
      description="Update the catalog entry or deactivate it so it no longer appears in event import pickers."
      dismissible={!saving}
      className="station-library-dialog"
    >
      {editDraft && <form className="app-dialog-form station-library-form" onSubmit={submitEdit} noValidate>
        {formError && <p className="app-dialog-error" role="alert">{formError}</p>}
        <label className="app-dialog-field"><span>Station type</span><input disabled value={labelStationType(editing?.stationType ?? null)} /></label>
        <label className="app-dialog-field"><span>Name</span><input required minLength={2} maxLength={100} value={editDraft.name} onChange={(event) => setEditDraft((current) => current ? { ...current, name: event.target.value } : current)} /></label>
        <label className="app-dialog-field"><span>Description <small>Optional</small></span><textarea maxLength={500} rows={3} value={editDraft.description} onChange={(event) => setEditDraft((current) => current ? { ...current, description: event.target.value } : current)} /></label>
        <label className="app-dialog-field"><span>Default capacity</span><input required type="number" min={1} max={1000} value={editDraft.defaultCapacity} onChange={(event) => setEditDraft((current) => current ? { ...current, defaultCapacity: Number(event.target.value) } : current)} /></label>
        {usesEditableFieldSchema(editing?.stationType) ? (
          <SchemaPreview
            fieldSchema={editDraft.fieldSchema}
            values={previewValues}
            onValuesChange={updatePreviewValue}
            onSchemaChange={(fieldSchema) => { setEditDraft((current) => current ? { ...current, fieldSchema } : current); setPreviewValues({}); }}
            disabled={saving}
          />
        ) : (
          <p className="station-library-schema-note" role="note">
            Built-in clinical stations keep their hard-coded screener forms. Field schemas are editable only for custom stations.
          </p>
        )}
        <label className="station-library-active-toggle">
          <input type="checkbox" checked={editDraft.active} onChange={(event) => setEditDraft((current) => current ? { ...current, active: event.target.checked } : current)} />
          <span><strong>{editDraft.active ? 'Active' : 'Inactive'}</strong><small>{editDraft.active ? 'Available for event import pickers.' : 'Hidden from import pickers until reactivated.'}</small></span>
        </label>
        <div className="app-dialog-actions"><button className="secondary" type="button" disabled={saving} onClick={() => closeDialog(false)}>Cancel</button><button className="primary" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button></div>
      </form>}
    </AppDialog>

    <AppToast message={notice} onDismiss={() => setNotice('')} />
  </div>;
}
