import { CalendarDaysIcon, ClockIcon, GlobeAsiaAustraliaIcon } from '@heroicons/react/24/outline';
import { DateRangeInput, type DateRange } from '@astryxdesign/core/DateRangeInput';
import { Selector, type SelectorOptionData, type SelectorSection } from '@astryxdesign/core/Selector';
import { useEffect, useMemo, useState } from 'react';

export type EventTimeValue = `${number}${number}:${number}${number}`;

const TIMEZONE = 'Asia/Singapore';
const TIME_INCREMENT_MINUTES = 15;
const MINUTES_PER_DAY = 24 * 60;

function useCompactCalendar() {
  const [compact, setCompact] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 760px)').matches);

  useEffect(() => {
    const query = window.matchMedia('(max-width: 760px)');
    const update = () => setCompact(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  return compact;
}

function timeLabel(value: string) {
  const date = new Date(`2026-01-01T${value}:00+08:00`);
  return new Intl.DateTimeFormat('en-SG', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: TIMEZONE,
  }).format(date);
}

function timeOptions(currentValue: string) {
  const values = Array.from({ length: MINUTES_PER_DAY / TIME_INCREMENT_MINUTES }, (_, index) => {
    const minutes = index * TIME_INCREMENT_MINUTES;
    return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  });
  if (currentValue && !values.includes(currentValue)) values.push(currentValue);
  values.sort();

  const grouped = new Map<string, SelectorOptionData[]>();
  values.forEach((value) => {
    const hour = Number(value.slice(0, 2));
    const period = hour < 6 ? 'Overnight' : hour < 12 ? 'Morning' : hour < 18 ? 'Afternoon' : 'Evening';
    const options = grouped.get(period) ?? [];
    options.push({ value, label: `${timeLabel(value)} · ${value}` });
    grouped.set(period, options);
  });

  return Array.from(grouped, ([title, options]) => ({ type: 'section' as const, title, options }));
}

export function EventDateRangePicker({
  value,
  onChange,
  error,
}: {
  value: DateRange | null;
  onChange: (value: DateRange | null) => void;
  error?: string;
}) {
  const compact = useCompactCalendar();

  return <div className="vsms-date-range" role="group" aria-label="Event dates and timezone">
    <DateRangeInput
      className="vsms-date-range-control"
      label="Event date range"
      description="Choose the first and last operating day. Every day in the range can have its own hours."
      placeholder="Choose event dates"
      value={value}
      onChange={onChange}
      isRequired
      hasClear
      numberOfMonths={compact ? 1 : 2}
      size="lg"
      width="100%"
      status={error ? { type: 'error', message: error } : undefined}
    />
    <div className="vsms-timezone-context">
      <span className="vsms-date-range-icon" aria-hidden="true"><CalendarDaysIcon /></span>
      <span><strong>Singapore time</strong><small><GlobeAsiaAustraliaIcon aria-hidden="true" /> Asia/Singapore · UTC+08:00</small></span>
    </div>
  </div>;
}

export function EventTimePicker({
  label,
  value,
  onChange,
  disabled,
  error,
}: {
  label: string;
  value: EventTimeValue;
  onChange: (value: EventTimeValue) => void;
  disabled?: boolean;
  error?: string;
}) {
  const options = useMemo<Array<SelectorSection>>(() => timeOptions(value), [value]);

  return <div className="vsms-time-picker">
    <Selector
      className="vsms-time-selector"
      label={label}
      description="Singapore time"
      value={value}
      options={options}
      onChange={(nextValue) => onChange(nextValue as EventTimeValue)}
      isRequired
      isDisabled={disabled}
      disabledMessage={disabled ? 'Make this station available before changing its hours.' : undefined}
      startIcon={<ClockIcon aria-hidden="true" />}
      placeholder="Choose a time"
      placement="below"
      size="lg"
      width="100%"
      status={error ? { type: 'error', message: error } : undefined}
    />
  </div>;
}
