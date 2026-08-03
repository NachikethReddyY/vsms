import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpTrayIcon,
  CheckCircleIcon,
  CheckIcon,
  ClockIcon,
  MapPinIcon,
  PlusIcon,
  TrashIcon,
  UsersIcon,
} from '@heroicons/react/24/outline';
import { Avatar } from '@astryxdesign/core/Avatar';
import type { DateRange } from '@astryxdesign/core/DateRangeInput';
import { MultiSelector } from '@astryxdesign/core/MultiSelector';
import type { ISOTimeString } from '@astryxdesign/core/TimeInput';
import { Toolbar } from '@astryxdesign/core/Toolbar';
import { Typeahead } from '@astryxdesign/core/Typeahead';
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import Cropper, { type Area } from 'react-easy-crop';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import { getApiError as getApiMessage } from '../../utils/apiClient';
import { getDisplayName } from '../../utils/identity';
import {
  eventApi,
  type CreateEvent,
  type EventRecord,
  type LocationResult,
  type StaffAssignmentRole,
  type StaffDirectoryEntry,
  type StationTemplate,
} from './eventApi';
import { EVENT_BANNERS, getEventBanner } from './eventBanners';
import { createCroppedArtwork } from './cropImage';

type TimeValue = ISOTimeString;
type DayForm = { eventDayId?: string; date: string; startsAt: TimeValue; endsAt: TimeValue };
type AvailabilityForm = { date: string; isAvailable: boolean; startsAt: TimeValue; endsAt: TimeValue; capacity: number };
type StationForm = {
  eventStationId?: string;
  stationTemplateId: string;
  stationOrder: number;
  capacity: number;
  isAvailable: boolean;
  availabilities: AvailabilityForm[];
};
type AssignmentForm = {
  staffAssignmentId?: string;
  userId: string;
  assignmentRole: StaffAssignmentRole;
  stationTemplateId: string | null;
  notes: string;
};
type ShiftForm = {
  shiftId?: string;
  name: string;
  date: string;
  startsAt: TimeValue;
  endsAt: TimeValue;
  requiredStaff: number;
  assignments: AssignmentForm[];
};
type FormValues = {
  name: string;
  description: string;
  bannerKey: 'COMMUNITY_SCREENING' | 'LIBRARY_SCREENING' | 'EVENT_OPERATIONS';
  artworkDataUrl: string | null;
  venue: string;
  address: string;
  postalCode: string;
  latitude: number | null;
  longitude: number | null;
  locationProvider: 'ONEMAP' | 'MANUAL';
  locationReference: string;
  timezone: 'Asia/Singapore';
  capacity: number | '';
  expectedAttendance: number | '';
  eventDays: DayForm[];
  stations: StationForm[];
  shifts: ShiftForm[];
};
type LocationItem = { id: string; label: string; auxiliaryData: LocationResult };

const ROLES: StaffAssignmentRole[] = ['EVENT_MANAGER', 'REGISTRATION', 'SCREENER', 'REVIEWER', 'SUPPORT'];
const roleLabel = (role: StaffAssignmentRole) => role.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (letter: string) => letter.toUpperCase());
const asTime = (value: string) => value.slice(0, 5) as TimeValue;
const timePattern = /^\d{2}:\d{2}$/;
const formSchema = z.object({
  name: z.string().trim().min(3, 'Use at least 3 characters').max(150),
  description: z.string().trim().max(5000),
  venue: z.string().trim().min(2, 'Enter a venue name').max(255),
  address: z.string().trim().max(500),
  postalCode: z.string().refine((value) => !value || /^\d{6}$/.test(value), 'Use a 6-digit Singapore postal code'),
  capacity: z.coerce.number().int().min(1, 'Enter concurrent venue capacity').max(100000),
  expectedAttendance: z.coerce.number().int().min(1, 'Enter expected total attendance').max(1000000),
  eventDays: z.array(z.object({
    date: z.string(),
    startsAt: z.string().regex(timePattern),
    endsAt: z.string().regex(timePattern),
  })).min(1, 'Choose event dates').max(31),
  stations: z.array(z.object({
    stationTemplateId: z.string().uuid(),
    availabilities: z.array(z.object({
      date: z.string(),
      isAvailable: z.boolean(),
      startsAt: z.string(),
      endsAt: z.string(),
      capacity: z.coerce.number().int().min(1).max(100000),
    })),
  })).max(50),
  shifts: z.array(z.object({
    name: z.string().trim().min(2),
    date: z.string().min(1),
    startsAt: z.string().regex(timePattern),
    endsAt: z.string().regex(timePattern),
    requiredStaff: z.coerce.number().int().min(1).max(1000),
    assignments: z.array(z.object({
      userId: z.string().uuid(),
      assignmentRole: z.enum(['EVENT_MANAGER', 'REGISTRATION', 'SCREENER', 'REVIEWER', 'SUPPORT']),
      stationTemplateId: z.string().uuid().nullable(),
      notes: z.string().trim().max(500),
    })).max(100),
  })).max(50),
}).superRefine((value, context) => {
  value.eventDays.forEach((day, index) => {
    if (day.endsAt <= day.startsAt) context.addIssue({ code: 'custom', path: ['eventDays', index, 'endsAt'], message: 'Closing time must be after opening time' });
  });
  value.stations.forEach((station, stationIndex) => station.availabilities.forEach((availability, dayIndex) => {
    if (availability.isAvailable && availability.endsAt <= availability.startsAt) {
      context.addIssue({ code: 'custom', path: ['stations', stationIndex, 'availabilities', dayIndex, 'endsAt'], message: 'Closing time must be after opening time' });
    }
  }));
  value.shifts.forEach((shift, index) => {
    if (shift.endsAt <= shift.startsAt) context.addIssue({ code: 'custom', path: ['shifts', index, 'endsAt'], message: 'Shift must end after it starts' });
    if (!value.eventDays.some((day) => day.date === shift.date)) context.addIssue({ code: 'custom', path: ['shifts', index, 'date'], message: 'Shift date must be part of the event' });
    shift.assignments.forEach((assignment, assignmentIndex) => {
      if (assignment.assignmentRole === 'SCREENER' && !assignment.stationTemplateId) {
        context.addIssue({ code: 'custom', path: ['shifts', index, 'assignments', assignmentIndex, 'stationTemplateId'], message: 'Choose a station for screeners' });
      }
    });
  });
});

const blankValues = (): FormValues => ({
  name: '',
  description: '',
  bannerKey: 'COMMUNITY_SCREENING',
  artworkDataUrl: null,
  venue: '',
  address: '',
  postalCode: '',
  latitude: null,
  longitude: null,
  locationProvider: 'MANUAL',
  locationReference: '',
  timezone: 'Asia/Singapore',
  capacity: '',
  expectedAttendance: '',
  eventDays: [],
  stations: [],
  shifts: [],
});

const localParts = (iso: string) => {
  const value = new Date(iso).toLocaleString('sv-SE', {
    timeZone: 'Asia/Singapore',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const [date, time] = value.split(' ');
  return { date, time: asTime(time) };
};
const toInstant = (date: string, time: string) => new Date(`${date}T${time}:00+08:00`).toISOString();
const countDays = (range: DateRange) => Math.round((Date.parse(`${range.end}T00:00:00Z`) - Date.parse(`${range.start}T00:00:00Z`)) / 86400000) + 1;
const expandRange = (range: DateRange) => Array.from({ length: countDays(range) }, (_, index) => {
  const date = new Date(`${range.start}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + index);
  return date.toISOString().slice(0, 10);
});

const valuesFromEvent = (event: EventRecord, keepIds: boolean): FormValues => {
  const eventDays = event.eventDays.length > 0
    ? event.eventDays.map((day) => ({ ...(keepIds ? { eventDayId: day.eventDayId } : {}), date: day.date.slice(0, 10), startsAt: localParts(day.startsAt).time, endsAt: localParts(day.endsAt).time }))
    : [{ date: localParts(event.startsAt).date, startsAt: localParts(event.startsAt).time, endsAt: localParts(event.endsAt).time }];
  return {
    name: event.name,
    description: event.description ?? '',
    bannerKey: event.bannerKey ?? 'COMMUNITY_SCREENING',
    artworkDataUrl: event.artworkDataUrl ?? null,
    venue: event.venue,
    address: event.address ?? '',
    postalCode: event.postalCode ?? '',
    latitude: event.latitude ?? null,
    longitude: event.longitude ?? null,
    locationProvider: event.locationProvider === 'ONEMAP' ? 'ONEMAP' : 'MANUAL',
    locationReference: event.locationReference ?? '',
    timezone: 'Asia/Singapore',
    capacity: event.capacity,
    expectedAttendance: event.expectedAttendance ?? event.capacity,
    eventDays,
    stations: event.eventStations.map((station, index) => ({
      ...(keepIds ? { eventStationId: station.eventStationId } : {}),
      stationTemplateId: station.stationTemplateId,
      stationOrder: index + 1,
      capacity: station.capacity,
      isAvailable: station.isAvailable,
      availabilities: eventDays.map((day) => {
        const saved = station.availabilities.find((entry) => entry.eventDay.date.slice(0, 10) === day.date);
        return {
          date: day.date,
          isAvailable: saved?.isAvailable ?? station.isAvailable,
          startsAt: saved?.startsAt ? localParts(saved.startsAt).time : day.startsAt,
          endsAt: saved?.endsAt ? localParts(saved.endsAt).time : day.endsAt,
          capacity: saved?.capacity ?? station.capacity,
        };
      }),
    })),
    shifts: event.shifts.map((shift) => {
      const start = localParts(shift.startsAt);
      return {
        ...(keepIds ? { shiftId: shift.shiftId } : {}),
        name: shift.name,
        date: start.date,
        startsAt: start.time,
        endsAt: localParts(shift.endsAt).time,
        requiredStaff: shift.requiredStaff,
        assignments: shift.staffAssignments.map((assignment) => ({
          ...(keepIds ? { staffAssignmentId: assignment.staffAssignmentId } : {}),
          userId: assignment.user.userId,
          assignmentRole: assignment.assignmentRole,
          stationTemplateId: assignment.eventStation?.stationTemplateId ?? null,
          notes: assignment.notes ?? '',
        })),
      };
    }),
  };
};

export default function EventFormPage({ mode }: { mode: 'create' | 'edit' }) {
  const { eventId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const step = Math.min(3, Math.max(1, Number(searchParams.get('step')) || 1));
  const duplicateFrom = mode === 'create' ? (location.state as { duplicateFrom?: EventRecord } | null)?.duplicateFrom : undefined;
  const isDuplicate = Boolean(duplicateFrom);
  const [existing, setExisting] = useState<EventRecord | null>(null);
  const [values, setValues] = useState<FormValues>(blankValues);
  const [dateRange, setDateRange] = useState<DateRange | null>(null);
  const [activeDay, setActiveDay] = useState('');
  const [templates, setTemplates] = useState<StationTemplate[]>([]);
  const [staff, setStaff] = useState<StaffDirectoryEntry[]>([]);
  const [loading, setLoading] = useState(mode === 'edit');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [conflict, setConflict] = useState(false);
  const [selectedLocation, setSelectedLocation] = useState<LocationItem | null>(null);
  const [locationSearchError, setLocationSearchError] = useState('');
  const [cropSource, setCropSource] = useState('');
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedArea, setCroppedArea] = useState<Area | null>(null);
  const [artworkError, setArtworkError] = useState('');
  const [cropping, setCropping] = useState(false);
  const [artworkChooserOpen, setArtworkChooserOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const createIdempotencyKey = useRef(crypto.randomUUID());

  const hydrate = (event: EventRecord, keepIds: boolean) => {
    const hydrated = valuesFromEvent(event, keepIds);
    setValues(hydrated);
    const start = hydrated.eventDays[0]?.date;
    const end = hydrated.eventDays[hydrated.eventDays.length - 1]?.date;
    setDateRange(start && end ? { start, end } as DateRange : null);
    setActiveDay(start || '');
    if (hydrated.locationProvider === 'ONEMAP' && hydrated.latitude != null && hydrated.longitude != null) {
      const result: LocationResult = {
        id: hydrated.locationReference || `${hydrated.postalCode}:${hydrated.latitude}:${hydrated.longitude}`,
        label: hydrated.venue,
        address: hydrated.address,
        postalCode: hydrated.postalCode || null,
        latitude: hydrated.latitude,
        longitude: hydrated.longitude,
        provider: 'ONEMAP',
        timezone: 'Asia/Singapore',
      };
      setSelectedLocation({ id: result.id, label: result.label, auxiliaryData: result });
    }
  };

  useEffect(() => {
    Promise.all([eventApi.stationTemplates(), eventApi.staffDirectory()])
      .then(([stationTemplates, directory]) => {
        setTemplates(stationTemplates);
        setStaff(directory);
      })
      .catch((error) => setFormError(getApiMessage(error, 'Planning resources could not be loaded.')));
  }, []);

  useEffect(() => {
    if (duplicateFrom) {
      hydrate(duplicateFrom, false);
      return;
    }
    if (mode !== 'edit' || !eventId) return;
    const controller = new AbortController();
    eventApi.get(eventId, controller.signal).then((event) => {
      if (!event.canManage || event.status === 'COMPLETED' || event.status === 'CANCELLED') {
        navigate(`/events/${event.eventId}`, { replace: true, state: { notice: event.canManage ? 'Finished events are read-only. Duplicate this event to make changes.' : 'You do not have permission to edit this event.' } });
        return;
      }
      setExisting(event);
      hydrate(event, true);
    }).catch((error) => {
      if (!controller.signal.aborted) setFormError(getApiMessage(error, 'Event details could not be loaded.'));
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [duplicateFrom, eventId, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const locationSource = useMemo(() => {
    let controller: AbortController | null = null;
    return {
      cancel() { controller?.abort(); },
      bootstrap: () => [] as LocationItem[],
      async search(query: string) {
        if (query.trim().length < 3) return [];
        controller?.abort();
        controller = new AbortController();
        try {
          const results = await eventApi.searchLocations(query.trim(), controller.signal);
          setLocationSearchError('');
          return results.map((result) => ({ id: result.id, label: result.label, auxiliaryData: result }));
        } catch (error) {
          if ((error as { code?: string }).code === 'ERR_CANCELED') return [];
          setLocationSearchError(getApiMessage(error, 'OneMap search is unavailable. Enter the address manually.'));
          throw error;
        }
      },
    };
  }, []);

  const selectedBanner = getEventBanner(values.bannerKey);
  const artworkSource = values.artworkDataUrl || selectedBanner.src;
  const selectedTemplateIds = values.stations.map((station) => station.stationTemplateId);
  const activeDayIndex = Math.max(0, values.eventDays.findIndex((day) => day.date === activeDay));
  const activeDayRecord = values.eventDays[activeDayIndex];
  const concurrentAssigned = values.shifts.reduce((total, shift) => total + shift.assignments.length, 0);
  const requiredHeadcount = values.shifts.reduce((total, shift) => total + Number(shift.requiredStaff || 0), 0);
  const readiness = [
    { label: 'Event and Singapore location', ready: values.name.trim().length >= 3 && values.venue.trim().length >= 2 },
    { label: 'Date range and daily hours', ready: values.eventDays.length > 0 },
    { label: 'Attendance and occupancy', ready: Number(values.capacity) > 0 && Number(values.expectedAttendance) > 0 },
    { label: 'Stations configured', ready: values.stations.length > 0 },
    { label: 'Staffing reviewed', ready: values.shifts.length === 0 || concurrentAssigned >= requiredHeadcount },
  ];
  const readyCount = readiness.filter((item) => item.ready).length;

  const setStep = (next: number) => {
    setSearchParams(next === 1 ? {} : { step: String(next) });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const setRange = (range: DateRange | null) => {
    setFieldErrors((current) => ({ ...current, eventDays: '' }));
    if (range && countDays(range) > 31) {
      setFieldErrors((current) => ({ ...current, eventDays: 'Choose 31 days or fewer' }));
      return;
    }
    setDateRange(range);
    const dates = range ? expandRange(range) : [];
    setValues((current) => {
      const eventDays: DayForm[] = dates.map((date) => current.eventDays.find((day) => day.date === date) || { date, startsAt: asTime('09:00'), endsAt: asTime('17:00') });
      const stations = current.stations.map((station) => ({
        ...station,
        availabilities: dates.map((date) => station.availabilities.find((entry) => entry.date === date) || {
          date,
          isAvailable: true,
          startsAt: eventDays.find((day) => day.date === date)?.startsAt || asTime('09:00'),
          endsAt: eventDays.find((day) => day.date === date)?.endsAt || asTime('17:00'),
          capacity: station.capacity,
        }),
      }));
      const shifts = current.shifts.filter((shift) => dates.includes(shift.date));
      return { ...current, eventDays, stations, shifts };
    });
    setActiveDay(dates[0] || '');
  };

  const updateDay = (index: number, patch: Partial<DayForm>) => {
    setValues((current) => ({
      ...current,
      eventDays: current.eventDays.map((day, dayIndex) => dayIndex === index ? { ...day, ...patch } : day),
    }));
  };

  const applyDayHoursToAll = (index: number) => {
    const source = values.eventDays[index];
    if (!source) return;
    setValues((current) => ({
      ...current,
      eventDays: current.eventDays.map((day) => ({ ...day, startsAt: source.startsAt, endsAt: source.endsAt })),
    }));
  };

  const selectTemplates = (ids: string[]) => {
    setValues((current) => {
      const stations = ids.map((stationTemplateId, index) => {
        const saved = current.stations.find((station) => station.stationTemplateId === stationTemplateId);
        if (saved) return { ...saved, stationOrder: index + 1 };
        const template = templates.find((candidate) => candidate.stationTemplateId === stationTemplateId)!;
        return {
          stationTemplateId,
          stationOrder: index + 1,
          capacity: template.defaultCapacity,
          isAvailable: true,
          availabilities: current.eventDays.map((day) => ({
            date: day.date,
            isAvailable: true,
            startsAt: day.startsAt,
            endsAt: day.endsAt,
            capacity: template.defaultCapacity,
          })),
        };
      });
      const selected = new Set(ids);
      const shifts = current.shifts.map((shift) => ({
        ...shift,
        assignments: shift.assignments.map((assignment) => selected.has(assignment.stationTemplateId || '') ? assignment : { ...assignment, stationTemplateId: null }),
      }));
      return { ...current, stations, shifts };
    });
  };

  const updateStationAvailability = (stationIndex: number, dayIndex: number, patch: Partial<AvailabilityForm>) => {
    setValues((current) => ({
      ...current,
      stations: current.stations.map((station, index) => index === stationIndex ? {
        ...station,
        availabilities: station.availabilities.map((entry, entryIndex) => entryIndex === dayIndex ? { ...entry, ...patch } : entry),
      } : station),
    }));
  };

  const applyStationDayToAll = (stationIndex: number, dayIndex: number) => {
    const source = values.stations[stationIndex]?.availabilities[dayIndex];
    if (!source) return;
    setValues((current) => ({
      ...current,
      stations: current.stations.map((station, index) => index === stationIndex ? {
        ...station,
        availabilities: station.availabilities.map((entry) => ({ ...entry, isAvailable: source.isAvailable, startsAt: source.startsAt, endsAt: source.endsAt, capacity: source.capacity })),
      } : station),
    }));
  };

  const addShift = () => {
    const day = values.eventDays[0];
    if (!day) {
      setStep(1);
      setFieldErrors((current) => ({ ...current, eventDays: 'Choose event dates before adding shifts' }));
      return;
    }
    setValues((current) => ({
      ...current,
      shifts: [...current.shifts, { name: '', date: day.date, startsAt: day.startsAt, endsAt: day.endsAt, requiredStaff: 1, assignments: [] }],
    }));
  };

  const updateShift = (index: number, patch: Partial<ShiftForm>) => setValues((current) => ({
    ...current,
    shifts: current.shifts.map((shift, shiftIndex) => shiftIndex === index ? { ...shift, ...patch } : shift),
  }));

  const addAssignment = (shiftIndex: number, userId: string) => {
    if (!userId || values.shifts[shiftIndex].assignments.some((assignment) => assignment.userId === userId)) return;
    const firstStation = values.stations[0]?.stationTemplateId ?? null;
    updateShift(shiftIndex, {
      assignments: [...values.shifts[shiftIndex].assignments, {
        userId,
        assignmentRole: firstStation ? 'SCREENER' : 'SUPPORT',
        stationTemplateId: firstStation,
        notes: '',
      }],
    });
  };

  const updateAssignment = (shiftIndex: number, assignmentIndex: number, patch: Partial<AssignmentForm>) => {
    const assignments = values.shifts[shiftIndex].assignments.map((assignment, index) => index === assignmentIndex ? { ...assignment, ...patch } : assignment);
    updateShift(shiftIndex, { assignments });
  };

  const chooseArtwork = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return setArtworkError('Choose a JPEG, PNG, or WebP image.');
    if (file.size > 12 * 1024 * 1024) return setArtworkError('Choose an image smaller than 12 MB.');
    const reader = new FileReader();
    reader.onload = () => {
      setCropSource(String(reader.result));
      setCrop({ x: 0, y: 0 });
      setZoom(1);
      setArtworkError('');
      setArtworkChooserOpen(false);
    };
    reader.onerror = () => setArtworkError('The selected image could not be read.');
    reader.readAsDataURL(file);
  };

  const confirmCrop = async () => {
    if (!cropSource || !croppedArea) return;
    setCropping(true);
    try {
      const artworkDataUrl = await createCroppedArtwork(cropSource, croppedArea);
      setValues((current) => ({ ...current, artworkDataUrl }));
      setCropSource('');
    } catch (error) {
      setArtworkError(error instanceof Error ? error.message : 'The crop could not be created.');
    } finally {
      setCropping(false);
    }
  };

  const validateStepOne = () => {
    const errors: Record<string, string> = {};
    if (values.name.trim().length < 3) errors.name = 'Use at least 3 characters';
    if (values.venue.trim().length < 2) errors.venue = 'Enter a venue name';
    if (values.eventDays.length === 0) errors.eventDays = 'Choose event dates';
    if (Number(values.capacity) < 1) errors.capacity = 'Enter concurrent venue capacity';
    if (Number(values.expectedAttendance) < 1) errors.expectedAttendance = 'Enter expected total attendance';
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const nextStep = () => {
    if (step === 1 && !validateStepOne()) return;
    setStep(Math.min(3, step + 1));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (step < 3) return nextStep();
    setFormError('');
    setConflict(false);
    const parsed = formSchema.safeParse(values);
    if (!parsed.success) {
      const errors = Object.fromEntries(parsed.error.issues.map((issue) => [issue.path.join('.'), issue.message]));
      setFieldErrors(errors);
      const first = parsed.error.issues[0]?.path[0];
      if (['name', 'venue', 'capacity', 'expectedAttendance', 'eventDays'].includes(String(first))) setStep(1);
      else if (first === 'stations') setStep(2);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    const days = values.eventDays;
    const payload: CreateEvent = {
      name: values.name.trim(),
      description: values.description.trim() || null,
      bannerKey: values.bannerKey,
      artworkDataUrl: values.artworkDataUrl,
      venue: values.venue.trim(),
      address: values.address.trim() || null,
      postalCode: values.postalCode || null,
      latitude: values.latitude,
      longitude: values.longitude,
      locationProvider: values.locationProvider,
      locationReference: values.locationReference || null,
      timezone: 'Asia/Singapore',
      startsAt: toInstant(days[0].date, days[0].startsAt),
      endsAt: toInstant(days[days.length - 1].date, days[days.length - 1].endsAt),
      capacity: Number(values.capacity),
      expectedAttendance: Number(values.expectedAttendance),
      eventDays: days.map((day) => ({
        ...(day.eventDayId ? { eventDayId: day.eventDayId } : {}),
        date: day.date,
        startsAt: toInstant(day.date, day.startsAt),
        endsAt: toInstant(day.date, day.endsAt),
      })),
      stations: values.stations.map((station) => ({
        ...(station.eventStationId ? { eventStationId: station.eventStationId } : {}),
        stationTemplateId: station.stationTemplateId,
        stationOrder: station.stationOrder,
        capacity: Number(station.capacity),
        isAvailable: station.availabilities.some((entry) => entry.isAvailable),
        availabilities: station.availabilities.map((entry) => ({
          date: entry.date,
          isAvailable: entry.isAvailable,
          startsAt: entry.isAvailable ? toInstant(entry.date, entry.startsAt) : null,
          endsAt: entry.isAvailable ? toInstant(entry.date, entry.endsAt) : null,
          capacity: Number(entry.capacity),
        })),
      })),
      shifts: values.shifts.map((shift) => ({
        ...(shift.shiftId ? { shiftId: shift.shiftId } : {}),
        name: shift.name.trim(),
        startsAt: toInstant(shift.date, shift.startsAt),
        endsAt: toInstant(shift.date, shift.endsAt),
        requiredStaff: Number(shift.requiredStaff),
        assignments: shift.assignments.map((assignment) => ({
          ...(assignment.staffAssignmentId ? { staffAssignmentId: assignment.staffAssignmentId } : {}),
          userId: assignment.userId,
          assignmentRole: assignment.assignmentRole,
          stationTemplateId: assignment.stationTemplateId,
          notes: assignment.notes.trim() || null,
        })),
      })),
    };
    setSaving(true);
    try {
      const saved = mode === 'create'
        ? await eventApi.create(payload, createIdempotencyKey.current)
        : await eventApi.update(eventId!, { ...payload, version: existing!.version });
      navigate(`/events/${saved.eventId}`, { state: { notice: isDuplicate ? 'Draft event duplicated.' : mode === 'create' ? 'Draft event created.' : 'Event plan updated.' } });
    } catch (error) {
      const isConflict = (error as { response?: { status?: number } }).response?.status === 409;
      setConflict(isConflict);
      setFormError(getApiMessage(error, isConflict ? 'This event changed in another session.' : 'The event could not be saved.'));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setSaving(false);
    }
  };

  const mapUrl = values.latitude != null && values.longitude != null
    ? `https://www.onemap.gov.sg/api/staticmap/getStaticImage?${new URLSearchParams({
      layerchosen: 'grey',
      latitude: String(values.latitude),
      longitude: String(values.longitude),
      postal: '',
      zoom: '17',
      width: '512',
      height: '240',
      points: `[${values.latitude},${values.longitude}]`,
    })}`
    : '';

  if (loading) return <div className="center-state"><span className="spinner" />Loading event plan…</div>;
  return (
    <div className="page-frame event-form-page">
      {formError && <div className="alert error" role="alert"><span><strong>{conflict ? 'Version conflict. ' : ''}</strong>{formError}</span>{conflict && <button onClick={() => window.location.reload()}>Load latest version</button>}</div>}
      <form id="event-form" className="event-create-form event-wizard" onSubmit={submit} noValidate data-astryx-theme="neutral">
        <Toolbar
          className="event-form-toolbar"
          label="Event form actions"
          size="lg"
          dividers={['bottom']}
          startContent={<div className="event-form-toolbar-title"><strong>{isDuplicate ? `Duplicate ${duplicateFrom?.name}` : mode === 'create' ? 'Create event' : `Edit ${existing?.name}`}</strong><span>Step {step} of 3 · {readyCount} of {readiness.length} checks ready</span></div>}
          endContent={<div className="event-form-toolbar-actions">
            <Link className="secondary" to={duplicateFrom ? `/events/${duplicateFrom.eventId}` : existing ? `/events/${existing.eventId}` : '/events'}>Cancel</Link>
            {step > 1 && <button className="secondary" type="button" onClick={() => setStep(step - 1)}><ArrowLeftIcon />Back</button>}
            <button className="primary" type="submit" disabled={saving}>{saving ? 'Saving…' : step < 3 ? <>Continue<ArrowRightIcon /></> : isDuplicate ? 'Create duplicate' : mode === 'create' ? 'Create draft' : 'Save plan'}</button>
          </div>}
        />

        <nav className="wizard-steps" aria-label="Event creation progress">
          {[
            ['Details', 'Location, dates and capacity'],
            ['Stations', 'Booths and daily availability'],
            ['Shifts & people', 'Coverage and instructions'],
          ].map(([title, description], index) => {
            const number = index + 1;
            return <button key={title} type="button" className={step === number ? 'active' : step > number ? 'complete' : ''} aria-current={step === number ? 'step' : undefined} onClick={() => number < step ? setStep(number) : undefined}>
              <span>{step > number ? <CheckIcon /> : number}</span><strong>{title}<small>{description}</small></strong>
            </button>;
          })}
        </nav>

        {step === 1 && <div className="wizard-panel">
          <header className="wizard-panel-heading"><p className="eyebrow">Step 1</p><h1>Event details</h1><p>Set the public identity, Singapore location, operating dates and attendance model.</p></header>

          <section className="event-artwork-section wizard-artwork" aria-labelledby="event-artwork-title">
            <div className="event-artwork-heading"><div><h2 id="event-artwork-title">Event artwork</h2><p>Choose the image staff will recognize.</p></div><strong>{selectedBanner.label}</strong></div>
            {cropSource ? <div className="artwork-crop-editor">
              <div className="artwork-crop-stage"><Cropper image={cropSource} crop={crop} zoom={zoom} aspect={1} cropShape="rect" showGrid onCropChange={setCrop} onZoomChange={setZoom} onCropComplete={(_, pixels) => setCroppedArea(pixels)} /></div>
              <label className="artwork-zoom"><span>Zoom</span><input type="range" min="1" max="3" step="0.05" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} /></label>
              <div className="artwork-crop-actions"><button className="secondary" type="button" onClick={() => setCropSource('')} disabled={cropping}>Cancel</button><button className="primary" type="button" onClick={() => void confirmCrop()} disabled={cropping}>{cropping ? 'Preparing…' : 'Use crop'}</button></div>
            </div> : <figure className="create-event-banner"><img src={artworkSource} alt="" /><figcaption><span>{values.artworkDataUrl ? 'Custom artwork' : selectedBanner.label}</span><button className="artwork-change-button" type="button" aria-expanded={artworkChooserOpen} onClick={() => setArtworkChooserOpen((open) => !open)}><ArrowUpTrayIcon />Choose artwork</button></figcaption></figure>}
            <input ref={fileInput} className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" onChange={chooseArtwork} />
            {artworkError && <p className="field-error" role="alert">{artworkError}</p>}
            {artworkChooserOpen && <div className="artwork-chooser"><div className="create-banner-options" role="radiogroup" aria-label="Available event artwork">
              {EVENT_BANNERS.map((option) => <button className={`create-banner-option ${!values.artworkDataUrl && values.bannerKey === option.key ? 'selected' : ''}`} type="button" role="radio" aria-checked={!values.artworkDataUrl && values.bannerKey === option.key} key={option.key} onClick={() => { setValues((current) => ({ ...current, bannerKey: option.key, artworkDataUrl: null })); setArtworkChooserOpen(false); }}>
                <img src={option.src} alt="" /><span><strong>{option.label}</strong><small>{option.description}</small></span>{!values.artworkDataUrl && values.bannerKey === option.key && <i><CheckIcon /></i>}
              </button>)}
              <button className={`create-banner-option upload-option ${values.artworkDataUrl ? 'selected' : ''}`} type="button" onClick={() => fileInput.current?.click()}><span className="upload-option-icon"><ArrowUpTrayIcon /></span><span><strong>Upload your image</strong><small>JPEG, PNG, or WebP up to 12 MB</small></span></button>
            </div></div>}
          </section>

          <div className="form-sections">
            <fieldset><legend className="wizard-section-legend"><span>Identity<small>How staff will recognize this event.</small></span></legend><div className="form-grid">
              <Field label="Event name" error={fieldErrors.name}><input value={values.name} onChange={(event) => setValues((current) => ({ ...current, name: event.target.value }))} aria-invalid={Boolean(fieldErrors.name)} placeholder="Northside community screening" /></Field>
              <Field wide label="Description" hint="Optional · visible to event staff"><textarea value={values.description} onChange={(event) => setValues((current) => ({ ...current, description: event.target.value }))} rows={4} placeholder="Add arrival, access, or setup notes." /></Field>
            </div></fieldset>

            <fieldset><legend className="wizard-section-legend"><span>Singapore location<small>OneMap verifies the address and sets Asia/Singapore automatically.</small></span></legend>
              <div className="location-grid">
                <div className="location-search">
                  <Typeahead<LocationItem>
                    label="Search OneMap"
                    description="Search by building, road or 6-digit postal code"
                    value={selectedLocation}
                    onChange={(item) => {
                      setSelectedLocation(item);
                      if (!item) return setValues((current) => ({ ...current, locationProvider: 'MANUAL', locationReference: '', latitude: null, longitude: null }));
                      const result = item.auxiliaryData;
                      setValues((current) => ({
                        ...current,
                        venue: result.label,
                        address: result.address,
                        postalCode: result.postalCode || '',
                        latitude: result.latitude,
                        longitude: result.longitude,
                        locationProvider: 'ONEMAP',
                        locationReference: result.id,
                        timezone: 'Asia/Singapore',
                      }));
                    }}
                    searchSource={locationSource}
                    renderItem={(item) => <span className="location-result"><MapPinIcon /><span className="location-result-copy"><strong>{item.label}</strong><small>{item.auxiliaryData.address}</small></span>{selectedLocation?.id === item.id && <span className="location-result-selected"><CheckIcon />Selected</span>}</span>}
                    placeholder="Try “Tampines Hub” or “529684”"
                    emptySearchResultsText="No Singapore locations found"
                    status={locationSearchError ? { type: 'error', message: locationSearchError } : undefined}
                    onChangeQuery={() => setLocationSearchError('')}
                    debounceMs={300}
                    width="100%"
                  />
                  {selectedLocation && <div className="location-verified"><CheckCircleIcon /><span><strong>OneMap location selected</strong><small>{selectedLocation.auxiliaryData.address}</small></span></div>}
                  <div className="location-details-heading"><strong>Venue details</strong><span>Review these fields before continuing.</span></div>
                  <div className="form-grid compact">
                    <Field label="Venue name" error={fieldErrors.venue}><input value={values.venue} onChange={(event) => setValues((current) => ({ ...current, venue: event.target.value }))} aria-invalid={Boolean(fieldErrors.venue)} placeholder="Our Tampines Hub" /></Field>
                    <Field label="Postal code" error={fieldErrors.postalCode}><input inputMode="numeric" maxLength={6} value={values.postalCode} onChange={(event) => setValues((current) => ({ ...current, postalCode: event.target.value.replace(/\D/g, '') }))} placeholder="529684" /></Field>
                    <Field wide label="Address" hint="Editable after selection"><input value={values.address} onChange={(event) => setValues((current) => ({ ...current, address: event.target.value, locationProvider: current.latitude == null ? 'MANUAL' : current.locationProvider }))} placeholder="1 Tampines Walk, Singapore 528523" /></Field>
                  </div>
                  <div className="timezone-lock"><ClockIcon /><span><strong>Asia/Singapore</strong><small>UTC+08:00 · automatically set from the Singapore location</small></span></div>
                </div>
                <figure className={`location-map ${mapUrl ? '' : 'empty'}`}>
                  {mapUrl ? <img src={mapUrl} alt={`Map showing ${values.venue || values.address}`} /> : <div><MapPinIcon /><strong>Map preview</strong><span>Select a OneMap result to pin the venue.</span></div>}
                  <figcaption>OneMap © contributors · Singapore Land Authority</figcaption>
                </figure>
              </div>
            </fieldset>

            <fieldset><legend className="wizard-section-legend"><span>Dates and daily hours<small>Select up to 31 days, then adjust each day independently.</small></span></legend>
              <div className="native-date-range" role="group" aria-label="Event date range">
                <Field label="First day"><input type="date" value={dateRange?.start || ''} max={dateRange?.end || undefined} onChange={(event) => setRange(event.target.value ? { start: event.target.value, end: dateRange?.end && dateRange.end >= event.target.value ? dateRange.end : event.target.value } as DateRange : null)} /></Field>
                <Field label="Last day"><input type="date" value={dateRange?.end || ''} min={dateRange?.start || undefined} onChange={(event) => setRange(event.target.value ? { start: dateRange?.start && dateRange.start <= event.target.value ? dateRange.start : event.target.value, end: event.target.value } as DateRange : null)} /></Field>
                {fieldErrors.eventDays && <p className="field-error" role="alert">{fieldErrors.eventDays}</p>}
              </div>
              {values.eventDays.length > 0 && <div className="day-schedule-list">
                {values.eventDays.map((day, index) => <article key={day.date}>
                  <div className="day-schedule-date"><span>{new Intl.DateTimeFormat('en-SG', { weekday: 'short' }).format(new Date(`${day.date}T00:00:00+08:00`))}</span><strong>{new Intl.DateTimeFormat('en-SG', { day: '2-digit', month: 'short' }).format(new Date(`${day.date}T00:00:00+08:00`))}</strong></div>
                  <TimeField label="Opens" value={day.startsAt} onChange={(time) => updateDay(index, { startsAt: time })} />
                  <TimeField label="Closes" value={day.endsAt} onChange={(time) => updateDay(index, { endsAt: time })} />
                  <button type="button" className="secondary compact" onClick={() => applyDayHoursToAll(index)}>Apply to all</button>
                </article>)}
              </div>}
            </fieldset>

            <fieldset><legend className="wizard-section-legend"><span>Attendance model<small>Separate total expected visitors from people present at one time.</small></span></legend><div className="form-grid occupancy-grid">
              <Field label="Expected attendance" hint="Estimated visitors across every event day" error={fieldErrors.expectedAttendance}><input type="number" min="1" max="1000000" value={values.expectedAttendance} onChange={(event) => setValues((current) => ({ ...current, expectedAttendance: event.target.value ? Number(event.target.value) : '' }))} placeholder="7000" /></Field>
              <Field label="Concurrent venue capacity" hint="Maximum people the venue can hold at one time" error={fieldErrors.capacity}><input type="number" min="1" max="100000" value={values.capacity} onChange={(event) => setValues((current) => ({ ...current, capacity: event.target.value ? Number(event.target.value) : '' }))} placeholder="500" /></Field>
            </div></fieldset>
          </div>
        </div>}

        {step === 2 && <div className="wizard-panel">
          <header className="wizard-panel-heading"><p className="eyebrow">Step 2</p><h1>Stations and booths</h1><p>Build from the shared template pool, then set availability, hours and live capacity for each day.</p></header>
          <MultiSelector
            label="Station template pool"
            description="Select every station this event needs"
            options={templates.map((template) => ({ value: template.stationTemplateId, label: `${template.name} · capacity ${template.defaultCapacity}` }))}
            value={selectedTemplateIds}
            onChange={selectTemplates}
            placeholder={templates.length ? 'Choose station templates' : 'No active station templates'}
            hasSearch
            hasSelectAll
            width="100%"
          />
          {values.stations.length === 0 ? <div className="wizard-empty"><MapPinIcon /><h2>No stations selected</h2><p>Open the template pool above to add registration, screening or support booths.</p></div> : <>
            <div className="active-day-switcher" aria-label="Station schedule date">
              <button type="button" className="icon-button" disabled={activeDayIndex === 0} onClick={() => setActiveDay(values.eventDays[activeDayIndex - 1]?.date)} aria-label="Previous day"><ArrowLeftIcon /></button>
              <label><span>Configure day</span><select value={activeDayRecord?.date || ''} onChange={(event) => setActiveDay(event.target.value)}>{values.eventDays.map((day, index) => <option key={day.date} value={day.date}>Day {index + 1} · {new Intl.DateTimeFormat('en-SG', { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(`${day.date}T00:00:00+08:00`))}</option>)}</select></label>
              <button type="button" className="icon-button" disabled={activeDayIndex >= values.eventDays.length - 1} onClick={() => setActiveDay(values.eventDays[activeDayIndex + 1]?.date)} aria-label="Next day"><ArrowRightIcon /></button>
            </div>
            <div className="station-plan-list">
              {values.stations.map((station, stationIndex) => {
                const template = templates.find((candidate) => candidate.stationTemplateId === station.stationTemplateId);
                const availability = station.availabilities[activeDayIndex];
                if (!availability) return null;
                return <article key={station.stationTemplateId} className={!availability.isAvailable ? 'unavailable' : ''}>
                  <header><span className="station-plan-order">{stationIndex + 1}</span><div><h2>{template?.name || 'Station'}</h2><p>{template?.description || 'Reusable event station'}</p></div><label className="availability-toggle"><input type="checkbox" checked={availability.isAvailable} onChange={(event) => updateStationAvailability(stationIndex, activeDayIndex, { isAvailable: event.target.checked })} /><span>{availability.isAvailable ? 'Available' : 'Closed'}</span></label></header>
                  <div className="station-plan-controls">
                    <TimeField label="Opens" value={availability.startsAt} onChange={(time) => updateStationAvailability(stationIndex, activeDayIndex, { startsAt: time })} disabled={!availability.isAvailable} />
                    <TimeField label="Closes" value={availability.endsAt} onChange={(time) => updateStationAvailability(stationIndex, activeDayIndex, { endsAt: time })} disabled={!availability.isAvailable} />
                    <Field label="Live capacity" hint="People handled at once"><input type="number" min="1" max="100000" disabled={!availability.isAvailable} value={availability.capacity} onChange={(event) => updateStationAvailability(stationIndex, activeDayIndex, { capacity: Math.max(1, Number(event.target.value)) })} /></Field>
                    <button type="button" className="secondary compact" onClick={() => applyStationDayToAll(stationIndex, activeDayIndex)}>Apply this day to all</button>
                  </div>
                </article>;
              })}
            </div>
          </>}
        </div>}

        {step === 3 && <div className="wizard-panel">
          <header className="wizard-panel-heading"><p className="eyebrow">Step 3</p><h1>Shifts and people</h1><p>Create coverage windows, assign staff, choose their station and leave precise instructions.</p></header>
          <div className={`staffing-summary ${concurrentAssigned < requiredHeadcount ? 'warning' : 'ready'}`}><UsersIcon /><span><strong>{concurrentAssigned} assigned / {requiredHeadcount} required</strong><small>{concurrentAssigned < requiredHeadcount ? `${requiredHeadcount - concurrentAssigned} more assignment${requiredHeadcount - concurrentAssigned === 1 ? '' : 's'} recommended before publishing.` : 'Required headcount is covered.'}</small></span></div>
          <div className="shift-plan-list">
            {values.shifts.map((shift, shiftIndex) => <article className="shift-plan" key={shift.shiftId || shiftIndex}>
              <header><div><span>Shift {shiftIndex + 1}</span><h2>{shift.name.trim() || 'Untitled shift'}</h2></div><button type="button" className="icon-button danger" onClick={() => setValues((current) => ({ ...current, shifts: current.shifts.filter((_, index) => index !== shiftIndex) }))} aria-label={`Remove shift ${shiftIndex + 1}`}><TrashIcon /></button></header>
              <div className="shift-plan-fields">
                <Field label="Shift name" error={fieldErrors[`shifts.${shiftIndex}.name`]}><input value={shift.name} onChange={(event) => updateShift(shiftIndex, { name: event.target.value })} placeholder="Day 1 morning screening" /></Field>
                <Field label="Event day"><select value={shift.date} onChange={(event) => updateShift(shiftIndex, { date: event.target.value })}>{values.eventDays.map((day, index) => <option key={day.date} value={day.date}>Day {index + 1} · {day.date}</option>)}</select></Field>
                <TimeField label="Starts" value={shift.startsAt} onChange={(time) => updateShift(shiftIndex, { startsAt: time })} />
                <TimeField label="Ends" value={shift.endsAt} onChange={(time) => updateShift(shiftIndex, { endsAt: time })} />
                <Field label="Required team size"><input type="number" min="1" max="1000" value={shift.requiredStaff} onChange={(event) => updateShift(shiftIndex, { requiredStaff: Math.max(1, Number(event.target.value)) })} /></Field>
              </div>
              <div className="shift-assignment-heading"><div><h3>Assigned people</h3><p>{shift.assignments.length} of {shift.requiredStaff} positions filled</p></div><label><span className="visually-hidden">Add person</span><select value="" onChange={(event) => addAssignment(shiftIndex, event.target.value)}><option value="">Add a person…</option>{staff.filter((person) => !shift.assignments.some((assignment) => assignment.userId === person.userId)).map((person) => <option key={person.userId} value={person.userId}>{getDisplayName(person.username)} · {roleLabel(person.systemRole as StaffAssignmentRole)}</option>)}</select></label></div>
              {shift.assignments.length === 0 ? <p className="assignment-empty">No one assigned to this shift yet.</p> : <div className="assignment-list">
                {shift.assignments.map((assignment, assignmentIndex) => {
                  const person = staff.find((candidate) => candidate.userId === assignment.userId);
                  return <article key={assignment.userId} className="assignment-card">
                    <div className="assignment-person"><Avatar name={getDisplayName(person?.username || 'Staff member')} size={36} /><span><strong>{getDisplayName(person?.username || 'Staff member')}</strong><small>{person?.systemRole ? roleLabel(person.systemRole as StaffAssignmentRole) : 'Staff'}</small></span><button type="button" className="icon-button danger" onClick={() => updateShift(shiftIndex, { assignments: shift.assignments.filter((_, index) => index !== assignmentIndex) })} aria-label={`Remove ${getDisplayName(person?.username || 'staff member')}`}><TrashIcon /></button></div>
                    <div className="assignment-fields">
                      <Field label="Event role"><select value={assignment.assignmentRole} onChange={(event) => {
                        const assignmentRole = event.target.value as StaffAssignmentRole;
                        updateAssignment(shiftIndex, assignmentIndex, { assignmentRole, stationTemplateId: assignmentRole === 'SCREENER' ? assignment.stationTemplateId || values.stations[0]?.stationTemplateId || null : assignment.stationTemplateId });
                      }}>{ROLES.map((role) => <option key={role} value={role}>{roleLabel(role)}</option>)}</select></Field>
                      <Field label="Station" hint={assignment.assignmentRole === 'SCREENER' ? 'Required for screeners' : 'Optional'} error={fieldErrors[`shifts.${shiftIndex}.assignments.${assignmentIndex}.stationTemplateId`]}><select value={assignment.stationTemplateId || ''} onChange={(event) => updateAssignment(shiftIndex, assignmentIndex, { stationTemplateId: event.target.value || null })}><option value="">No station</option>{values.stations.map((station) => <option key={station.stationTemplateId} value={station.stationTemplateId}>{templates.find((template) => template.stationTemplateId === station.stationTemplateId)?.name || 'Station'}</option>)}</select></Field>
                      <Field wide label="Custom instructions" hint={`${assignment.notes.length}/500`}><textarea rows={3} maxLength={500} value={assignment.notes} onChange={(event) => updateAssignment(shiftIndex, assignmentIndex, { notes: event.target.value })} placeholder="Arrival point, responsibilities, escalation notes…" /></Field>
                    </div>
                  </article>;
                })}
              </div>}
            </article>)}
          </div>
          {values.shifts.length === 0 && <div className="wizard-empty"><UsersIcon /><h2>No shifts yet</h2><p>Add a shift to assign people, roles, stations and custom instructions.</p></div>}
          <button type="button" className="secondary shift-add" onClick={addShift}><PlusIcon />Add shift</button>
          <section className="event-readiness" aria-labelledby="readiness-title"><div><p className="eyebrow">Draft readiness</p><h2 id="readiness-title">{readyCount} of {readiness.length} checks ready</h2><p>Understaffing is a warning for drafts. Publishing remains a separate confirmed action.</p></div><ul>{readiness.map((item) => <li key={item.label} className={item.ready ? 'ready' : ''}><CheckCircleIcon />{item.label}</li>)}</ul></section>
        </div>}
      </form>
    </div>
  );
}

function Field({ label, hint, error, wide, children }: { label: string; hint?: string; error?: string; wide?: boolean; children: React.ReactNode }) {
  return <label className={wide ? 'field wide' : 'field'}><span>{label}{hint && <small>{hint}</small>}</span>{children}{error && <em>{error}</em>}</label>;
}

function TimeField({ label, value, onChange, disabled }: { label: string; value: TimeValue; onChange: (value: TimeValue) => void; disabled?: boolean }) {
  return <label className="field native-time-field"><span>{label}</span><input type="time" value={value} disabled={disabled} onChange={(event) => onChange(asTime(event.target.value))} /></label>;
}
