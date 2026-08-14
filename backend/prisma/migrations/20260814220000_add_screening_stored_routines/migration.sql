-- Screening-domain routines: PostgreSQL owns result lock and completeness.
-- Clinical flagging stays in screeningService.js. Authorization stays in the API.

CREATE OR REPLACE FUNCTION "vsms_screening_results_complete"(
  p_event_id UUID,
  p_registration_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_event_id IS NULL OR p_registration_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22004',
      MESSAGE = 'event id and registration id are required';
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

  RETURN EXISTS (
    SELECT 1
    FROM public."registration_route_steps" route_step
    WHERE route_step."registration_id" = p_registration_id
  ) AND NOT EXISTS (
    SELECT 1
    FROM public."registration_route_steps" route_step
    WHERE route_step."registration_id" = p_registration_id
      AND NOT EXISTS (
        SELECT 1
        FROM public."screening_results" result
        WHERE result."registration_id" = route_step."registration_id"
          AND result."station_id" = route_step."station_id"
      )
  );
END;
$$;

COMMENT ON FUNCTION "vsms_screening_results_complete"(UUID, UUID) IS
  'Returns true only when every route station for an event-scoped registration has a screening_results row. Skipped steps without a result keep this false even if the route timestamps are complete.';

CREATE OR REPLACE FUNCTION "vsms_prevent_reviewed_screening_mutation"()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  target_registration_id UUID;
BEGIN
  target_registration_id := COALESCE(NEW."registration_id", OLD."registration_id");

  IF EXISTS (
    SELECT 1
    FROM public."reviews" review
    WHERE review."registration_id" = target_registration_id
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'screening results cannot be changed after clinical review';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "screening_results_reviewed_lock" ON public."screening_results";
CREATE TRIGGER "screening_results_reviewed_lock"
BEFORE INSERT OR UPDATE OR DELETE ON public."screening_results"
FOR EACH ROW
EXECUTE FUNCTION "vsms_prevent_reviewed_screening_mutation"();

COMMENT ON FUNCTION "vsms_prevent_reviewed_screening_mutation"() IS
  'Blocks insert, update, and delete of screening_results after a clinical review exists for the registration.';

CREATE OR REPLACE PROCEDURE "sp_vsms_audit_screening_flag"(
  p_result_id UUID,
  p_actor_user_id UUID,
  OUT p_audit_id UUID
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  result_row public."screening_results"%ROWTYPE;
BEGIN
  p_audit_id := NULL;

  IF p_result_id IS NULL OR p_actor_user_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22004',
      MESSAGE = 'result id and actor user id are required';
  END IF;

  SELECT result.* INTO result_row
  FROM public."screening_results" result
  WHERE result."result_id" = p_result_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '23503',
      MESSAGE = 'screening result does not exist';
  END IF;

  INSERT INTO public."audit_logs" (
    "audit_id",
    "user_id",
    "action",
    "resource",
    "entity_name",
    "entity_id",
    "outcome",
    "details"
  )
  VALUES (
    gen_random_uuid(),
    p_actor_user_id,
    'SCREENING_FLAG_DB_RECORDED',
    'screening_results',
    'screening_results',
    result_row."result_id",
    'SUCCESS'::"AuthOutcome",
    jsonb_build_object(
      'stationId', result_row."station_id",
      'registrationId', result_row."registration_id",
      'overallFlag', result_row."overall_flag"::text,
      'isFlagged', result_row."is_flagged"
    )
  )
  RETURNING "audit_id" INTO p_audit_id;
END;
$$;

COMMENT ON PROCEDURE "sp_vsms_audit_screening_flag"(UUID, UUID) IS
  'Writes a PII-free screening flag audit row. Does not store result_data.';

REVOKE ALL ON FUNCTION "vsms_screening_results_complete"(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION "vsms_prevent_reviewed_screening_mutation"() FROM PUBLIC;
REVOKE ALL ON PROCEDURE "sp_vsms_audit_screening_flag"(UUID, UUID) FROM PUBLIC;
