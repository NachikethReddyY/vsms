import { ArrowPathIcon, PencilSquareIcon, PlusIcon, Squares2X2Icon } from '@heroicons/react/24/outline';
import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AppToast } from '../components/AppToast';
import apiClient, { getApiError } from '../utils/apiClient';
import {
  filterStationLibraryTemplates,
  labelStationType,
  sortTemplates,
  usesEditableFieldSchema,
  type StationTemplateRecord,
} from './stationLibraryShared';
import './StationLibraryPage.css';

export default function StationLibraryPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [templates, setTemplates] = useState<StationTemplateRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (typeof location.state === 'object' && location.state && 'notice' in location.state) {
      setNotice(String((location.state as { notice?: string }).notice || ''));
      navigate(location.pathname, { replace: true, state: null });
    }
  }, [location.state, location.pathname, navigate]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await apiClient.get<StationTemplateRecord[]>('/events/station-templates/library');
      setTemplates(sortTemplates(filterStationLibraryTemplates(data)));
    } catch (cause) {
      setError(getApiError(cause, 'Station templates could not be loaded.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const activeCount = templates.filter((template) => template.active).length;

  return <div className="page-frame station-library-page">
    <header className="station-library-header">
      <div>
        <h1>Station library</h1>
        <p>Manage reusable station templates that event managers import into live events. Open a template to edit details, or add a custom station with its own form fields.</p>
      </div>
      <div className="station-library-actions">
        <span className="station-library-count"><Squares2X2Icon aria-hidden="true" />{activeCount} active / {templates.length} total</span>
        <button className="secondary compact station-library-refresh" type="button" disabled={loading} onClick={() => void load()} aria-label="Refresh station list" title="Refresh station list"><ArrowPathIcon className={loading ? 'is-spinning' : ''} aria-hidden="true" /></button>
        <Link className="primary" to="/admin/station-templates/new"><PlusIcon aria-hidden="true" />Add template</Link>
      </div>
    </header>

    {error && <div className="alert error" role="alert"><span>{error}</span><button className="secondary compact" type="button" onClick={() => void load()}>Try again</button></div>}

    <section className="station-library-body" aria-label="Station template library">
      {loading ? <div className="station-library-loading" aria-live="polite" aria-label="Loading station templates"><span /><span /><span /><span /></div> : templates.length ? <div className="station-library-grid">{templates.map((template) => <article className="station-library-card" key={template.stationTemplateId}>
        <header><span className="station-library-card-icon"><Squares2X2Icon aria-hidden="true" /></span><span className={`station-library-access ${template.active ? 'active' : 'inactive'}`}><i aria-hidden="true" />{template.active ? 'Active' : 'Inactive'}</span></header>
        <div><p className="station-library-key">{labelStationType(template.stationType, template.templateKey)} · v{template.version}</p><h2>{template.name}</h2><p>{template.description || 'No description.'}</p></div>
        <footer>
          <span>
            <strong>{template.defaultCapacity}</strong> capacity · v{template.version}
            {usesEditableFieldSchema(template.stationType)
              ? ` · ${template.fieldSchema?.length ?? 0} fields`
              : null}
          </span>
          <Link className="secondary compact station-library-edit-button" to={`/admin/station-templates/${template.stationTemplateId}/edit`}>
            <PencilSquareIcon aria-hidden="true" />Edit
          </Link>
        </footer>
      </article>)}</div> : <div className="quiet-empty station-library-empty"><Squares2X2Icon aria-hidden="true" /><h2>No station templates yet</h2><p>Default station templates have not been installed. Run the database migrations, then refresh this page — or add a custom template with form fields.</p><Link className="primary" to="/admin/station-templates/new">Add template</Link></div>}
    </section>

    <AppToast message={notice} onDismiss={() => setNotice('')} />
  </div>;
}
