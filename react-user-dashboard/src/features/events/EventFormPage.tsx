import { ArrowUpTrayIcon, CheckCircleIcon, CheckIcon, PlusIcon, TrashIcon } from '@heroicons/react/24/outline';
import { Toolbar } from '@astryxdesign/core/Toolbar';
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import Cropper, { type Area } from 'react-easy-crop';
import { useFieldArray, useForm } from 'react-hook-form';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { z } from 'zod';
import { getApiMessage } from '../../auth/authState';
import { eventApi, type CreateEvent, type EventRecord } from './eventApi';
import { EVENT_BANNERS, getEventBanner } from './eventBanners';
import { createCroppedArtwork } from './cropImage';

const schema = z.object({
  name: z.string().trim().min(3, 'Use at least 3 characters').max(150),
  description: z.string().trim().max(2000).optional(),
  bannerKey: z.enum(['COMMUNITY_SCREENING', 'LIBRARY_SCREENING', 'EVENT_OPERATIONS']),
  artworkDataUrl: z.string().max(180000).nullable().optional(),
  venue: z.string().trim().min(2, 'Enter a venue').max(250),
  timezone: z.string().min(1, 'Choose a timezone'),
  startsAt: z.string().min(1, 'Choose a start time'),
  endsAt: z.string().min(1, 'Choose an end time'),
  capacity: z.coerce.number().int().min(1).max(100000),
  shifts: z.array(z.object({ shiftId: z.string().optional(), name: z.string().trim().min(2), startsAt: z.string().min(1), endsAt: z.string().min(1), requiredStaff: z.coerce.number().int().min(1).max(1000) })).max(50),
}).superRefine((value, context) => {
  if (value.startsAt && value.endsAt && new Date(value.endsAt) <= new Date(value.startsAt)) context.addIssue({ code: 'custom', path: ['endsAt'], message: 'End time must be after the start' });
  value.shifts.forEach((shift, i) => {
    if (shift.startsAt && shift.endsAt && new Date(shift.endsAt) <= new Date(shift.startsAt)) context.addIssue({ code: 'custom', path: ['shifts', i, 'endsAt'], message: 'Shift must end after it starts' });
  });
});

type FormValues = Omit<z.input<typeof schema>, 'capacity'> & { capacity: number | '' };
const localDate = (iso: string) => new Date(iso).toLocaleString('sv-SE', { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }).slice(0, 16).replace(' ', 'T');

export default function EventFormPage({ mode }: { mode: 'create' | 'edit' }) {
  const { eventId } = useParams();
  const navigate = useNavigate();
  const [existing, setExisting] = useState<EventRecord | null>(null);
  const [loading, setLoading] = useState(mode === 'edit');
  const [formError, setFormError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [cropSource, setCropSource] = useState('');
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedArea, setCroppedArea] = useState<Area | null>(null);
  const [artworkError, setArtworkError] = useState('');
  const [cropping, setCropping] = useState(false);
  const [artworkChooserOpen, setArtworkChooserOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const form = useForm<FormValues>({ defaultValues: { name: '', description: '', bannerKey: 'COMMUNITY_SCREENING', artworkDataUrl: null, venue: '', timezone, startsAt: '', endsAt: '', capacity: '', shifts: [] } });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'shifts' });

  useEffect(() => {
    if (mode !== 'edit' || !eventId) return;
    const controller = new AbortController();
    eventApi.get(eventId, controller.signal).then((event) => {
      setExisting(event);
      form.reset({ name: event.name, description: event.description ?? '', bannerKey: event.bannerKey, artworkDataUrl: event.artworkDataUrl ?? null, venue: event.venue, timezone: event.timezone, capacity: event.capacity, startsAt: localDate(event.startsAt), endsAt: localDate(event.endsAt), shifts: event.shifts.map((shift) => ({ shiftId: shift.shiftId, name: shift.name, requiredStaff: shift.requiredStaff, startsAt: localDate(shift.startsAt), endsAt: localDate(shift.endsAt) })) });
    }).catch((e) => setFormError(getApiMessage(e, 'Event details could not be loaded.'))).finally(() => setLoading(false));
    return () => controller.abort();
  }, [eventId, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const watched = form.watch();
  const readiness = useMemo(() => [
    { label: 'Event name and venue', ready: !!watched.name?.trim() && !!watched.venue?.trim() },
    { label: 'Schedule and timezone', ready: !!watched.startsAt && !!watched.endsAt && !!watched.timezone },
    { label: 'Venue limit set', ready: watched.capacity !== '' && Number(watched.capacity) > 0 },
  ], [watched]);
  const selectedBanner = getEventBanner(watched.bannerKey);
  const artworkSource = watched.artworkDataUrl || selectedBanner.src;
  const readyCount = readiness.filter((item) => item.ready).length;

  const chooseArtwork = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setArtworkError('Choose a JPEG, PNG, or WebP image.');
      return;
    }
    if (file.size > 12 * 1024 * 1024) {
      setArtworkError('Choose an image smaller than 12 MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setCropSource(String(reader.result)); setCrop({ x: 0, y: 0 }); setZoom(1); setArtworkError(''); setArtworkChooserOpen(false);
    };
    reader.onerror = () => setArtworkError('The selected image could not be read.');
    reader.readAsDataURL(file);
  };

  const confirmCrop = async () => {
    if (!cropSource || !croppedArea) return;
    setCropping(true); setArtworkError('');
    try {
      const artworkDataUrl = await createCroppedArtwork(cropSource, croppedArea);
      form.setValue('artworkDataUrl', artworkDataUrl, { shouldDirty: true });
      setCropSource('');
    } catch (error) { setArtworkError(error instanceof Error ? error.message : 'The crop could not be created.'); }
    finally { setCropping(false); }
  };

  const submit = async (raw: FormValues) => {
    setFormError(''); setConflict(false); form.clearErrors();
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      parsed.error.issues.forEach((issue) => form.setError(issue.path.join('.') as keyof FormValues, { message: issue.message }));
      document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
      return;
    }
    const values = parsed.data;
    const payload: CreateEvent = { ...values, description: values.description || null, startsAt: new Date(values.startsAt).toISOString(), endsAt: new Date(values.endsAt).toISOString(), shifts: values.shifts.map((shift) => ({ ...shift, startsAt: new Date(shift.startsAt).toISOString(), endsAt: new Date(shift.endsAt).toISOString() })) };
    try {
      const event = mode === 'create' ? await eventApi.create(payload) : await eventApi.update(eventId!, { ...payload, version: existing!.version });
      navigate(`/events/${event.eventId}`, { state: { notice: mode === 'create' ? 'Draft event created.' : 'Event details updated.' } });
    } catch (error) {
      const isConflict = (error as { response?: { status?: number } }).response?.status === 409;
      setConflict(isConflict); setFormError(getApiMessage(error, isConflict ? 'This event changed in another session.' : 'The event could not be saved.'));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  if (loading) return <div className="center-state"><span className="spinner" />Loading event details…</div>;
  return (
    <div className="page-frame event-form-page">
      {formError && <div className="alert error" role="alert"><span><strong>{conflict ? 'Version conflict. ' : ''}</strong>{formError}</span>{conflict && <button onClick={() => window.location.reload()}>Load latest version</button>}</div>}
      <form id="event-form" className="event-create-form" onSubmit={form.handleSubmit(submit)} noValidate data-astryx-theme="neutral">
        <Toolbar
          className="event-form-toolbar"
          label="Event form actions"
          size="lg"
          dividers={['bottom']}
          startContent={<div className="event-form-toolbar-title"><strong>{mode === 'create' ? 'Create event' : `Edit ${existing?.name}`}</strong><span>{readyCount} of {readiness.length} essentials ready</span></div>}
          endContent={<div className="event-form-toolbar-actions"><Link className="secondary" to={existing ? `/events/${existing.eventId}` : '/events'}>Cancel</Link><button className="primary" type="submit" disabled={form.formState.isSubmitting}>{form.formState.isSubmitting ? 'Saving draft…' : mode === 'create' ? 'Save draft' : 'Save changes'}</button></div>}
        />

        <div className="event-compose-layout">
        <section className="event-artwork-section" aria-labelledby="event-artwork-title">
          <div className="event-artwork-heading"><div><span className="section-number">1</span><div><h2 id="event-artwork-title">Event artwork</h2><p>Choose the image staff will see in the event list and record.</p></div></div><strong>{selectedBanner.label}</strong></div>
          {cropSource ? <div className="artwork-crop-editor">
            <div className="artwork-crop-stage"><Cropper image={cropSource} crop={crop} zoom={zoom} aspect={1} cropShape="rect" showGrid onCropChange={setCrop} onZoomChange={setZoom} onCropComplete={(_, pixels) => setCroppedArea(pixels)} /></div>
            <label className="artwork-zoom"><span>Zoom</span><input type="range" min="1" max="3" step="0.05" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} /></label>
            <div className="artwork-crop-actions"><button className="secondary" type="button" onClick={() => setCropSource('')} disabled={cropping}>Cancel</button><button className="primary" type="button" onClick={() => void confirmCrop()} disabled={cropping}>{cropping ? 'Preparing…' : 'Use crop'}</button></div>
          </div> : <figure className="create-event-banner"><img src={artworkSource} alt="" /><figcaption><span>{watched.artworkDataUrl ? 'Custom artwork' : selectedBanner.label}</span><button className="artwork-change-button" type="button" aria-expanded={artworkChooserOpen} aria-controls="event-artwork-chooser" onClick={() => setArtworkChooserOpen((open) => !open)}><ArrowUpTrayIcon />Choose artwork</button></figcaption></figure>}
          <input ref={fileInput} className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" onChange={chooseArtwork} />
          {artworkError && <p className="field-error" role="alert">{artworkError}</p>}
          {artworkChooserOpen && <div className="artwork-chooser" id="event-artwork-chooser"><div className="create-banner-options" role="radiogroup" aria-label="Available event artwork">
            {EVENT_BANNERS.map((option) => <button className={`create-banner-option ${!watched.artworkDataUrl && watched.bannerKey === option.key ? 'selected' : ''}`} type="button" role="radio" aria-label={`${option.label}. ${option.description}`} aria-checked={!watched.artworkDataUrl && watched.bannerKey === option.key} key={option.key} onClick={() => { form.setValue('bannerKey', option.key, { shouldDirty: true }); form.setValue('artworkDataUrl', null, { shouldDirty: true }); setArtworkChooserOpen(false); }}>
              <img src={option.src} alt="" /><span><strong>{option.label}</strong><small>{option.description}</small></span>{!watched.artworkDataUrl && watched.bannerKey === option.key && <i><CheckIcon /></i>}
            </button>)}
            <button className={`create-banner-option upload-option ${watched.artworkDataUrl ? 'selected' : ''}`} type="button" aria-label="Upload your image. JPEG, PNG, or WebP up to 12 MB" onClick={() => fileInput.current?.click()}><span className="upload-option-icon"><ArrowUpTrayIcon /></span><span><strong>Upload your image</strong><small>JPEG, PNG, or WebP up to 12 MB</small></span>{watched.artworkDataUrl && <i><CheckIcon /></i>}</button>
          </div></div>}
        </section>

        <div className="form-sections">
          <fieldset><legend><span>2</span><span>Event details<small>How staff will recognize this event.</small></span></legend><div className="form-grid">
            <Field label="Event name" error={form.formState.errors.name?.message}><input {...form.register('name')} aria-invalid={!!form.formState.errors.name} placeholder="Northside community screening" /></Field>
            <Field label="Venue" error={form.formState.errors.venue?.message}><input {...form.register('venue')} aria-invalid={!!form.formState.errors.venue} placeholder="Community hall, Level 2" /></Field>
            <Field wide label="Description" hint="Optional · visible to event staff" error={form.formState.errors.description?.message}><textarea {...form.register('description')} rows={4} aria-invalid={!!form.formState.errors.description} placeholder="Add arrival, access, or setup notes." /></Field>
          </div></fieldset>
          <fieldset><legend><span>3</span><span>Schedule<small>Set one clear operating window for the event.</small></span></legend><div className="form-grid schedule-grid">
            <Field label="Starts" error={form.formState.errors.startsAt?.message}><input type="datetime-local" {...form.register('startsAt')} aria-invalid={!!form.formState.errors.startsAt} /></Field>
            <Field label="Ends" error={form.formState.errors.endsAt?.message}><input type="datetime-local" min={watched.startsAt || undefined} {...form.register('endsAt')} aria-invalid={!!form.formState.errors.endsAt} /></Field>
            <Field wide label="Timezone" hint="Used for event and shift times" error={form.formState.errors.timezone?.message}><input {...form.register('timezone')} aria-invalid={!!form.formState.errors.timezone} /></Field>
          </div></fieldset>
          <fieldset><legend><span>4</span><span>Venue limit<small>The maximum number of people allowed at the venue at one time.</small></span></legend><div className="form-grid">
            <Field label="People allowed" hint="Live occupancy is calculated from incomplete signups" error={form.formState.errors.capacity?.message?.toString()}><input type="number" min="1" max="100000" placeholder="100" {...form.register('capacity')} aria-invalid={!!form.formState.errors.capacity} /></Field>
          </div></fieldset>
          <fieldset><legend><span>5</span><span>Shifts<small>Add staffing windows only when this event needs them.</small></span></legend>
          <div className="shift-list">{fields.map((field, index) => <article className="shift-editor" key={field.id}>
            <header className="shift-editor-heading"><div><span>Shift {index + 1}</span><strong>{watched.shifts?.[index]?.name?.trim() || 'Untitled shift'}</strong></div><button type="button" className="icon-button danger" onClick={() => remove(index)} aria-label={`Remove shift ${index + 1}`}><TrashIcon /></button></header>
            <div className="shift-editor-grid">
            <Field wide label="Shift name" error={form.formState.errors.shifts?.[index]?.name?.message}><input {...form.register(`shifts.${index}.name`)} placeholder="Morning setup" /></Field>
            <Field label="Starts" error={form.formState.errors.shifts?.[index]?.startsAt?.message}><input type="datetime-local" min={watched.startsAt || undefined} max={watched.endsAt || undefined} {...form.register(`shifts.${index}.startsAt`)} /></Field>
            <Field label="Ends" error={form.formState.errors.shifts?.[index]?.endsAt?.message}><input type="datetime-local" min={watched.shifts?.[index]?.startsAt || watched.startsAt || undefined} max={watched.endsAt || undefined} {...form.register(`shifts.${index}.endsAt`)} /></Field>
            <Field wide label="Team size" hint="Number of people needed for this shift"><input type="number" min="1" {...form.register(`shifts.${index}.requiredStaff`)} /></Field>
            {field.shiftId && <input type="hidden" {...form.register(`shifts.${index}.shiftId`)} />}
            </div>
          </article>)}</div>
          {fields.length === 0 && <p className="shift-editor-empty">No shifts yet. Add one when separate staffing coverage is needed.</p>}
          <button type="button" className="secondary shift-add" onClick={() => append({ name: '', startsAt: watched.startsAt || '', endsAt: watched.endsAt || '', requiredStaff: 1 })}><PlusIcon />Add shift</button></fieldset>
        </div>
        </div>
        <section className="event-readiness" aria-labelledby="readiness-title"><div><p className="eyebrow">Draft readiness</p><h2 id="readiness-title">{readyCount} of {readiness.length} essentials ready</h2><p>Publishing remains a separate, confirmed action.</p></div><ul>{readiness.map((item) => <li key={item.label} className={item.ready ? 'ready' : ''}><CheckCircleIcon />{item.label}</li>)}</ul></section>
      </form>
    </div>
  );
}

function Field({ label, hint, error, wide, children }: { label: string; hint?: string; error?: string; wide?: boolean; children: React.ReactNode }) {
  return <label className={wide ? 'field wide' : 'field'}><span>{label}{hint && <small>{hint}</small>}</span>{children}{error && <em>{error}</em>}</label>;
}
