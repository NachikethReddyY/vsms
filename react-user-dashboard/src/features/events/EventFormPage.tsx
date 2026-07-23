import { ArrowLeftIcon, CheckCircleIcon, PlusIcon, TrashIcon } from '@heroicons/react/24/outline';
import { useEffect, useMemo, useState } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { z } from 'zod';
import { getApiMessage } from '../../auth/authState';
import { eventApi, type CreateEvent, type EventRecord } from './eventApi';

const schema = z.object({
  name: z.string().trim().min(3, 'Use at least 3 characters').max(150),
  description: z.string().trim().max(2000).optional(),
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

type FormValues = z.input<typeof schema>;
const localDate = (iso: string) => new Date(iso).toLocaleString('sv-SE', { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }).slice(0, 16).replace(' ', 'T');

export default function EventFormPage({ mode }: { mode: 'create' | 'edit' }) {
  const { eventId } = useParams();
  const navigate = useNavigate();
  const [existing, setExisting] = useState<EventRecord | null>(null);
  const [loading, setLoading] = useState(mode === 'edit');
  const [formError, setFormError] = useState('');
  const [conflict, setConflict] = useState(false);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const form = useForm<FormValues>({ defaultValues: { name: '', description: '', venue: '', timezone, startsAt: '', endsAt: '', capacity: 100, shifts: [] } });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'shifts' });

  useEffect(() => {
    if (mode !== 'edit' || !eventId) return;
    const controller = new AbortController();
    eventApi.get(eventId, controller.signal).then((event) => {
      setExisting(event);
      form.reset({ name: event.name, description: event.description ?? '', venue: event.venue, timezone: event.timezone, capacity: event.capacity, startsAt: localDate(event.startsAt), endsAt: localDate(event.endsAt), shifts: event.shifts.map((shift) => ({ shiftId: shift.shiftId, name: shift.name, requiredStaff: shift.requiredStaff, startsAt: localDate(shift.startsAt), endsAt: localDate(shift.endsAt) })) });
    }).catch((e) => setFormError(getApiMessage(e, 'Event details could not be loaded.'))).finally(() => setLoading(false));
    return () => controller.abort();
  }, [eventId, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const watched = form.watch();
  const readiness = useMemo(() => [
    { label: 'Event name and venue', ready: !!watched.name?.trim() && !!watched.venue?.trim() },
    { label: 'Schedule and timezone', ready: !!watched.startsAt && !!watched.endsAt && !!watched.timezone },
    { label: 'Capacity set', ready: Number(watched.capacity) > 0 },
  ], [watched]);

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
    <div className="page-frame narrow">
      <Link className="back-link" to={existing ? `/events/${existing.eventId}` : '/events'}><ArrowLeftIcon />Back to {existing ? 'event' : 'events'}</Link>
      <section className="page-heading"><div><p className="eyebrow">{mode === 'create' ? 'New event' : 'Edit event'}</p><h1>{mode === 'create' ? 'Shape the screening day' : existing?.name}</h1><p>Start with the essentials. Keep this as a draft until the team is ready.</p></div></section>
      {formError && <div className="alert error" role="alert"><span><strong>{conflict ? 'Version conflict. ' : ''}</strong>{formError}</span>{conflict && <button onClick={() => window.location.reload()}>Load latest version</button>}</div>}
      <form className="form-layout" onSubmit={form.handleSubmit(submit)} noValidate>
        <div className="form-sections">
          <fieldset><legend><span>1</span><span>Event details<small>How staff will recognize this event.</small></span></legend><div className="form-grid">
            <Field label="Event name" error={form.formState.errors.name?.message}><input {...form.register('name')} aria-invalid={!!form.formState.errors.name} placeholder="Northside community screening" /></Field>
            <Field label="Venue" error={form.formState.errors.venue?.message}><input {...form.register('venue')} aria-invalid={!!form.formState.errors.venue} placeholder="Community hall, Level 2" /></Field>
            <Field wide label="Description" hint="Optional · visible to event staff" error={form.formState.errors.description?.message}><textarea {...form.register('description')} rows={4} aria-invalid={!!form.formState.errors.description} placeholder="Add arrival, access, or setup notes." /></Field>
          </div></fieldset>
          <fieldset><legend><span>2</span><span>Schedule<small>Times are saved with an explicit timezone.</small></span></legend><div className="form-grid">
            <Field label="Starts" error={form.formState.errors.startsAt?.message}><input type="datetime-local" {...form.register('startsAt')} aria-invalid={!!form.formState.errors.startsAt} /></Field>
            <Field label="Ends" error={form.formState.errors.endsAt?.message}><input type="datetime-local" {...form.register('endsAt')} aria-invalid={!!form.formState.errors.endsAt} /></Field>
            <Field wide label="Timezone" error={form.formState.errors.timezone?.message}><input {...form.register('timezone')} aria-invalid={!!form.formState.errors.timezone} /></Field>
          </div></fieldset>
          <fieldset><legend><span>3</span><span>Capacity and shifts<small>Set the operating limit and optional staffing windows.</small></span></legend><div className="form-grid">
            <Field label="Event capacity" hint="Configuration limit only" error={form.formState.errors.capacity?.message?.toString()}><input type="number" min="1" max="100000" {...form.register('capacity')} aria-invalid={!!form.formState.errors.capacity} /></Field><div />
          </div>
          <div className="shift-list">{fields.map((field, index) => <div className="shift-row" key={field.id}><Field label={`Shift ${index + 1} name`} error={form.formState.errors.shifts?.[index]?.name?.message}><input {...form.register(`shifts.${index}.name`)} placeholder="Morning setup" /></Field><Field label="Starts"><input type="datetime-local" {...form.register(`shifts.${index}.startsAt`)} /></Field><Field label="Ends" error={form.formState.errors.shifts?.[index]?.endsAt?.message}><input type="datetime-local" {...form.register(`shifts.${index}.endsAt`)} /></Field><Field label="Staff needed"><input type="number" min="1" {...form.register(`shifts.${index}.requiredStaff`)} /></Field><button type="button" className="icon-button danger" onClick={() => remove(index)} aria-label={`Remove shift ${index + 1}`}><TrashIcon /></button>{field.shiftId && <input type="hidden" {...form.register(`shifts.${index}.shiftId`)} />}</div>)}</div>
          <button type="button" className="secondary" onClick={() => append({ name: '', startsAt: watched.startsAt || '', endsAt: watched.endsAt || '', requiredStaff: 1 })}><PlusIcon />Add shift</button></fieldset>
        </div>
        <aside className="readiness"><p className="eyebrow">Draft readiness</p><h2>{readiness.filter((item) => item.ready).length} of {readiness.length} essentials ready</h2><ul>{readiness.map((item) => <li key={item.label} className={item.ready ? 'ready' : ''}><CheckCircleIcon />{item.label}</li>)}</ul><button className="primary wide" disabled={form.formState.isSubmitting}>{form.formState.isSubmitting ? 'Saving draft…' : mode === 'create' ? 'Save draft' : 'Save changes'}</button><Link className="secondary wide" to={existing ? `/events/${existing.eventId}` : '/events'}>Cancel</Link><small>Publishing remains a separate, confirmed action.</small></aside>
      </form>
    </div>
  );
}

function Field({ label, hint, error, wide, children }: { label: string; hint?: string; error?: string; wide?: boolean; children: React.ReactNode }) {
  return <label className={wide ? 'field wide' : 'field'}><span>{label}{hint && <small>{hint}</small>}</span>{children}{error && <em>{error}</em>}</label>;
}
