/* eslint-disable react-refresh/only-export-components */

import { ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import {
  FormEvent,
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { AppToast } from '../../components/AppToast';
import {
  LiveStationHandoffPicker,
  type LiveStationHandoffStation,
} from '../../components/qr/LiveStationHandoffPicker';

import apiClient, {
  getApiError as getApiMessage,
} from '../../utils/apiClient';

import { getStoredSession } from '../../utils/session';

import {
  FlagEvaluation,
  QueueJourney,
  QueueRegistration,
  screeningApi,
  Station,
  StationType,
} from './screeningApi';

import { extractQrToken } from './qrHandoff';
import {
  getOfflineStationContext,
  isNetworkError,
} from './offlineSync';

import {
  customStationPath,
  STATION_LABEL,
  STATION_PATH_SLUG,
  stationPath,
} from './stationConfig';

import { StationCameraScanner } from './StationCameraScanner';
import './StationCameraScanner.css';

/**
 * ============================================================================
 * Station Handoff Links
 * ============================================================================
 */

export function StationHandoffLinks({
  eventId,
  currentStationType,
  currentStationId,
  registrationId,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  journey: _journey,
  queuedOffline = false,
  stations,
}: {
  eventId: string;
  currentStationType: StationType;
  currentStationId?: string;
  registrationId?: string | null;
  journey?: QueueJourney | null;
  queuedOffline?: boolean;
  stations?: Station[];
}) {
  const navigate = useNavigate();

  const [passImage] = useState<string | null>(null);
  const [passName] = useState<string | null>(null);
  const [passQueue] = useState<number | null>(null);
  const [passError] = useState<string | null>(null);

  const [liveStations, setLiveStations] = useState<
    LiveStationHandoffStation[]
  >([]);

  /**
   * Determine the stations that come after the current station
   * according to the event's configured station order.
   */
  const nextStations = useMemo(() => {
    const orderedStations = stations
      ? [...stations]
          .filter((item) => item.isActive)
          .sort(
            (left, right) =>
              left.stationOrder - right.stationOrder,
          )
      : [];

    const currentIndex = orderedStations.findIndex(
      (item) =>
        item.stationType === currentStationType &&
        (!currentStationId ||
          item.stationId === currentStationId),
    );

    if (currentIndex >= 0) {
      return orderedStations
        .slice(currentIndex + 1)
        .filter(
          (item) =>
            item.stationType === 'CUSTOM' ||
            Boolean(STATION_PATH_SLUG[item.stationType]),
        );
    }

    return nextStationTypes(
      currentStationType,
      stations,
    ).map((stationType) => ({
      stationType,
      stationId: '',
      stationName: STATION_LABEL[stationType],
    }));
  }, [
    currentStationId,
    currentStationType,
    stations,
  ]);

  const isLastScreeningStation =
    nextStations.length === 0;

  const nextLabel =
    nextStations[0]?.stationName ?? null;

  /**
   * Load currently available stations for handoff.
   *
   * The backend determines which stations are currently
   * available. We then restrict the result to stations that
   * are actually next according to the event route.
   */
  useEffect(() => {
    if (!eventId) {
      return;
    }

    let cancelled = false;

    void apiClient
      .get<{ stations: LiveStationHandoffStation[] }>(
        `/queues/events/${eventId}/stations`,
      )
      .then(({ data }) => {
        if (cancelled) {
          return;
        }

        const filteredStations =
          data.stations.filter((station) =>
            nextStations.some((nextStation) =>
              nextStation.stationId
                ? nextStation.stationId ===
                  station.stationId
                : nextStation.stationType ===
                  station.stationType,
            ),
          );

        setLiveStations(filteredStations);
      })
      .catch(() => {
        if (!cancelled) {
          setLiveStations([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [eventId, nextStations]);

  return (
    <nav
      className="va-handoff"
      aria-label="Continue screening"
    >
      <p className="va-handoff-label">
        {nextStations.length > 0
          ? `Station complete — show this QR so the participant can join the ${nextLabel} queue`
          : 'Screening stations complete for this route'}

        {registrationId
          ? ' · same participant kept'
          : null}
      </p>

      {/* ================================================================
          Participant QR Pass
          ================================================================ */}

      {registrationId && (
        <div
          className="station-pass-qr"
          aria-live="polite"
        >
          {passError && (
            <p
              className="form-error"
              role="alert"
            >
              {passError}
            </p>
          )}

          {passImage && (
            <>
              <img
                src={passImage}
                alt="Participant QR pass for next station queue"
              />

              <p>
                Show this code to{' '}
                <strong>
                  {passName || 'the participant'}
                </strong>

                {nextLabel ? (
                  <>
                    {' '}
                    for{' '}
                    <strong>{nextLabel}</strong>.
                  </>
                ) : null}
              </p>

              {passQueue != null && (
                <p className="station-pass-qr-meta">
                  Queue #{passQueue}
                </p>
              )}
            </>
          )}

          {!passImage && !passError && (
            <p className="station-pass-qr-meta">
              Loading participant QR…
            </p>
          )}
        </div>
      )}

      {/* ================================================================
          Live Station Picker
          ================================================================ */}

      {registrationId &&
        !queuedOffline &&
        liveStations.length > 0 && (
          <LiveStationHandoffPicker
            stations={liveStations}
            onSelect={(station) => {
              const stationType =
                station.stationType as StationType;

              const href =
                stationType === 'CUSTOM'
                  ? customStationPath(
                      eventId,
                      station.stationId,
                      registrationId,
                    )
                  : stationPath(
                      eventId,
                      stationType,
                      registrationId,
                    );

              if (href) {
                navigate(href);
              }
            }}
            actionLabel="Open station"
            emptyMessage="No next stations are available."
          />
        )}

      {/* ================================================================
          Station Navigation
          ================================================================ */}

      <div
        className="action-cluster"
        style={{ paddingTop: 0 }}
      >
        {liveStations.length === 0 &&
          nextStations.map(
            (nextStation, index) => {
              const href =
                nextStation.stationType ===
                'CUSTOM'
                  ? customStationPath(
                      eventId,
                      nextStation.stationId,
                      registrationId,
                    )
                  : stationPath(
                      eventId,
                      nextStation.stationType,
                      registrationId,
                    );

              if (!href) {
                return null;
              }

              return (
                <Link
                  key={
                    nextStation.stationId ||
                    nextStation.stationType
                  }
                  className={
                    index === 0
                      ? 'primary'
                      : 'secondary'
                  }
                  to={href}
                >
                  {index === 0
                    ? 'Open next station tablet: '
                    : ''}
                  {nextStation.stationName}
                </Link>
              );
            },
          )}

        {isLastScreeningStation && (
          <Link
            className="primary"
            to={`/events/${eventId}/reviews`}
          >
            Open clinical review
          </Link>
        )}

        <Link
          className="secondary"
          to={`/events/${eventId}`}
        >
          Back to event
        </Link>
      </div>
    </nav>
  );
}

/**
 * ============================================================================
 * Flag Banner
 * ============================================================================
 */

export function FlagBanner({
  evaluation,
  acknowledged,
  onAcknowledgedChange,
  stationLabel,
}: {
  evaluation: FlagEvaluation;
  acknowledged: boolean;
  onAcknowledgedChange: (
    next: boolean,
  ) => void;
  stationLabel: string;
}) {
  return (
    <aside
      className={`va-flag-banner flag-${evaluation.overallFlag.toLowerCase()}`}
      role="status"
      aria-live="polite"
    >
      <div className="va-flag-banner-head">
        <ExclamationTriangleIcon />

        <div>
          <strong>
            {evaluation.isFlagged
              ? `${evaluation.overallFlag} flag`
              : 'No clinical flag'}
          </strong>

          <small>
            Rule {evaluation.ruleVersion}
          </small>
        </div>
      </div>

      {evaluation.flagSummary && (
        <p>{evaluation.flagSummary}</p>
      )}

      {evaluation.reasons.length > 0 && (
        <ul>
          {evaluation.reasons.map((item) => (
            <li
              key={`${item.flag}-${item.reason}`}
            >
              {item.flag}: {item.reason}
            </li>
          ))}
        </ul>
      )}

      {evaluation.isFlagged && (
        <label className="va-ack">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(event) =>
              onAcknowledgedChange(
                event.target.checked,
              )
            }
          />

          <span>
            I have reviewed this automatic flag
            and acknowledge saving a{' '}
            {evaluation.overallFlag}{' '}
            {stationLabel} result.
          </span>
        </label>
      )}
    </aside>
  );
}

/**
 * ============================================================================
 * Participant Lookup
 * ============================================================================
 */

export function ParticipantLookup({
  eventId,
  queue,
  selectedId,
  onSelect,
  selected,
}: {
  eventId: string;
  queue: QueueRegistration[];
  selectedId: string;
  onSelect: (
    registrationId: string,
  ) => void;
  selected: QueueRegistration | null;
}) {
  const [passToken, setPassToken] =
    useState('');

  const [error, setError] =
    useState<string | null>(null);

  const [success, setSuccess] =
    useState<string | null>(null);

  const [scannerOpen, setScannerOpen] =
    useState(false);

  const applyResolved = useCallback(
    (
      person: {
        registrationId: string;
        participantDisplayName: string;
      },
      source: string,
    ) => {
      onSelect(person.registrationId);

      setSuccess(
        `Loaded ${person.participantDisplayName} from ${source}.`,
      );
    },
    [onSelect],
  );

  const resolvePass = async () => {
    if (
      !eventId ||
      !passToken.trim()
    ) {
      return;
    }

    setError(null);
    setSuccess(null);

    try {
      const token =
        extractQrToken(passToken) ||
        passToken.trim();

      const person =
        await screeningApi.resolve(
          eventId,
          {
            passToken: token,
            qrToken: token,
          },
        );

      applyResolved(
        person,
        'pass / QR token',
      );
    } catch (cause) {
      setError(
        getApiMessage(
          cause,
          'Could not resolve that participant pass.',
        ),
      );
    }
  };

  const onCameraScan = useCallback(
    async (raw: string) => {
      if (!eventId) {
        throw new Error(
          'Event is not ready.',
        );
      }

      const token =
        extractQrToken(raw);

      if (!token) {
        throw new Error(
          'No QR token found in the scan.',
        );
      }

      setError(null);
      setSuccess(null);
      setPassToken(token);

      try {
        const person =
          await screeningApi.resolve(
            eventId,
            {
              passToken: token,
              qrToken: token,
            },
          );

        applyResolved(
          person,
          'camera scan',
        );
      } catch (cause) {
        const message =
          getApiMessage(
            cause,
            'Could not resolve that participant pass.',
          );

        setError(message);

        throw new Error(message);
      }
    },
    [eventId, applyResolved],
  );

  return (
    <section
      className="detail-panel"
      style={{ marginBottom: 24 }}
    >
      <h2>Find participant</h2>

      {error && (
        <p
          className="form-error"
          role="alert"
        >
          {error}
        </p>
      )}

      <AppToast
        message={success ?? ''}
      />

      <div className="va-resolve-row">
        <label>
          Pass token / QR value

          <input
            value={passToken}
            onChange={(event) =>
              setPassToken(
                event.target.value,
              )
            }
            placeholder="…/participant-status/<token> or 64-hex token"
          />
        </label>

        <button
          type="button"
          className="primary"
          onClick={() =>
            void resolvePass()
          }
        >
          Load pass
        </button>

        <button
          type="button"
          className="secondary"
          onClick={() =>
            setScannerOpen(true)
          }
        >
          Scan QR with camera
        </button>
      </div>

      <p className="va-resolve-hint">
        Paste the full QR value or the hex
        token from the pass.
      </p>

      <label>
        Or choose from station queue

        <select
          value={selectedId}
          onChange={(event) =>
            onSelect(
              event.target.value,
            )
          }
        >
          <option
            value=""
            disabled
          >
            Select participant
          </option>

          {queue.map((row) => (
            <option
              key={row.registrationId}
              value={row.registrationId}
            >
              #{row.queueNumber ?? '—'}{' '}
              {row.participantDisplayName}
              {row.existingResult
                ? ` · ${row.existingResult.overallFlag}`
                : ''}
            </option>
          ))}
        </select>
      </label>

      {selected && (
        <p>
          Screening{' '}
          <strong>
            {selected.participantDisplayName}
          </strong>

          {selected.passToken ? (
            <>
              {' '}
              · pass{' '}
              <code>
                {selected.passToken}
              </code>
            </>
          ) : null}
        </p>
      )}

      <StationCameraScanner
        open={scannerOpen}
        onOpenChange={setScannerOpen}
        onScan={onCameraScan}
      />
    </section>
  );
}

/**
 * ============================================================================
 * Station Page Frame
 * ============================================================================
 */

export function StationPageFrame({
  eventId,
  title,
  eyebrow,
  description,
  eventName,
  instructionsOpen,
  onToggleInstructions,
  instructions,
  error,
  success,
  handoff,
  children,
}: {
  eventId: string;
  title: string;
  eyebrow: string;
  description: string;
  eventName: string;
  instructionsOpen: boolean;
  onToggleInstructions: () => void;
  instructions: ReactNode;
  error: string | null;
  success: string | null;
  handoff?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="page-frame narrow">
      <div className="page-heading">
        <div>
          <p className="eyebrow">
            {eyebrow}
          </p>

          <h1>{title}</h1>

          <p>
            {eventName || 'Loading event…'} —{' '}
            {description}
          </p>
        </div>

        <div className="action-cluster">
          <button
            type="button"
            className="secondary"
            onClick={
              onToggleInstructions
            }
            aria-expanded={
              instructionsOpen
            }
          >
            Instructions
          </button>

          <Link
            className="secondary"
            to={`/events/${eventId}`}
          >
            Back to event
          </Link>
        </div>
      </div>

      {instructionsOpen && (
        <aside
          className="detail-panel"
          style={{ marginBottom: 24 }}
        >
          <h2>
            Station instructions
          </h2>

          {instructions}
        </aside>
      )}

      {error && (
        <p
          className="form-error"
          role="alert"
        >
          {error}
        </p>
      )}

      <AppToast
        message={success ?? ''}
      />

      {success && handoff}

      {children}
    </div>
  );
}

/**
 * ============================================================================
 * Load Station Context
 * ============================================================================
 */

export async function loadStationContext(
  eventId: string,
  stationType: StationType,
  label: string,
  selectedId: string,
): Promise<{
  eventName: string;
  station: Station;
  stations: Station[];
  queue: QueueRegistration[];
  nextSelectedId: string;
}> {
  try {
    const stationsPayload =
      await screeningApi.listStations(
        eventId,
      );

    const station =
      stationsPayload.stations.find(
        (item) =>
          item.stationType ===
          stationType,
      );

    if (!station) {
      throw new Error(
        `${label} station is not configured for this event.`,
      );
    }

    const queuePayload =
      await screeningApi.listQueue(
        eventId,
        station.stationId,
      );

    return {
      eventName:
        stationsPayload.event.name,

      station,

      stations:
        stationsPayload.stations,

      queue:
        queuePayload.registrations,

      nextSelectedId:
        selectedId ||
        queuePayload.registrations[0]
          ?.registrationId ||
        '',
    };
  } catch (error) {
    if (!isNetworkError(error)) {
      throw error;
    }

    const ownerId =
      getStoredSession()?.user.id;

    const offline = ownerId
      ? await getOfflineStationContext(
          ownerId,
          eventId,
          stationType,
        )
      : null;

    if (!offline) {
      throw error;
    }

    return {
      ...offline,

      nextSelectedId:
        selectedId ||
        offline.queue[0]
          ?.registrationId ||
        '',
    };
  }
}

/**
 * ============================================================================
 * Form Helper
 * ============================================================================
 */

export function preventDefaultSubmit(
  handler: () => Promise<void>,
) {
  return (event: FormEvent) => {
    event.preventDefault();
    void handler();
  };
}

/**
 * ============================================================================
 * Station Ordering Fallback
 * ============================================================================
 */

function nextStationTypes(
  currentStationType: StationType,
  stations?: Station[],
): StationType[] {
  if (!stations || stations.length === 0) {
    return [];
  }

  const orderedStations = [
    ...stations,
  ]
    .filter((station) => station.isActive)
    .sort(
      (left, right) =>
        left.stationOrder -
        right.stationOrder,
    );

  const currentIndex =
    orderedStations.findIndex(
      (station) =>
        station.stationType ===
        currentStationType,
    );

  if (currentIndex < 0) {
    return [];
  }

  return orderedStations
    .slice(currentIndex + 1)
    .map(
      (station) =>
        station.stationType,
    )
    .filter(
      (stationType) =>
        stationType === 'CUSTOM' ||
        Boolean(
          STATION_PATH_SLUG[
            stationType
          ],
        ),
    );
}