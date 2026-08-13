import type { QueueJourney, StationType } from './screeningApi';
import { RouteProgressionNotice } from './StationShared';

type StationHandoffLinksProps = {
  eventId: string;
  currentStationType: StationType;
  registrationId: string;
  journey: QueueJourney | null;
  queuedOffline?: boolean;
};

export function StationHandoffLinks({
  eventId,
  currentStationType,
  registrationId,
  journey,
  queuedOffline = false,
}: StationHandoffLinksProps) {
  // The server advances the route; these values preserve the station handoff contract.
  void currentStationType;
  void registrationId;
  void journey;

  return (
    <RouteProgressionNotice
      eventId={eventId}
      queued={queuedOffline}
    />
  );
}
