import { CheckIcon, MapPinIcon } from '@heroicons/react/24/outline';
import type { JourneyModel } from './screeningJourney';
import './ScreeningJourneyTimeline.css';

export type { JourneyModel, JourneyStatus, JourneyStep } from './screeningJourney';

interface ScreeningJourneyTimelineProps {
  model: JourneyModel;
  title?: string;
}

export function ScreeningJourneyTimeline({ model, title = 'Screening journey' }: ScreeningJourneyTimelineProps) {
  if (model.steps.length === 0) return null;

  return (
    <section className="sj" aria-label={title}>
      <h2 className="sj-title"><MapPinIcon aria-hidden="true" />{title}</h2>

      <div className="sj-steps">
        {model.steps.map((step, index) => (
          <div className="sj-step-row" key={step.id}>
            {index > 0 && <span className="sj-link" aria-hidden="true" />}
            <div className={`sj-step sj-step--${step.status}`} data-status={step.status}>
              <span className="sj-dot" aria-hidden="true">
                {step.status === 'completed' && <CheckIcon />}
              </span>
              <div className="sj-body">
                <span className="sj-label">{step.label}</span>
                <span className="sj-status">
                  {step.status === 'completed' && 'Completed'}
                  {step.status === 'current' && 'Current — go here'}
                  {step.status === 'upcoming' && 'Upcoming'}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>

      <dl className="sj-summary">
        <div className="sj-summary-item">
          <dt>Progress</dt>
          <dd>{model.progress} steps</dd>
        </div>
        {model.currentLabel && (
          <div className="sj-summary-item">
            <dt>Current</dt>
            <dd>{model.currentLabel}</dd>
          </div>
        )}
        {model.nextLabel && (
          <div className="sj-summary-item">
            <dt>Next</dt>
            <dd>{model.nextLabel}</dd>
          </div>
        )}
        {model.queuePosition && (
          <div className="sj-summary-item">
            <dt>Queue</dt>
            <dd>{model.queuePosition}</dd>
          </div>
        )}
      </dl>
    </section>
  );
}
