-- Mutations are centralized here so concurrent registrations cannot oversubscribe an event.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE INDEX IF NOT EXISTS "event_registrations_waitlist_order_idx"
  ON "event_registrations" ("event_id", "created_at", "registration_id")
  WHERE "registration_status" = 'WAITLISTED';

CREATE OR REPLACE FUNCTION "register_participant_for_event"(
  p_participant_id UUID, p_event_id UUID, p_registered_by UUID,
  p_idempotency_key VARCHAR(100), p_consent_acknowledged BOOLEAN
)
RETURNS TABLE (registration_id UUID, registration_status "EventRegistrationStatus", idempotent_replay BOOLEAN)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_event "events"%ROWTYPE;
  v_registration "event_registrations"%ROWTYPE;
  v_taken_count INTEGER;
  v_status "EventRegistrationStatus";
BEGIN
  SELECT * INTO v_event FROM "events" WHERE "event_id" = p_event_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'REGISTRATION_EVENT_NOT_FOUND'; END IF;

  SELECT * INTO v_registration FROM "event_registrations"
  WHERE "registered_by" = p_registered_by AND "idempotency_key" = p_idempotency_key;
  IF FOUND THEN
    IF v_registration."participant_id" <> p_participant_id OR v_registration."event_id" <> p_event_id THEN
      RAISE EXCEPTION 'REGISTRATION_IDEMPOTENCY_CONFLICT';
    END IF;
    RETURN QUERY SELECT v_registration."registration_id", v_registration."registration_status", TRUE;
    RETURN;
  END IF;

  IF v_event."status" NOT IN ('PUBLISHED', 'IN_PROGRESS') THEN RAISE EXCEPTION 'REGISTRATION_EVENT_NOT_OPEN'; END IF;
  IF p_consent_acknowledged IS NOT TRUE THEN RAISE EXCEPTION 'REGISTRATION_CONSENT_REQUIRED'; END IF;
  IF NOT EXISTS (SELECT 1 FROM "participants" WHERE "participant_id" = p_participant_id AND "status" = 'ACTIVE') THEN
    RAISE EXCEPTION 'REGISTRATION_PARTICIPANT_NOT_ACTIVE';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "participant_emergency_contacts" WHERE "participant_id" = p_participant_id AND "status" = 'ACTIVE') THEN
    RAISE EXCEPTION 'REGISTRATION_EMERGENCY_CONTACT_REQUIRED';
  END IF;
  IF EXISTS (SELECT 1 FROM "event_registrations" WHERE "participant_id" = p_participant_id AND "event_id" = p_event_id) THEN
    RAISE EXCEPTION 'REGISTRATION_DUPLICATE';
  END IF;

  SELECT COUNT(*) INTO v_taken_count FROM "event_registrations"
  WHERE "event_id" = p_event_id AND "registration_status" IN ('SIGNED_UP', 'CHECKED_IN', 'COMPLETED');
  v_status := CASE WHEN v_taken_count < v_event."capacity" THEN 'SIGNED_UP'::"EventRegistrationStatus" ELSE 'WAITLISTED'::"EventRegistrationStatus" END;

  INSERT INTO "event_registrations" (
    "registration_id", "event_id", "participant_id", "registered_by", "registration_status",
    "consent_acknowledged", "idempotency_key", "updated_at"
  ) VALUES (
    gen_random_uuid(), p_event_id, p_participant_id, p_registered_by, v_status,
    TRUE, p_idempotency_key, NOW()
  ) RETURNING * INTO v_registration;

  INSERT INTO "registration_status_history" (
    "history_id", "registration_id", "from_status", "to_status", "changed_by", "reason"
  ) VALUES (
    gen_random_uuid(), v_registration."registration_id", NULL, v_status, p_registered_by,
    CASE WHEN v_status = 'WAITLISTED' THEN 'Event capacity reached; added to waitlist' ELSE 'Initial registration' END
  );
  RETURN QUERY SELECT v_registration."registration_id", v_status, FALSE;
END;
$$;

CREATE OR REPLACE FUNCTION "cancel_event_registration"(
  p_registration_id UUID, p_changed_by UUID, p_reason VARCHAR(200)
)
RETURNS TABLE (cancelled_registration_id UUID, promoted_registration_id UUID)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_registration "event_registrations"%ROWTYPE;
  v_promoted "event_registrations"%ROWTYPE;
BEGIN
  -- The parent event lock serializes cancellation and waitlist promotion.
  SELECT registration.* INTO v_registration
  FROM "event_registrations" AS registration
  JOIN "events" AS event ON event."event_id" = registration."event_id"
  WHERE registration."registration_id" = p_registration_id
  FOR UPDATE OF registration, event;
  IF NOT FOUND THEN RAISE EXCEPTION 'REGISTRATION_NOT_FOUND'; END IF;
  IF v_registration."registration_status" NOT IN ('SIGNED_UP', 'WAITLISTED') THEN
    RAISE EXCEPTION 'REGISTRATION_CANNOT_BE_CANCELLED';
  END IF;

  UPDATE "event_registrations"
  SET "registration_status" = 'CANCELLED', "checked_in" = FALSE, "checked_in_at" = NULL, "updated_at" = NOW()
  WHERE "registration_id" = p_registration_id;
  INSERT INTO "registration_status_history" (
    "history_id", "registration_id", "from_status", "to_status", "changed_by", "reason"
  ) VALUES (
    gen_random_uuid(), p_registration_id, v_registration."registration_status", 'CANCELLED', p_changed_by,
    COALESCE(NULLIF(BTRIM(p_reason), ''), 'Registration cancelled')
  );

  IF v_registration."registration_status" = 'SIGNED_UP' THEN
    SELECT * INTO v_promoted FROM "event_registrations"
    WHERE "event_id" = v_registration."event_id" AND "registration_status" = 'WAITLISTED'
    ORDER BY "created_at", "registration_id" LIMIT 1 FOR UPDATE;
    IF FOUND THEN
      UPDATE "event_registrations" SET "registration_status" = 'SIGNED_UP', "updated_at" = NOW()
      WHERE "registration_id" = v_promoted."registration_id";
      INSERT INTO "registration_status_history" (
        "history_id", "registration_id", "from_status", "to_status", "changed_by", "reason"
      ) VALUES (
        gen_random_uuid(), v_promoted."registration_id", 'WAITLISTED', 'SIGNED_UP', p_changed_by,
        'Promoted after a registration was cancelled'
      );
    END IF;
  END IF;
  RETURN QUERY SELECT p_registration_id, v_promoted."registration_id";
END;
$$;

CREATE OR REPLACE FUNCTION "check_in_event_registration"(
  p_registration_id UUID, p_event_id UUID, p_changed_by UUID
)
RETURNS TABLE (
  registration_id UUID, event_id UUID, registration_status "EventRegistrationStatus",
  checked_in BOOLEAN, checked_in_at TIMESTAMPTZ, queue_number INTEGER
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE v_registration "event_registrations"%ROWTYPE;
BEGIN
  SELECT * INTO v_registration FROM "event_registrations"
  WHERE "registration_id" = p_registration_id AND "event_id" = p_event_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'REGISTRATION_NOT_FOUND'; END IF;
  IF v_registration."registration_status" <> 'SIGNED_UP' OR v_registration."checked_in" THEN
    RAISE EXCEPTION 'REGISTRATION_CHECKIN_CONFLICT';
  END IF;
  UPDATE "event_registrations"
  SET "registration_status" = 'CHECKED_IN', "checked_in" = TRUE, "checked_in_at" = NOW(), "updated_at" = NOW()
  WHERE "registration_id" = p_registration_id RETURNING * INTO v_registration;
  INSERT INTO "registration_status_history" (
    "history_id", "registration_id", "from_status", "to_status", "changed_by", "reason"
  ) VALUES (gen_random_uuid(), p_registration_id, 'SIGNED_UP', 'CHECKED_IN', p_changed_by, 'Manual check-in');
  RETURN QUERY SELECT
    v_registration."registration_id", v_registration."event_id", v_registration."registration_status",
    v_registration."checked_in", v_registration."checked_in_at", v_registration."queue_number";
END;
$$;

CREATE OR REPLACE FUNCTION "get_event_registration_summary"(p_event_id UUID)
RETURNS TABLE (
  event_id UUID, capacity INTEGER, signed_up_count BIGINT, waitlisted_count BIGINT,
  checked_in_count BIGINT, completed_count BIGINT, cancelled_count BIGINT,
  filled_count BIGINT, remaining_capacity INTEGER
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
  SELECT
    event."event_id", event."capacity",
    COUNT(*) FILTER (WHERE registration."registration_status" = 'SIGNED_UP'),
    COUNT(*) FILTER (WHERE registration."registration_status" = 'WAITLISTED'),
    COUNT(*) FILTER (WHERE registration."registration_status" = 'CHECKED_IN'),
    COUNT(*) FILTER (WHERE registration."registration_status" = 'COMPLETED'),
    COUNT(*) FILTER (WHERE registration."registration_status" = 'CANCELLED'),
    COUNT(*) FILTER (WHERE registration."registration_status" IN ('SIGNED_UP', 'CHECKED_IN', 'COMPLETED')),
    GREATEST(event."capacity" - COUNT(*) FILTER (
      WHERE registration."registration_status" IN ('SIGNED_UP', 'CHECKED_IN', 'COMPLETED')
    )::INTEGER, 0)
  FROM "events" AS event
  LEFT JOIN "event_registrations" AS registration ON registration."event_id" = event."event_id"
  WHERE event."event_id" = p_event_id
  GROUP BY event."event_id", event."capacity";
$$;

REVOKE ALL ON FUNCTION "register_participant_for_event"(UUID, UUID, UUID, VARCHAR, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION "cancel_event_registration"(UUID, UUID, VARCHAR) FROM PUBLIC;
REVOKE ALL ON FUNCTION "check_in_event_registration"(UUID, UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION "get_event_registration_summary"(UUID) FROM PUBLIC;
