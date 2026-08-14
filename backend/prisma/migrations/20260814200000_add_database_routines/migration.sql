-- Database routines are intentionally narrow: authorization remains in the API,
-- while PostgreSQL owns aggregate computation and relational invariants.

CREATE OR REPLACE FUNCTION "vsms_event_queue_statistics"(
  p_event_id UUID,
  p_from TIMESTAMPTZ,
  p_to TIMESTAMPTZ
)
RETURNS TABLE (
  waiting BIGINT,
  active BIGINT,
  completed BIGINT,
  skipped BIGINT,
  wait_p50 DOUBLE PRECISION,
  wait_p90 DOUBLE PRECISION,
  service_p50 DOUBLE PRECISION,
  service_p90 DOUBLE PRECISION
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_event_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22004',
      MESSAGE = 'event id is required';
  END IF;

  IF p_from IS NULL OR p_to IS NULL OR p_from >= p_to THEN
    RAISE EXCEPTION USING
      ERRCODE = '22007',
      MESSAGE = 'analytics range must have a start before its end';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public."events" event WHERE event."event_id" = p_event_id
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23503',
      MESSAGE = 'analytics event does not exist';
  END IF;

  RETURN QUERY
  SELECT
    COUNT(*) FILTER (WHERE queue."status" = 'WAITING')::BIGINT,
    COUNT(*) FILTER (WHERE queue."status" IN ('CALLED', 'IN_PROGRESS'))::BIGINT,
    COUNT(*) FILTER (
      WHERE queue."status" = 'COMPLETED'
        AND queue."completed_at" >= p_from
        AND queue."completed_at" < p_to
    )::BIGINT,
    COUNT(*) FILTER (WHERE queue."status" = 'SKIPPED')::BIGINT,
    percentile_cont(0.50) WITHIN GROUP (
      ORDER BY (EXTRACT(EPOCH FROM (COALESCE(queue."started_at", queue."called_at") - queue."entered_at")) / 60.0)::DOUBLE PRECISION
    ) FILTER (
      WHERE COALESCE(queue."started_at", queue."called_at") >= queue."entered_at"
    ),
    percentile_cont(0.90) WITHIN GROUP (
      ORDER BY (EXTRACT(EPOCH FROM (COALESCE(queue."started_at", queue."called_at") - queue."entered_at")) / 60.0)::DOUBLE PRECISION
    ) FILTER (
      WHERE COALESCE(queue."started_at", queue."called_at") >= queue."entered_at"
    ),
    percentile_cont(0.50) WITHIN GROUP (
      ORDER BY (EXTRACT(EPOCH FROM (queue."completed_at" - COALESCE(queue."started_at", queue."called_at"))) / 60.0)::DOUBLE PRECISION
    ) FILTER (
      WHERE queue."completed_at" >= COALESCE(queue."started_at", queue."called_at")
    ),
    percentile_cont(0.90) WITHIN GROUP (
      ORDER BY (EXTRACT(EPOCH FROM (queue."completed_at" - COALESCE(queue."started_at", queue."called_at"))) / 60.0)::DOUBLE PRECISION
    ) FILTER (
      WHERE queue."completed_at" >= COALESCE(queue."started_at", queue."called_at")
    )
  FROM public."queue_entries" queue
  JOIN public."event_registrations" registration
    ON registration."registration_id" = queue."registration_id"
  WHERE registration."event_id" = p_event_id
    AND registration."registration_status" <> 'CANCELLED'
    AND queue."entered_at" >= p_from
    AND queue."entered_at" < p_to;
END;
$$;

COMMENT ON FUNCTION "vsms_event_queue_statistics"(UUID, TIMESTAMPTZ, TIMESTAMPTZ) IS
  'Returns PII-free queue counts and timing percentiles for one authorized event and half-open interval.';

CREATE OR REPLACE PROCEDURE "sp_vsms_cancel_active_registration_queue"(
  p_event_id UUID,
  p_registration_id UUID,
  p_cancelled_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_event_id IS NULL OR p_registration_id IS NULL OR p_cancelled_at IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22004',
      MESSAGE = 'event id, registration id, and cancellation time are required';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public."event_registrations" registration
    WHERE registration."registration_id" = p_registration_id
      AND registration."event_id" = p_event_id
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23503',
      MESSAGE = 'registration does not belong to the supplied event';
  END IF;

  UPDATE public."queue_entries" queue
  SET
    "status" = 'CANCELLED',
    "left_queue_at" = COALESCE(queue."left_queue_at", p_cancelled_at)
  WHERE queue."registration_id" = p_registration_id
    AND queue."status" IN ('WAITING', 'CALLED', 'IN_PROGRESS');
END;
$$;

COMMENT ON PROCEDURE "sp_vsms_cancel_active_registration_queue"(UUID, UUID, TIMESTAMPTZ) IS
  'Closes any active queue row when an authorized service terminates a participant journey.';

CREATE OR REPLACE FUNCTION "vsms_assert_registration_station_scope"()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  registration_event_id UUID;
  station_event_id UUID;
BEGIN
  SELECT registration."event_id"
  INTO registration_event_id
  FROM public."event_registrations" registration
  WHERE registration."registration_id" = NEW."registration_id";

  SELECT station."event_id"
  INTO station_event_id
  FROM public."stations" station
  WHERE station."station_id" = NEW."station_id";

  IF registration_event_id IS DISTINCT FROM station_event_id THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = format(
        'station %s and registration %s must belong to the same event',
        NEW."station_id",
        NEW."registration_id"
      );
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION "vsms_assert_queue_movement_scope"()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  registration_event_id UUID;
  from_event_id UUID;
  to_event_id UUID;
BEGIN
  SELECT registration."event_id"
  INTO registration_event_id
  FROM public."event_registrations" registration
  WHERE registration."registration_id" = NEW."registration_id";

  SELECT station."event_id"
  INTO from_event_id
  FROM public."stations" station
  WHERE station."station_id" = NEW."from_station_id";

  SELECT station."event_id"
  INTO to_event_id
  FROM public."stations" station
  WHERE station."station_id" = NEW."to_station_id";

  IF registration_event_id IS DISTINCT FROM from_event_id
    OR registration_event_id IS DISTINCT FROM to_event_id THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = format(
        'queue movement stations and registration %s must belong to the same event',
        NEW."registration_id"
      );
  END IF;

  RETURN NEW;
END;
$$;

-- Fail the migration instead of silently accepting historical cross-event data.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public."registration_route_steps" route_step
    JOIN public."event_registrations" registration USING ("registration_id")
    JOIN public."stations" station USING ("station_id")
    WHERE registration."event_id" <> station."event_id"
  ) OR EXISTS (
    SELECT 1
    FROM public."queue_entries" queue
    JOIN public."event_registrations" registration USING ("registration_id")
    JOIN public."stations" station USING ("station_id")
    WHERE registration."event_id" <> station."event_id"
  ) OR EXISTS (
    SELECT 1
    FROM public."screening_results" result
    JOIN public."event_registrations" registration USING ("registration_id")
    JOIN public."stations" station USING ("station_id")
    WHERE registration."event_id" <> station."event_id"
  ) OR EXISTS (
    SELECT 1
    FROM public."queue_movements" movement
    JOIN public."event_registrations" registration USING ("registration_id")
    JOIN public."stations" from_station ON from_station."station_id" = movement."from_station_id"
    JOIN public."stations" to_station ON to_station."station_id" = movement."to_station_id"
    WHERE registration."event_id" <> from_station."event_id"
      OR registration."event_id" <> to_station."event_id"
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'cross-event station data must be corrected before installing VSMS scope constraints';
  END IF;
END;
$$;

CREATE TRIGGER "registration_route_steps_event_scope_check"
BEFORE INSERT OR UPDATE OF "registration_id", "station_id"
ON public."registration_route_steps"
FOR EACH ROW
EXECUTE FUNCTION "vsms_assert_registration_station_scope"();

CREATE TRIGGER "queue_entries_event_scope_check"
BEFORE INSERT OR UPDATE OF "registration_id", "station_id"
ON public."queue_entries"
FOR EACH ROW
EXECUTE FUNCTION "vsms_assert_registration_station_scope"();

CREATE TRIGGER "screening_results_event_scope_check"
BEFORE INSERT OR UPDATE OF "registration_id", "station_id"
ON public."screening_results"
FOR EACH ROW
EXECUTE FUNCTION "vsms_assert_registration_station_scope"();

CREATE TRIGGER "queue_movements_event_scope_check"
BEFORE INSERT OR UPDATE OF "registration_id", "from_station_id", "to_station_id"
ON public."queue_movements"
FOR EACH ROW
EXECUTE FUNCTION "vsms_assert_queue_movement_scope"();

COMMENT ON FUNCTION "vsms_assert_registration_station_scope"() IS
  'Rejects route, queue, and result records whose station is outside the registration event.';

COMMENT ON FUNCTION "vsms_assert_queue_movement_scope"() IS
  'Rejects queue movements whose source or destination station is outside the registration event.';
