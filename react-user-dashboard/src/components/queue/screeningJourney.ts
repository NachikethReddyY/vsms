import type { components } from '../../generated/api';

type PublicPassStatus = components['schemas']['QrPublicStatusResponse']['data'];

export type JourneyStatus = 'completed' | 'current' | 'upcoming';

export type JourneyStep = {
  id: string;
  label: string;
  detail?: string;
  status: JourneyStatus;
};

export type JourneyModel = {
  steps: JourneyStep[];
  progress: string;
  currentLabel: string | null;
  nextLabel: string | null;
  queuePosition: string | null;
};

/** Derive the display model from the server-owned, privacy-safe route projection. */
export function buildScreeningJourney(status: PublicPassStatus): JourneyModel {
  const steps: JourneyStep[] = [
    {
      id: 'registration',
      label: 'Registration',
      status: status.queueNumber != null ? 'completed' : 'current',
    },
    ...status.route.map<JourneyStep>((step, index) => ({
      id: `${step.stationType}-${index}`,
      label: step.stationName,
      detail: step.state === 'BLOCKED' ? 'Waiting for staff action' : step.stationType,
      status: step.state === 'COMPLETED' ? 'completed' : step.state === 'CURRENT' ? 'current' : 'upcoming',
    })),
  ];

  const done = steps.filter((step) => step.status === 'completed').length;

  const currentStep = steps.find((step) => step.status === 'current');
  const nextStep = steps.find((step) => step.status === 'upcoming');

  return {
    steps,
    progress: `${done} / ${steps.length}`,
    currentLabel: currentStep?.label ?? null,
    nextLabel: nextStep?.label ?? null,
    queuePosition: null,
  };
}
