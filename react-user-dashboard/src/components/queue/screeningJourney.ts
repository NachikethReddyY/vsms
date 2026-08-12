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

/**
 * Derive the screening journey (Registration → stations → Completed) from the
 * public pass status payload. No new data source is introduced.
 *
 * - A step is COMPLETED when a queueMovement transfer left that station
 *   (`transfers[].fromStation`) or, for Registration, when a queue number was issued.
 * - A step is CURRENT when it is the participant's active queue entry station.
 * - Everything else is UPCOMING. The terminal "Screening completed" step only
 *   flips to completed once the registration is COMPLETED.
 */
export function buildScreeningJourney(status: PublicPassStatus): JourneyModel {
  const completedStations = new Set(status.transfers.map((transfer) => transfer.fromStation));
  const currentStationId = status.queueState?.station?.id ?? null;

  const steps: JourneyStep[] = [
    {
      id: 'registration',
      label: 'Registration',
      status: status.queueNumber != null ? 'completed' : 'current',
    },
    ...status.stations.map<JourneyStep>((station) => {
      const completed = completedStations.has(station.stationName);
      const current = !completed && station.stationId === currentStationId;
      return {
        id: station.stationId,
        label: station.stationName,
        detail: station.stationType,
        status: completed ? 'completed' : current ? 'current' : 'upcoming',
      };
    }),
    {
      id: 'completed',
      label: 'Screening completed',
      status: status.registrationStatus === 'COMPLETED' ? 'completed' : 'upcoming',
    },
  ];

  const measurable = steps.filter((step) => step.id !== 'completed');
  const done = measurable.filter((step) => step.status === 'completed').length;

  const currentStep = steps.find((step) => step.status === 'current');
  const nextStep = steps.find((step) => step.status === 'upcoming');

  let queuePosition: string | null = null;
  if (
    currentStep
    && currentStep.id !== 'registration'
    && status.aheadAtStation != null
    && status.aheadAtStation > 0
  ) {
    queuePosition = `${status.aheadAtStation} ${status.aheadAtStation === 1 ? 'person' : 'people'} ahead of you`;
  }

  return {
    steps,
    progress: `${done} / ${measurable.length}`,
    currentLabel: currentStep?.label ?? null,
    nextLabel: nextStep?.label ?? null,
    queuePosition,
  };
}
