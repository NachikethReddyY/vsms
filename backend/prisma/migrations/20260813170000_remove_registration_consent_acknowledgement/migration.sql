-- Remove the final registration-level participant consent remnant.

DROP FUNCTION IF EXISTS public.register_participant_for_event(UUID, UUID, UUID, VARCHAR, BOOLEAN);

ALTER TABLE public.event_registrations
  DROP COLUMN IF EXISTS consent_acknowledged;

CREATE OR REPLACE FUNCTION public.register_participant_for_event(
  p_participant_id UUID,
  p_event_id UUID,
  p_registered_by UUID,
  p_idempotency_key VARCHAR(100)
)
RETURNS TABLE (
  registration_id UUID,
  registration_status public."EventRegistrationStatus",
  idempotent_replay BOOLEAN
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_event public.events%ROWTYPE;
  v_registration public.event_registrations%ROWTYPE;
  v_taken_count INTEGER;
  v_status public."EventRegistrationStatus";
BEGIN
  SELECT * INTO v_event FROM public.events AS event WHERE event.event_id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'REGISTRATION_EVENT_NOT_FOUND'; END IF;

  SELECT * INTO v_registration FROM public.event_registrations AS registration
  WHERE registration.registered_by = p_registered_by
    AND registration.idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_registration.participant_id <> p_participant_id OR v_registration.event_id <> p_event_id THEN
      RAISE EXCEPTION 'REGISTRATION_IDEMPOTENCY_CONFLICT';
    END IF;
    RETURN QUERY SELECT v_registration.registration_id, v_registration.registration_status, TRUE;
    RETURN;
  END IF;

  IF v_event.status NOT IN ('PUBLISHED', 'IN_PROGRESS') THEN RAISE EXCEPTION 'REGISTRATION_EVENT_NOT_OPEN'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.participants AS participant
    WHERE participant.participant_id = p_participant_id AND participant.status = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'REGISTRATION_PARTICIPANT_NOT_ACTIVE';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.participant_emergency_contacts AS contact
    WHERE contact.participant_id = p_participant_id AND contact.status = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'REGISTRATION_EMERGENCY_CONTACT_REQUIRED';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.event_registrations AS registration
    WHERE registration.participant_id = p_participant_id AND registration.event_id = p_event_id
  ) THEN
    RAISE EXCEPTION 'REGISTRATION_DUPLICATE';
  END IF;

  SELECT COUNT(*) INTO v_taken_count FROM public.event_registrations AS registration
  WHERE registration.event_id = p_event_id
    AND registration.registration_status IN ('SIGNED_UP', 'CHECKED_IN', 'COMPLETED');
  v_status := CASE
    WHEN v_taken_count < v_event.capacity THEN 'SIGNED_UP'::public."EventRegistrationStatus"
    ELSE 'WAITLISTED'::public."EventRegistrationStatus"
  END;

  INSERT INTO public.event_registrations (
    registration_id,
    event_id,
    participant_id,
    registered_by,
    registration_status,
    idempotency_key,
    updated_at
  ) VALUES (
    gen_random_uuid(),
    p_event_id,
    p_participant_id,
    p_registered_by,
    v_status,
    p_idempotency_key,
    NOW()
  ) RETURNING * INTO v_registration;

  INSERT INTO public.registration_status_history (
    history_id,
    registration_id,
    from_status,
    to_status,
    changed_by,
    reason
  ) VALUES (
    gen_random_uuid(),
    v_registration.registration_id,
    NULL,
    v_status,
    p_registered_by,
    CASE
      WHEN v_status = 'WAITLISTED' THEN 'Event capacity reached; added to waitlist'
      ELSE 'Initial registration'
    END
  );

  RETURN QUERY SELECT v_registration.registration_id, v_status, FALSE;
END;
$$;

REVOKE ALL ON FUNCTION public.register_participant_for_event(UUID, UUID, UUID, VARCHAR) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.check_in_event_registration(
  p_registration_id UUID,
  p_event_id UUID,
  p_changed_by UUID
)
RETURNS TABLE (
  registration_id UUID,
  event_id UUID,
  registration_status public."EventRegistrationStatus",
  checked_in BOOLEAN,
  checked_in_at TIMESTAMPTZ,
  queue_number INTEGER
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_registration public.event_registrations%ROWTYPE;
BEGIN
  SELECT registration.* INTO v_registration
  FROM public.event_registrations AS registration
  WHERE registration.registration_id = p_registration_id
    AND registration.event_id = p_event_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'REGISTRATION_NOT_FOUND'; END IF;
  IF v_registration.registration_status <> 'SIGNED_UP' OR v_registration.checked_in THEN
    RAISE EXCEPTION 'REGISTRATION_CHECKIN_CONFLICT';
  END IF;

  UPDATE public.event_registrations AS registration
  SET registration_status = 'CHECKED_IN',
      checked_in = TRUE,
      checked_in_at = NOW(),
      updated_at = NOW()
  WHERE registration.registration_id = p_registration_id
  RETURNING registration.* INTO v_registration;

  INSERT INTO public.registration_status_history (
    history_id,
    registration_id,
    from_status,
    to_status,
    changed_by,
    reason
  ) VALUES (
    gen_random_uuid(),
    p_registration_id,
    'SIGNED_UP',
    'CHECKED_IN',
    p_changed_by,
    'Manual check-in'
  );

  RETURN QUERY SELECT
    v_registration.registration_id,
    v_registration.event_id,
    v_registration.registration_status,
    v_registration.checked_in,
    v_registration.checked_in_at,
    v_registration.queue_number;
END;
$$;

REVOKE ALL ON FUNCTION public.check_in_event_registration(UUID, UUID, UUID) FROM PUBLIC;
