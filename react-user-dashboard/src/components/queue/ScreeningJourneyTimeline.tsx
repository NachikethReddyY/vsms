import { CheckIcon, MapPinIcon } from '@heroicons/react/24/outline';
import type { JourneyModel } from './screeningJourney';

export type { JourneyModel, JourneyStatus, JourneyStep } from './screeningJourney';

interface ScreeningJourneyTimelineProps {
  model: JourneyModel;
  title?: string;
}

const dotClass = {
  completed: 'border-[var(--green,#15803d)] bg-[var(--green,#15803d)]',
  current: 'border-[var(--event-blue,#2563eb)] bg-[var(--event-blue,#2563eb)] shadow-[0_0_0_4px_color-mix(in_srgb,var(--event-blue,#2563eb)_16%,transparent)]',
  upcoming: 'border-[var(--event-line,#e3e4df)] bg-[var(--event-card,#fff)]',
};

export function ScreeningJourneyTimeline({ model, title = 'Screening journey' }: ScreeningJourneyTimelineProps) {
  if (model.steps.length === 0) return null;

  return (
    <section className="mt-4.5 w-full max-w-120 text-left" aria-label={title}>
      <h2 className="mb-3 flex items-center gap-1.75 text-xs tracking-[.08em] text-[var(--event-muted,#6b6f66)] uppercase"><MapPinIcon className="size-3.75" aria-hidden="true" />{title}</h2>

      <div className="flex flex-col gap-0.5 min-[560px]:flex-row min-[560px]:items-start min-[560px]:gap-1">
        {model.steps.map((step, index) => (
          <div className="flex items-stretch min-[560px]:min-w-0 min-[560px]:flex-1 min-[560px]:items-start" key={step.id}>
            {index > 0 && <span className="mx-3 my-0.5 h-5 w-0.5 shrink-0 rounded-sm bg-[var(--event-line,#e3e4df)] min-[560px]:mx-0.5 min-[560px]:mt-3 min-[560px]:mb-0 min-[560px]:h-0.5 min-[560px]:w-4.5" aria-hidden="true" />}
            <div className="flex min-w-0 flex-1 items-start gap-3 min-[560px]:flex-col min-[560px]:items-center min-[560px]:gap-2 min-[560px]:text-center" data-status={step.status}>
              <span className={`mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border-2 min-[560px]:mt-0 ${dotClass[step.status]}`} aria-hidden="true">
                {step.status === 'completed' && <CheckIcon className="size-3.25 text-white" />}
              </span>
              <div className="flex flex-col gap-0.5 pb-3.5 min-[560px]:items-center min-[560px]:pb-0">
                <span className={`wrap-anywhere text-[0.84375rem] font-bold ${step.status === 'current' ? 'text-[var(--event-blue,#2563eb)]' : 'text-[var(--event-ink,#0d0d0f)]'}`}>{step.label}</span>
                <span className={`text-[0.6875rem] font-semibold tracking-[.06em] uppercase ${step.status === 'current' ? 'text-[var(--event-blue,#2563eb)]' : 'text-[var(--event-muted,#6b6f66)]'}`}>
                  {step.status === 'completed' && 'Completed'}
                  {step.status === 'current' && 'Current — go here'}
                  {step.status === 'upcoming' && 'Upcoming'}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>

      <dl className="mt-1.5 flex flex-wrap gap-x-3.5 gap-y-1.5 rounded-xl border border-[var(--event-line,#e3e4df)] bg-[var(--event-card,#fff)] px-3.5 py-3 [&_div]:min-w-0 [&_dt]:m-0 [&_dt]:text-[0.65625rem] [&_dt]:tracking-[.08em] [&_dt]:text-[var(--event-muted,#6b6f66)] [&_dt]:uppercase [&_dd]:mt-0.5 [&_dd]:mb-0 [&_dd]:text-[0.8125rem] [&_dd]:font-bold [&_dd]:text-[var(--event-ink,#0d0d0f)]">
        <div>
          <dt>Progress</dt>
          <dd>{model.progress} steps</dd>
        </div>
        {model.currentLabel && (
          <div>
            <dt>Current</dt>
            <dd>{model.currentLabel}</dd>
          </div>
        )}
        {model.nextLabel && (
          <div>
            <dt>Next</dt>
            <dd>{model.nextLabel}</dd>
          </div>
        )}
        {model.queuePosition && (
          <div>
            <dt>Queue</dt>
            <dd>{model.queuePosition}</dd>
          </div>
        )}
      </dl>
    </section>
  );
}
