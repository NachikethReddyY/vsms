-- Keep registration cancellation, waitlist promotion, QR revocation, and
-- status history in one database-owned atomic operation.

DROP FUNCTION public.cancel_event_registration(UUID, UUID, VARCHAR);

CREATE FUNCTION public.cancel_event_registration(
  p_registration_id UUID,
  p_changed_by UUID,
  p_reason VARCHAR(200)
)
RETURNS TABLE (
  cancelled_registration_id UUID,
  promoted_registration_id UUID,
  revoked_qr_count BIGINT,
  changed_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_registration public.event_registrations%ROWTYPE;
  v_promoted public.event_registrations%ROWTYPE;
  v_reason VARCHAR(200);
  v_revoked_qr_count BIGINT := 0;
  -- Match the millisecond precision used by Prisma's TIMESTAMPTZ(3) columns
  -- so the returned receipt and every affected row expose one exact timestamp.
  v_changed_at TIMESTAMPTZ := date_trunc('milliseconds', clock_timestamp());
BEGIN
  IF p_registration_id IS NULL OR p_changed_by IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22004',
      MESSAGE = 'REGISTRATION_ARGUMENT_REQUIRED';
  END IF;

  v_reason := COALESCE(NULLIF(BTRIM(p_reason), ''), 'Registration cancelled');

  -- The event lock serializes cancellation with capacity allocation and
  -- waitlist promotion for every registration in the event.
  SELECT registration.* INTO v_registration
  FROM public.event_registrations AS registration
  JOIN public.events AS event ON event.event_id = registration.event_id
  WHERE registration.registration_id = p_registration_id
  FOR UPDATE OF registration, event;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'REGISTRATION_NOT_FOUND';
  END IF;

  IF v_registration.registration_status NOT IN ('SIGNED_UP', 'WAITLISTED') THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'REGISTRATION_CANNOT_BE_CANCELLED';
  END IF;

  UPDATE public.event_registrations AS registration
  SET registration_status = 'CANCELLED',
      checked_in = FALSE,
      checked_in_at = NULL,
      updated_at = v_changed_at
  WHERE registration.registration_id = p_registration_id;

  UPDATE public.qr_code_passes AS pass
  SET is_active = FALSE,
      revoked_at = v_changed_at,
      revoked_by = p_changed_by,
      revoked_reason = 'Registration cancelled'
  WHERE pass.registration_id = p_registration_id
    AND pass.is_active = TRUE;
  GET DIAGNOSTICS v_revoked_qr_count = ROW_COUNT;

  INSERT INTO public.registration_status_history (
    history_id,
    registration_id,
    from_status,
    to_status,
    changed_by,
    reason,
    occurred_at
  ) VALUES (
    gen_random_uuid(),
    p_registration_id,
    v_registration.registration_status,
    'CANCELLED',
    p_changed_by,
    v_reason,
    v_changed_at
  );

  IF v_registration.registration_status = 'SIGNED_UP' THEN
    SELECT registration.* INTO v_promoted
    FROM public.event_registrations AS registration
    WHERE registration.event_id = v_registration.event_id
      AND registration.registration_status = 'WAITLISTED'
    ORDER BY registration.created_at, registration.registration_id
    LIMIT 1
    FOR UPDATE;

    IF FOUND THEN
      UPDATE public.event_registrations AS registration
      SET registration_status = 'SIGNED_UP',
          updated_at = v_changed_at
      WHERE registration.registration_id = v_promoted.registration_id;

      INSERT INTO public.registration_status_history (
        history_id,
        registration_id,
        from_status,
        to_status,
        changed_by,
        reason,
        occurred_at
      ) VALUES (
        gen_random_uuid(),
        v_promoted.registration_id,
        'WAITLISTED',
        'SIGNED_UP',
        p_changed_by,
        'Promoted after a registration was cancelled',
        v_changed_at
      );
    END IF;
  END IF;

  RETURN QUERY SELECT
    p_registration_id,
    v_promoted.registration_id,
    v_revoked_qr_count,
    v_changed_at;
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_event_registration(UUID, UUID, VARCHAR) FROM PUBLIC;

-- Existing deployments may already have the restricted application role.
-- Regrant only the replaced routine without requiring that role in local CI.
DO $grant_runtime$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'vsms_runtime') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.cancel_event_registration(UUID, UUID, VARCHAR) TO vsms_runtime';
  END IF;
END
$grant_runtime$;

COMMENT ON FUNCTION public.register_participant_for_event(UUID, UUID, UUID, VARCHAR) IS
  'Atomically allocates event capacity, creates a registration, and records its initial status with idempotent replay.';
COMMENT ON FUNCTION public.cancel_event_registration(UUID, UUID, VARCHAR) IS
  'Atomically cancels an eligible registration, revokes active QR passes, promotes the oldest waitlisted registration, and records both status transitions.';
COMMENT ON FUNCTION public.check_in_event_registration(UUID, UUID, UUID) IS
  'Atomically checks in a signed-up registration and records the status transition.';
COMMENT ON FUNCTION public.get_event_registration_summary(UUID) IS
  'Returns capacity and registration lifecycle counts for one event without participant identity data.';
