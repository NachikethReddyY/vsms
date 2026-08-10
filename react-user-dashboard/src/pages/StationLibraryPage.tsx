import { ArrowPathIcon, PencilSquareIcon, PlusIcon, Squares2X2Icon } from '@heroicons/react/24/outline';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { AppDialog } from '../components/AppDialog';
import { AppToast } from '../components/AppToast';
import apiClient, { getApiError } from '../utils/apiClient';
import './StationLibraryPage.css';

export const STATION_TYPE_OPTIONS = [
  { value: 'VISUAL_ACUITY', label: 'Visual acuity' },
  { value: 'REFRACTION', label: 'Refraction' },
  { value: 'COLOUR_VISION', label: 'Colour vision' },
  { value: 'EYE_HEALTH', label: 'Eye health' },
] as const;

type StationType = typeof STATION_TYPE_OPTIONS[number]['value'];

type StationTemplateRecord = {
  stationTemplateId: string;
  templateKey: string;
  stationType: StationType | null;
  version: number;
  name: string;
  description?: string | null;
  defaultCapacity: number;
  active: boolean;
};

type CreateDraft = {
  stationType: StationType;
  name: string;
  description: string;
  defaultCapacity: number;
};

type EditDraft = {
  name: string;
  description: string;
  defaultCapacity: number;
  active: boolean;
};

const emptyCreateDraft = (): CreateDraft => ({
  stationType: 'VISUAL_ACUITY',
  name: '',
  description: '',
  defaultCapacity: 3,
});

const toEditDraft = (template: StationTemplateRecord): EditDraft => ({
  name: template.name,
  description: template.description ?? '',
  defaultCapacity: template.defaultCapacity,
  active: template.active,
});

const labelStationType = (stationType: StationType | null) =>
  STATION_TYPE_OPTIONS.find((item) => item.value === stationType)?.label ?? 'Legacy catalog only';

function sortTemplates(templates: StationTemplateRecord[]) {
  return [...templates].sort((left, right) => {
    if (left.active !== right.active) return left.active ? -1 : 1;
    return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
  });
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
    setDialogMode('create');
  };

  const openEdit = (template: StationTemplateRecord) => {
    setEditing(template);
    setEditDraft(toEditDraft(template));
    setFormError('');
    setDialogMode('edit');
  };

  const closeDialog = (open: boolean) => {
    if (open || saving) return;
    setDialogMode(null);
    setFormError('');
  };

  const submitCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setFormError('');
    try {
      const { data } = await apiClient.post<StationTemplateRecord>('/events/station-templates', {
        stationType: createDraft.stationType,
        name: createDraft.name,
        description: createDraft.description || null,
        defaultCapacity: createDraft.defaultCapacity,
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

  return <div className="page-frame station-library-page">
    <header className="station-library-header">
      <div>
        <h1>Station library</h1>
        <p>Manage reusable station templates that event managers import into live events.</p>
      </div>
      <div className="station-library-actions">
        <span className="station-library-count"><Squares2X2Icon aria-hidden="true" />{activeCount} active / {templates.length} total</span>
        <button className="primary" type="button" onClick={openCreate}><PlusIcon aria-hidden="true" />Add template</button>
      </div>
    </header>

    {error && <div className="alert error" role="alert"><span>{error}</span><button className="secondary compact" type="button" onClick={() => void load()}>Try again</button></div>}

    <section className="station-library-body" aria-label="Station template library">
      {loading ? <div className="station-library-loading" aria-live="polite" aria-label="Loading station templates"><span /><span /><span /><span /></div> : templates.length ? <div className="station-library-table-shell">
        <table className="station-library-table">
          <thead><tr><th scope="col">Station type</th><th scope="col">Name</th><th scope="col">Capacity</th><th scope="col">Status</th><th scope="col"><span className="visually-hidden">Actions</span></th></tr></thead>
          <tbody>{templates.map((template) => <tr key={template.stationTemplateId}>
            <th scope="row"><span className="station-library-key">{labelStationType(template.stationType)}<small>v{template.version}</small></span></th>
            <td><span className="station-library-name">{template.name}<small>{template.description || 'No description.'}</small></span></td>
            <td><span className="station-library-capacity">{template.defaultCapacity}</span></td>
            <td><span className={`station-library-access ${template.active ? 'active' : 'inactive'}`}><i aria-hidden="true" />{template.active ? 'Active' : 'Inactive'}</span></td>
            <td><div className="station-library-row-actions"><button className="secondary compact station-library-edit-button" type="button" onClick={() => openEdit(template)}><PencilSquareIcon aria-hidden="true" />Edit</button></div></td>
          </tr>)}</tbody>
        </table>
      </div> : <div className="quiet-empty station-library-empty"><Squares2X2Icon aria-hidden="true" /><h2>No station templates yet</h2><p>Create a template so event managers can import it into screening events.</p><button className="secondary compact" type="button" onClick={openCreate}>Add template</button></div>}
      {!loading && <button className="secondary compact station-library-refresh" type="button" onClick={() => void load()}><ArrowPathIcon aria-hidden="true" />Refresh list</button>}
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
          <select required value={createDraft.stationType} onChange={(event) => setCreateDraft((current) => ({ ...current, stationType: event.target.value as StationType }))}>
            {STATION_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label className="app-dialog-field"><span>Name</span><input required minLength={2} maxLength={100} value={createDraft.name} onChange={(event) => setCreateDraft((current) => ({ ...current, name: event.target.value }))} /></label>
        <label className="app-dialog-field"><span>Description <small>Optional</small></span><textarea maxLength={500} rows={3} value={createDraft.description} onChange={(event) => setCreateDraft((current) => ({ ...current, description: event.target.value }))} /></label>
        <label className="app-dialog-field"><span>Default capacity</span><input required type="number" min={1} max={1000} value={createDraft.defaultCapacity} onChange={(event) => setCreateDraft((current) => ({ ...current, defaultCapacity: Number(event.target.value) }))} /></label>
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
