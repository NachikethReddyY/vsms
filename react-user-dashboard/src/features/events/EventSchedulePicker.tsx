import { CalendarDaysIcon, ClockIcon, GlobeAsiaAustraliaIcon } from '@heroicons/react/24/outline';

export type EventTimeValue = `${number}${number}:${number}${number}`;
export type EventDateRange = { start: string; end: string };

export function EventDateRangePicker({
  value,
  onChange,
  error,
}: {
  value: EventDateRange | null;
  onChange: (value: EventDateRange | null) => void;
  error?: string;
}) {
  const update = (part: keyof EventDateRange, next: string) => {
    const range = { start: value?.start ?? '', end: value?.end ?? '', [part]: next };
    onChange(range.start || range.end ? range : null);
  };

  return <div className="vsms-date-range" role="group" aria-label="Event dates and timezone">
    <div className="vsms-date-fields">
      <label><span>Starts</span><input type="date" required value={value?.start ?? ''} onChange={(event) => update('start', event.target.value)} /></label>
      <label><span>Ends</span><input type="date" required min={value?.start} value={value?.end ?? ''} onChange={(event) => update('end', event.target.value)} /></label>
      {error && <p className="field-error" role="alert">{error}</p>}
    </div>
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
  return <label className="vsms-time-picker">
    <span>{label}<small>Singapore time</small></span>
    <span className="vsms-time-input"><ClockIcon aria-hidden="true" /><input type="time" step="900" required disabled={disabled} value={value} onChange={(event) => onChange(event.target.value as EventTimeValue)} /></span>
    {error && <em>{error}</em>}
  </label>;
}
