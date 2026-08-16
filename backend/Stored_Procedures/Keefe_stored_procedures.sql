-- =============================================================================
-- ST0528 Database Systems (Project 2)
-- VSMS DATABASE OBJECTS
-- PostgreSQL / PLpgSQL
--
-- MATCHED TO CURRENT VSMS DATABASE SCHEMA
--
-- Main tables used:
--   participants
--   users
--   events
--   event_registrations
--   stations
--   staff_assignments
--   queue_entries
--   queue_movements
--   screening_results
--   reviews
--   referrals
--
-- Includes:
--   1. Stored Procedures
--   2. User-Defined Functions
--   3. Trigger Functions
--   4. Triggers
--   5. Materialized View
--
-- IMPORTANT:
--   PostgreSQL enum parameters are deliberately accepted as TEXT in
--   procedures and explicitly cast when inserted.
--   This avoids the previous:
--
--       ERROR: type stationtype does not exist
--
--   problem caused by unquoted enum type names.
-- =============================================================================


-- =============================================================================
-- 0. EXTENSION
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;


-- =============================================================================
-- 1. CLEAN UP OLD OBJECTS
-- =============================================================================

DROP MATERIALIZED VIEW IF EXISTS mv_event_screening_dashboard CASCADE;

DROP TRIGGER IF EXISTS trg_validate_screening_result
ON screening_results;

DROP TRIGGER IF EXISTS trg_auto_flag_visual_acuity
ON screening_results;

DROP TRIGGER IF EXISTS trg_events_updated_at
ON events;

DROP TRIGGER IF EXISTS trg_event_registrations_updated_at
ON event_registrations;

DROP TRIGGER IF EXISTS trg_screening_results_updated_at
ON screening_results;

DROP TRIGGER IF EXISTS trg_referrals_updated_at
ON referrals;

DROP TRIGGER IF EXISTS trg_reviews_updated_at
ON reviews;


-- =============================================================================
-- 2. USER-DEFINED FUNCTION
--    fn_update_timestamp
-- =============================================================================
-- Automatically maintains updated_at.
--
-- Works with:
--   events
--   event_registrations
--   screening_results
--   referrals
--   reviews
-- =============================================================================

CREATE OR REPLACE FUNCTION fn_update_timestamp()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at := CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;


-- =============================================================================
-- 3. USER-DEFINED FUNCTION
--    fn_get_visual_acuity_category
-- =============================================================================
-- Returns a screening category.
--
-- This does NOT diagnose the participant.
-- It only categorises the recorded screening value.
--
-- Examples:
--   6/6  -> NORMAL
--   6/9  -> MILD_FLAG
--   6/12 -> MODERATE_FLAG
--   6/18 -> SIGNIFICANT_FLAG
-- =============================================================================

CREATE OR REPLACE FUNCTION fn_get_visual_acuity_category(
    p_visual_acuity TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    v_denominator INT;
BEGIN

    IF p_visual_acuity IS NULL
       OR trim(p_visual_acuity) = '' THEN
        RETURN 'NOT_RECORDED';
    END IF;

    BEGIN
        v_denominator :=
            split_part(trim(p_visual_acuity), '/', 2)::INT;
    EXCEPTION
        WHEN OTHERS THEN
            RETURN 'UNKNOWN';
    END;

    IF v_denominator <= 6 THEN
        RETURN 'NORMAL';

    ELSIF v_denominator <= 9 THEN
        RETURN 'MILD_FLAG';

    ELSIF v_denominator <= 12 THEN
        RETURN 'MODERATE_FLAG';

    ELSE
        RETURN 'SIGNIFICANT_FLAG';
    END IF;

END;
$$;


-- =============================================================================
-- 4. USER-DEFINED FUNCTION
--    fn_is_visual_acuity_flagged
-- =============================================================================
-- Determines whether recorded visual acuity should receive a screening flag.
--
-- This is NOT a medical diagnosis.
-- =============================================================================

CREATE OR REPLACE FUNCTION fn_is_visual_acuity_flagged(
    p_left_eye TEXT,
    p_right_eye TEXT,
    p_pinhole_left TEXT DEFAULT NULL,
    p_pinhole_right TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN

    IF fn_get_visual_acuity_category(p_left_eye)
       IN ('MODERATE_FLAG', 'SIGNIFICANT_FLAG')
    THEN
        RETURN TRUE;
    END IF;

    IF fn_get_visual_acuity_category(p_right_eye)
       IN ('MODERATE_FLAG', 'SIGNIFICANT_FLAG')
    THEN
        RETURN TRUE;
    END IF;

    IF p_pinhole_left IS NOT NULL
       AND fn_get_visual_acuity_category(p_pinhole_left)
          IN ('MODERATE_FLAG', 'SIGNIFICANT_FLAG')
    THEN
        RETURN TRUE;
    END IF;

    IF p_pinhole_right IS NOT NULL
       AND fn_get_visual_acuity_category(p_pinhole_right)
          IN ('MODERATE_FLAG', 'SIGNIFICANT_FLAG')
    THEN
        RETURN TRUE;
    END IF;

    RETURN FALSE;

END;
$$;


-- =============================================================================
-- 5. TRIGGER FUNCTION
--    fn_validate_screening_result
-- =============================================================================
-- Validates screening result relationships.
--
-- Rules:
--   1. Registration must exist.
--   2. Station must exist.
--   3. User must exist.
--   4. Registration and station must belong to same event.
--   5. Queue entry, if supplied, must match registration/station.
--   6. result_data cannot be NULL.
-- =============================================================================

CREATE OR REPLACE FUNCTION fn_validate_screening_result()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_registration_event UUID;
    v_station_event UUID;
    v_queue_registration UUID;
    v_queue_station UUID;
BEGIN

    -- ---------------------------------------------------------
    -- Validate result data
    -- ---------------------------------------------------------

    IF NEW.result_data IS NULL THEN
        RAISE EXCEPTION
            'Screening result data cannot be NULL';
    END IF;


    -- ---------------------------------------------------------
    -- Validate registration
    -- ---------------------------------------------------------

    SELECT event_id
    INTO v_registration_event
    FROM event_registrations
    WHERE registration_id = NEW.registration_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'Registration does not exist: %',
            NEW.registration_id;
    END IF;


    -- ---------------------------------------------------------
    -- Validate station
    -- ---------------------------------------------------------

    SELECT event_id
    INTO v_station_event
    FROM stations
    WHERE station_id = NEW.station_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'Station does not exist: %',
            NEW.station_id;
    END IF;


    -- ---------------------------------------------------------
    -- Station and registration must belong to same event
    -- ---------------------------------------------------------

    IF v_registration_event <> v_station_event THEN
        RAISE EXCEPTION
            'Station % does not belong to registration event',
            NEW.station_id;
    END IF;


    -- ---------------------------------------------------------
    -- Validate recording user
    -- ---------------------------------------------------------

    IF NOT EXISTS (
        SELECT 1
        FROM users
        WHERE user_id = NEW.recorded_by_user_id
    ) THEN
        RAISE EXCEPTION
            'Recording user does not exist: %',
            NEW.recorded_by_user_id;
    END IF;


    -- ---------------------------------------------------------
    -- Validate queue entry if supplied
    -- ---------------------------------------------------------

    IF NEW.queue_entry_id IS NOT NULL THEN

        SELECT
            registration_id,
            station_id
        INTO
            v_queue_registration,
            v_queue_station
        FROM queue_entries
        WHERE queue_id = NEW.queue_entry_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION
                'Queue entry does not exist: %',
                NEW.queue_entry_id;
        END IF;

        IF v_queue_registration <> NEW.registration_id THEN
            RAISE EXCEPTION
                'Queue entry does not belong to registration';
        END IF;

        IF v_queue_station <> NEW.station_id THEN
            RAISE EXCEPTION
                'Queue entry does not belong to screening station';
        END IF;

    END IF;


    RETURN NEW;

END;
$$;


-- =============================================================================
-- 6. TRIGGER FUNCTION
--    fn_auto_flag_visual_acuity
-- =============================================================================
-- Automatically derives screening flags for VISUAL_ACUITY results.
--
-- Expected JSON:
--
-- {
--   "leftEye": "6/12",
--   "rightEye": "6/6",
--   "pinholeLeft": "6/9",
--   "pinholeRight": "6/6"
-- }
--
-- Updates:
--   is_flagged
--   flag_summary
--   overall_flag
--
-- No diagnosis is made.
-- =============================================================================

CREATE OR REPLACE FUNCTION fn_auto_flag_visual_acuity()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_left_eye TEXT;
    v_right_eye TEXT;
    v_pinhole_left TEXT;
    v_pinhole_right TEXT;
    v_flagged BOOLEAN;
    v_left_category TEXT;
    v_right_category TEXT;
BEGIN

    -- ---------------------------------------------------------
    -- Only process visual acuity
    -- ---------------------------------------------------------

    IF NEW.screening_type::TEXT <> 'VISUAL_ACUITY' THEN
        RETURN NEW;
    END IF;


    -- ---------------------------------------------------------
    -- Extract JSON fields safely
    -- ---------------------------------------------------------

    v_left_eye :=
        NEW.result_data ->> 'leftEye';

    v_right_eye :=
        NEW.result_data ->> 'rightEye';

    v_pinhole_left :=
        NEW.result_data ->> 'pinholeLeft';

    v_pinhole_right :=
        NEW.result_data ->> 'pinholeRight';


    -- ---------------------------------------------------------
    -- Calculate categories
    -- ---------------------------------------------------------

    v_left_category :=
        fn_get_visual_acuity_category(v_left_eye);

    v_right_category :=
        fn_get_visual_acuity_category(v_right_eye);


    -- ---------------------------------------------------------
    -- Calculate flag
    -- ---------------------------------------------------------

    v_flagged :=
        fn_is_visual_acuity_flagged(
            v_left_eye,
            v_right_eye,
            v_pinhole_left,
            v_pinhole_right
        );


    NEW.is_flagged := v_flagged;


    -- ---------------------------------------------------------
    -- Flag summary
    -- ---------------------------------------------------------

    IF v_flagged THEN

        NEW.flag_summary :=
            concat(
                'Visual acuity screening flag. ',
                'Left eye: ', COALESCE(v_left_category, 'UNKNOWN'),
                '; Right eye: ', COALESCE(v_right_category, 'UNKNOWN')
            );

        NEW.overall_flag :=
            'FLAGGED'::"OverallFlag";

    ELSE

        NEW.flag_summary :=
            'No automatic visual acuity screening flag detected';

        NEW.overall_flag :=
            'NORMAL'::"OverallFlag";

    END IF;


    RETURN NEW;

END;
$$;


-- =============================================================================
-- 7. TRIGGER FUNCTION
--    fn_validate_event_capacity
-- =============================================================================
-- Prevents new registrations from exceeding event capacity.
--
-- Uses event_registrations because the current events table does NOT have
-- registered_count.
-- =============================================================================

CREATE OR REPLACE FUNCTION fn_validate_event_capacity()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_capacity INT;
    v_current_count INT;
BEGIN

    SELECT capacity
    INTO v_capacity
    FROM events
    WHERE event_id = NEW.event_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'Event does not exist: %',
            NEW.event_id;
    END IF;


    SELECT COUNT(*)
    INTO v_current_count
    FROM event_registrations
    WHERE event_id = NEW.event_id
      AND registration_id <> COALESCE(
            NEW.registration_id,
            '00000000-0000-0000-0000-000000000000'::UUID
      )
      AND registration_status::TEXT NOT IN (
            'CANCELLED',
            'WITHDRAWN'
      );


    IF v_current_count >= v_capacity THEN
        RAISE EXCEPTION
            'Event capacity reached. Capacity: %, Current registrations: %',
            v_capacity,
            v_current_count;
    END IF;


    RETURN NEW;

END;
$$;


-- =============================================================================
-- 8. TRIGGER FUNCTION
--    fn_validate_queue_entry
-- =============================================================================
-- Ensures queue entries are consistent with registration/station/event.
-- =============================================================================

CREATE OR REPLACE FUNCTION fn_validate_queue_entry()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_registration_event UUID;
    v_station_event UUID;
BEGIN

    SELECT event_id
    INTO v_registration_event
    FROM event_registrations
    WHERE registration_id = NEW.registration_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'Registration does not exist: %',
            NEW.registration_id;
    END IF;


    SELECT event_id
    INTO v_station_event
    FROM stations
    WHERE station_id = NEW.station_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'Station does not exist: %',
            NEW.station_id;
    END IF;


    IF v_registration_event <> v_station_event THEN
        RAISE EXCEPTION
            'Queue station and registration belong to different events';
    END IF;


    IF NEW.queue_number <= 0 THEN
        RAISE EXCEPTION
            'Queue number must be greater than zero';
    END IF;


    RETURN NEW;

END;
$$;


-- =============================================================================
-- 9. TRIGGERS
-- =============================================================================

-- -------------------------------------------------------------------------
-- Events updated_at
-- -------------------------------------------------------------------------

CREATE TRIGGER trg_events_updated_at
BEFORE UPDATE ON events
FOR EACH ROW
EXECUTE FUNCTION fn_update_timestamp();


-- -------------------------------------------------------------------------
-- Event registrations updated_at
-- -------------------------------------------------------------------------

CREATE TRIGGER trg_event_registrations_updated_at
BEFORE UPDATE ON event_registrations
FOR EACH ROW
EXECUTE FUNCTION fn_update_timestamp();


-- -------------------------------------------------------------------------
-- Screening results updated_at
-- -------------------------------------------------------------------------

CREATE TRIGGER trg_screening_results_updated_at
BEFORE UPDATE ON screening_results
FOR EACH ROW
EXECUTE FUNCTION fn_update_timestamp();


-- -------------------------------------------------------------------------
-- Referrals updated_at
-- -------------------------------------------------------------------------

CREATE TRIGGER trg_referrals_updated_at
BEFORE UPDATE ON referrals
FOR EACH ROW
EXECUTE FUNCTION fn_update_timestamp();


-- -------------------------------------------------------------------------
-- Reviews updated_at
-- -------------------------------------------------------------------------

CREATE TRIGGER trg_reviews_updated_at
BEFORE UPDATE ON reviews
FOR EACH ROW
EXECUTE FUNCTION fn_update_timestamp();


-- -------------------------------------------------------------------------
-- Validate screening result
-- -------------------------------------------------------------------------

CREATE TRIGGER trg_validate_screening_result
BEFORE INSERT OR UPDATE ON screening_results
FOR EACH ROW
EXECUTE FUNCTION fn_validate_screening_result();


-- -------------------------------------------------------------------------
-- Automatically flag visual acuity
-- -------------------------------------------------------------------------

CREATE TRIGGER trg_auto_flag_visual_acuity
BEFORE INSERT OR UPDATE OF result_data, screening_type
ON screening_results
FOR EACH ROW
EXECUTE FUNCTION fn_auto_flag_visual_acuity();


-- -------------------------------------------------------------------------
-- Validate queue entry
-- -------------------------------------------------------------------------

CREATE TRIGGER trg_validate_queue_entry
BEFORE INSERT OR UPDATE ON queue_entries
FOR EACH ROW
EXECUTE FUNCTION fn_validate_queue_entry();


-- -------------------------------------------------------------------------
-- Validate event capacity
-- -------------------------------------------------------------------------

CREATE TRIGGER trg_validate_event_capacity
BEFORE INSERT ON event_registrations
FOR EACH ROW
EXECUTE FUNCTION fn_validate_event_capacity();


-- =============================================================================
-- 10. STORED PROCEDURE
--     REGISTER PARTICIPANT
-- =============================================================================
-- Creates participant and event registration.
--
-- Current participant columns:
--   participant_id
--   nric
--   first_name
--   last_name
--   date_of_birth
--   gender
--   nationality
--   address_street
--   address_unit
--   address_postal_code
--   contact_number
--   created_by
--   updated_by
--   participant_reference
--   email
--
-- Current event_registration columns:
--   registration_id
--   event_id
--   participant_id
--   registered_by
--   registration_status
--   participant_display_name
--   idempotency_key
-- =============================================================================

CREATE OR REPLACE PROCEDURE sp_register_participant(
    p_participant_id UUID,
    p_event_id UUID,
    p_registered_by UUID,
    p_first_name VARCHAR,
    p_last_name VARCHAR,
    p_date_of_birth DATE,
    p_gender VARCHAR,
    p_nationality VARCHAR DEFAULT 'Singaporean',
    p_nric TEXT DEFAULT NULL,
    p_address_street VARCHAR DEFAULT NULL,
    p_address_unit VARCHAR DEFAULT NULL,
    p_address_postal_code VARCHAR DEFAULT NULL,
    p_contact_number VARCHAR DEFAULT NULL,
    p_email VARCHAR DEFAULT NULL
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_registration_id UUID;
    v_participant_reference VARCHAR;
    v_idempotency_key VARCHAR;
    v_event_status TEXT;
    v_capacity INT;
    v_current_count INT;
BEGIN

    -- ---------------------------------------------------------
    -- Validate participant
    -- ---------------------------------------------------------

    IF p_first_name IS NULL
       OR trim(p_first_name) = ''
    THEN
        RAISE EXCEPTION
            'First name is required';
    END IF;


    IF p_last_name IS NULL
       OR trim(p_last_name) = ''
    THEN
        RAISE EXCEPTION
            'Last name is required';
    END IF;


    IF p_date_of_birth > CURRENT_DATE THEN
        RAISE EXCEPTION
            'Date of birth cannot be in the future';
    END IF;


    -- ---------------------------------------------------------
    -- Validate user
    -- ---------------------------------------------------------

    IF NOT EXISTS (
        SELECT 1
        FROM users
        WHERE user_id = p_registered_by
    ) THEN
        RAISE EXCEPTION
            'Registering user does not exist: %',
            p_registered_by;
    END IF;


    -- ---------------------------------------------------------
    -- Lock and validate event
    -- ---------------------------------------------------------

    SELECT
        capacity,
        status::TEXT
    INTO
        v_capacity,
        v_event_status
    FROM events
    WHERE event_id = p_event_id
    FOR UPDATE;


    IF NOT FOUND THEN
        RAISE EXCEPTION
            'Event does not exist: %',
            p_event_id;
    END IF;


    IF upper(v_event_status) = 'CANCELLED' THEN
        RAISE EXCEPTION
            'Cannot register for a cancelled event';
    END IF;


    -- ---------------------------------------------------------
    -- Check capacity
    -- ---------------------------------------------------------

    SELECT COUNT(*)
    INTO v_current_count
    FROM event_registrations
    WHERE event_id = p_event_id
      AND registration_status::TEXT NOT IN (
            'CANCELLED',
            'WITHDRAWN'
      );


    IF v_current_count >= v_capacity THEN
        RAISE EXCEPTION
            'Event capacity reached. Capacity: %, Registered: %',
            v_capacity,
            v_current_count;
    END IF;


    -- ---------------------------------------------------------
    -- Prevent duplicate participant NRIC
    -- ---------------------------------------------------------

    IF p_nric IS NOT NULL
       AND EXISTS (
            SELECT 1
            FROM participants
            WHERE nric = p_nric
       )
    THEN
        RAISE EXCEPTION
            'Participant with the supplied NRIC already exists';
    END IF;


    -- ---------------------------------------------------------
    -- Prevent duplicate registration
    -- ---------------------------------------------------------

    IF EXISTS (
        SELECT 1
        FROM event_registrations
        WHERE event_id = p_event_id
          AND participant_id = p_participant_id
          AND registration_status::TEXT NOT IN (
                'CANCELLED',
                'WITHDRAWN'
          )
    ) THEN
        RAISE EXCEPTION
            'Participant is already registered for this event';
    END IF;


    -- ---------------------------------------------------------
    -- Generate identifiers
    -- ---------------------------------------------------------

    v_registration_id := gen_random_uuid();

    v_participant_reference :=
        'VSMS-' ||
        upper(substr(replace(p_participant_id::TEXT, '-', ''), 1, 12));

    v_idempotency_key :=
        gen_random_uuid()::TEXT;


    -- ---------------------------------------------------------
    -- Insert participant
    -- ---------------------------------------------------------

    INSERT INTO participants (
        participant_id,
        nric,
        first_name,
        last_name,
        date_of_birth,
        gender,
        nationality,
        address_street,
        address_unit,
        address_postal_code,
        contact_number,
        version,
        created_at,
        updated_at,
        created_by,
        email,
        participant_reference,
        status,
        updated_by
    )
    VALUES (
        p_participant_id,
        p_nric,
        trim(p_first_name),
        trim(p_last_name),
        p_date_of_birth,
        trim(p_gender),
        COALESCE(trim(p_nationality), 'Singaporean'),
        p_address_street,
        p_address_unit,
        p_address_postal_code,
        p_contact_number,
        1,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP,
        p_registered_by,
        p_email,
        v_participant_reference,
        'ACTIVE'::"ParticipantStatus",
        p_registered_by
    );


    -- ---------------------------------------------------------
    -- Insert registration
    -- ---------------------------------------------------------

    INSERT INTO event_registrations (
        registration_id,
        event_id,
        participant_id,
        registered_by,
        registration_status,
        participant_display_name,
        checked_in,
        created_at,
        updated_at,
        idempotency_key,
        route_version,
        paper_form_used
    )
    VALUES (
        v_registration_id,
        p_event_id,
        p_participant_id,
        p_registered_by,
        'SIGNED_UP'::"EventRegistrationStatus",
        trim(p_first_name) || ' ' || trim(p_last_name),
        FALSE,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP,
        v_idempotency_key,
        1,
        FALSE
    );

END;
$$;


-- =============================================================================
-- 11. STORED PROCEDURE
--     ASSIGN STAFF TO STATION
-- =============================================================================

CREATE OR REPLACE PROCEDURE sp_assign_staff_to_station(
    p_assignment_id UUID,
    p_event_id UUID,
    p_station_id UUID,
    p_user_id UUID,
    p_assigned_by UUID,
    p_assignment_role TEXT DEFAULT NULL,
    p_notes TEXT DEFAULT NULL
)
LANGUAGE plpgsql
AS $$
BEGIN

    -- ---------------------------------------------------------
    -- Validate event
    -- ---------------------------------------------------------

    IF NOT EXISTS (
        SELECT 1
        FROM events
        WHERE event_id = p_event_id
    ) THEN
        RAISE EXCEPTION
            'Event does not exist: %',
            p_event_id;
    END IF;


    -- ---------------------------------------------------------
    -- Validate station
    -- ---------------------------------------------------------

    IF NOT EXISTS (
        SELECT 1
        FROM stations
        WHERE station_id = p_station_id
          AND event_id = p_event_id
    ) THEN
        RAISE EXCEPTION
            'Station does not belong to event';
    END IF;


    -- ---------------------------------------------------------
    -- Validate user
    -- ---------------------------------------------------------

    IF NOT EXISTS (
        SELECT 1
        FROM users
        WHERE user_id = p_user_id
    ) THEN
        RAISE EXCEPTION
            'User does not exist: %',
            p_user_id;
    END IF;


    -- ---------------------------------------------------------
    -- Validate assigner
    -- ---------------------------------------------------------

    IF NOT EXISTS (
        SELECT 1
        FROM users
        WHERE user_id = p_assigned_by
    ) THEN
        RAISE EXCEPTION
            'Assigning user does not exist: %',
            p_assigned_by;
    END IF;


    -- ---------------------------------------------------------
    -- Prevent duplicate active assignment
    -- ---------------------------------------------------------

    IF EXISTS (
        SELECT 1
        FROM staff_assignments
        WHERE event_id = p_event_id
          AND station_id = p_station_id
          AND user_id = p_user_id
          AND COALESCE(assignment_status::TEXT, status::TEXT)
              = 'ASSIGNED'
    ) THEN
        RAISE EXCEPTION
            'User is already assigned to this station';
    END IF;


    -- ---------------------------------------------------------
    -- Insert assignment
    -- ---------------------------------------------------------

    INSERT INTO staff_assignments (
        assignment_id,
        event_id,
        station_id,
        user_id,
        assigned_by,
        assignment_role,
        assigned_at,
        assignment_status,
        status,
        notes
    )
    VALUES (
        p_assignment_id,
        p_event_id,
        p_station_id,
        p_user_id,
        p_assigned_by,
        CASE
            WHEN p_assignment_role IS NULL THEN NULL
            ELSE p_assignment_role::"StaffAssignmentRole"
        END,
        CURRENT_TIMESTAMP,
        'ASSIGNED'::"StaffAssignmentStatus",
        'ASSIGNED'::"StaffAssignmentStatus",
        p_notes
    );

END;
$$;


-- =============================================================================
-- 12. STORED PROCEDURE
--     ADD PARTICIPANT TO QUEUE
-- =============================================================================

CREATE OR REPLACE PROCEDURE sp_add_participant_to_queue(
    p_queue_id UUID,
    p_registration_id UUID,
    p_station_id UUID,
    p_queue_number INT,
    p_is_priority BOOLEAN DEFAULT FALSE,
    p_priority_notes VARCHAR DEFAULT NULL
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_registration_event UUID;
    v_station_event UUID;
BEGIN

    -- ---------------------------------------------------------
    -- Validate registration
    -- ---------------------------------------------------------

    SELECT event_id
    INTO v_registration_event
    FROM event_registrations
    WHERE registration_id = p_registration_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'Registration does not exist: %',
            p_registration_id;
    END IF;


    -- ---------------------------------------------------------
    -- Validate station
    -- ---------------------------------------------------------

    SELECT event_id
    INTO v_station_event
    FROM stations
    WHERE station_id = p_station_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'Station does not exist: %',
            p_station_id;
    END IF;


    -- ---------------------------------------------------------
    -- Same event
    -- ---------------------------------------------------------

    IF v_registration_event <> v_station_event THEN
        RAISE EXCEPTION
            'Station does not belong to participant event';
    END IF;


    -- ---------------------------------------------------------
    -- Prevent duplicate active queue
    -- ---------------------------------------------------------

    IF EXISTS (
        SELECT 1
        FROM queue_entries
        WHERE registration_id = p_registration_id
          AND status::TEXT NOT IN (
                'COMPLETED',
                'LEFT',
                'CANCELLED'
          )
    ) THEN
        RAISE EXCEPTION
            'Participant is already in an active queue';
    END IF;


    -- ---------------------------------------------------------
    -- Prevent duplicate queue number at station
    -- ---------------------------------------------------------

    IF EXISTS (
        SELECT 1
        FROM queue_entries
        WHERE station_id = p_station_id
          AND queue_number = p_queue_number
          AND status::TEXT NOT IN (
                'COMPLETED',
                'LEFT',
                'CANCELLED'
          )
    ) THEN
        RAISE EXCEPTION
            'Queue number % is already active at this station',
            p_queue_number;
    END IF;


    -- ---------------------------------------------------------
    -- Insert queue entry
    -- ---------------------------------------------------------

    INSERT INTO queue_entries (
        queue_id,
        registration_id,
        station_id,
        queue_number,
        status,
        entered_at,
        is_priority,
        priority_notes
    )
    VALUES (
        p_queue_id,
        p_registration_id,
        p_station_id,
        p_queue_number,
        'WAITING'::"QueueStatus",
        CURRENT_TIMESTAMP,
        p_is_priority,
        p_priority_notes
    );

END;
$$;


-- =============================================================================
-- 13. STORED PROCEDURE
--     CHECK IN PARTICIPANT
-- =============================================================================

CREATE OR REPLACE PROCEDURE sp_check_in_participant(
    p_registration_id UUID
)
LANGUAGE plpgsql
AS $$
BEGIN

    -- ---------------------------------------------------------
    -- Validate registration
    -- ---------------------------------------------------------

    IF NOT EXISTS (
        SELECT 1
        FROM event_registrations
        WHERE registration_id = p_registration_id
    ) THEN
        RAISE EXCEPTION
            'Registration does not exist: %',
            p_registration_id;
    END IF;


    -- ---------------------------------------------------------
    -- Prevent duplicate check-in
    -- ---------------------------------------------------------

    IF EXISTS (
        SELECT 1
        FROM event_registrations
        WHERE registration_id = p_registration_id
          AND checked_in = TRUE
    ) THEN
        RAISE EXCEPTION
            'Participant has already been checked in';
    END IF;


    -- ---------------------------------------------------------
    -- Update registration
    -- ---------------------------------------------------------

    UPDATE event_registrations
    SET
        checked_in = TRUE,
        checked_in_at = CURRENT_TIMESTAMP,
        registration_status =
            'CHECKED_IN'::"EventRegistrationStatus"
    WHERE registration_id = p_registration_id;


    -- ---------------------------------------------------------
    -- Start queue timing
    -- ---------------------------------------------------------

    UPDATE queue_entries
    SET
        entered_at = COALESCE(
            entered_at,
            CURRENT_TIMESTAMP
        )
    WHERE registration_id = p_registration_id
      AND status::TEXT = 'WAITING';

END;
$$;


-- =============================================================================
-- 14. STORED PROCEDURE
--     RECORD VISUAL ACUITY
-- =============================================================================

CREATE OR REPLACE PROCEDURE sp_record_visual_acuity(
    p_registration_id UUID,
    p_station_id UUID,
    p_left_eye_va VARCHAR(20),
    p_right_eye_va VARCHAR(20),
    p_pinhole_left VARCHAR(20),
    p_pinhole_right VARCHAR(20),
    p_recorded_by_user_id UUID,
    p_remarks TEXT DEFAULT NULL,
    p_idempotency_key VARCHAR DEFAULT NULL
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_result_id UUID;
    v_queue_entry_id UUID;
    v_idempotency_key VARCHAR;
    v_event_id UUID;
    v_station_event_id UUID;
BEGIN

    -- ---------------------------------------------------------
    -- Validate visual acuity
    -- ---------------------------------------------------------

    IF p_left_eye_va IS NULL
       OR trim(p_left_eye_va) = ''
    THEN
        RAISE EXCEPTION
            'Left-eye visual acuity is required';
    END IF;


    IF p_right_eye_va IS NULL
       OR trim(p_right_eye_va) = ''
    THEN
        RAISE EXCEPTION
            'Right-eye visual acuity is required';
    END IF;


    -- ---------------------------------------------------------
    -- Validate registration
    -- ---------------------------------------------------------

    SELECT event_id
    INTO v_event_id
    FROM event_registrations
    WHERE registration_id = p_registration_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'Registration does not exist: %',
            p_registration_id;
    END IF;


    -- ---------------------------------------------------------
    -- Validate station
    -- ---------------------------------------------------------

    SELECT event_id
    INTO v_station_event_id
    FROM stations
    WHERE station_id = p_station_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'Station does not exist: %',
            p_station_id;
    END IF;


    IF v_event_id <> v_station_event_id THEN
        RAISE EXCEPTION
            'Station does not belong to registration event';
    END IF;


    -- ---------------------------------------------------------
    -- Validate user
    -- ---------------------------------------------------------

    IF NOT EXISTS (
        SELECT 1
        FROM users
        WHERE user_id = p_recorded_by_user_id
    ) THEN
        RAISE EXCEPTION
            'Recording user does not exist: %',
            p_recorded_by_user_id;
    END IF;


    -- ---------------------------------------------------------
    -- Find current queue entry
    -- ---------------------------------------------------------

    SELECT queue_id
    INTO v_queue_entry_id
    FROM queue_entries
    WHERE registration_id = p_registration_id
      AND station_id = p_station_id
      AND status::TEXT NOT IN (
            'COMPLETED',
            'LEFT',
            'CANCELLED'
      )
    ORDER BY entered_at DESC
    LIMIT 1;


    -- ---------------------------------------------------------
    -- Idempotency key
    -- ---------------------------------------------------------

    v_idempotency_key :=
        COALESCE(
            NULLIF(trim(p_idempotency_key), ''),
            gen_random_uuid()::TEXT
        );


    -- ---------------------------------------------------------
    -- Prevent duplicate idempotent submission
    -- ---------------------------------------------------------

    IF EXISTS (
        SELECT 1
        FROM screening_results
        WHERE idempotency_key = v_idempotency_key
    ) THEN
        RETURN;
    END IF;


    -- ---------------------------------------------------------
    -- Insert result
    --
    -- Trigger automatically handles:
    --   validation
    --   flagging
    --   overall_flag
    -- ---------------------------------------------------------

    v_result_id := gen_random_uuid();

    INSERT INTO screening_results (
        result_id,
        registration_id,
        station_id,
        recorded_by_user_id,
        queue_entry_id,
        screening_type,
        result_data,
        overall_flag,
        is_flagged,
        flag_summary,
        rule_version,
        idempotency_key,
        created_at,
        updated_at,
        version
    )
    VALUES (
        v_result_id,
        p_registration_id,
        p_station_id,
        p_recorded_by_user_id,
        v_queue_entry_id,
        'VISUAL_ACUITY'::"StationType",
        jsonb_build_object(
            'leftEye', p_left_eye_va,
            'rightEye', p_right_eye_va,
            'pinholeLeft', p_pinhole_left,
            'pinholeRight', p_pinhole_right,
            'remarks', p_remarks
        ),
        'NORMAL'::"OverallFlag",
        FALSE,
        NULL,
        'VSMS-VA-1.0',
        v_idempotency_key,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP,
        1
    );


    -- ---------------------------------------------------------
    -- Update queue entry
    -- ---------------------------------------------------------

    IF v_queue_entry_id IS NOT NULL THEN

        UPDATE queue_entries
        SET
            started_at =
                COALESCE(
                    started_at,
                    CURRENT_TIMESTAMP
                )
        WHERE queue_id = v_queue_entry_id;

    END IF;

END;
$$;


-- =============================================================================
-- 15. STORED PROCEDURE
--     RECORD GENERIC SCREENING RESULT
-- =============================================================================

CREATE OR REPLACE PROCEDURE sp_record_screening_result(
    p_registration_id UUID,
    p_station_id UUID,
    p_recorded_by_user_id UUID,
    p_screening_type TEXT,
    p_result_data JSONB,
    p_is_flagged BOOLEAN DEFAULT FALSE,
    p_flag_summary TEXT DEFAULT NULL,
    p_idempotency_key VARCHAR DEFAULT NULL
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_event_id UUID;
    v_station_event_id UUID;
    v_queue_entry_id UUID;
    v_idempotency_key VARCHAR;
BEGIN

    -- ---------------------------------------------------------
    -- Validate screening type
    -- ---------------------------------------------------------

    IF p_screening_type IS NULL
       OR trim(p_screening_type) = ''
    THEN
        RAISE EXCEPTION
            'Screening type is required';
    END IF;


    -- ---------------------------------------------------------
    -- Validate JSON
    -- ---------------------------------------------------------

    IF p_result_data IS NULL THEN
        RAISE EXCEPTION
            'Screening result data is required';
    END IF;


    -- ---------------------------------------------------------
    -- Registration
    -- ---------------------------------------------------------

    SELECT event_id
    INTO v_event_id
    FROM event_registrations
    WHERE registration_id = p_registration_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'Registration does not exist: %',
            p_registration_id;
    END IF;


    -- ---------------------------------------------------------
    -- Station
    -- ---------------------------------------------------------

    SELECT event_id
    INTO v_station_event_id
    FROM stations
    WHERE station_id = p_station_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'Station does not exist: %',
            p_station_id;
    END IF;


    IF v_event_id <> v_station_event_id THEN
        RAISE EXCEPTION
            'Station and registration belong to different events';
    END IF;


    -- ---------------------------------------------------------
    -- User
    -- ---------------------------------------------------------

    IF NOT EXISTS (
        SELECT 1
        FROM users
        WHERE user_id = p_recorded_by_user_id
    ) THEN
        RAISE EXCEPTION
            'Recording user does not exist: %',
            p_recorded_by_user_id;
    END IF;


    -- ---------------------------------------------------------
    -- Queue entry
    -- ---------------------------------------------------------

    SELECT queue_id
    INTO v_queue_entry_id
    FROM queue_entries
    WHERE registration_id = p_registration_id
      AND station_id = p_station_id
      AND status::TEXT NOT IN (
            'COMPLETED',
            'LEFT',
            'CANCELLED'
      )
    ORDER BY entered_at DESC
    LIMIT 1;


    -- ---------------------------------------------------------
    -- Idempotency
    -- ---------------------------------------------------------

    v_idempotency_key :=
        COALESCE(
            NULLIF(trim(p_idempotency_key), ''),
            gen_random_uuid()::TEXT
        );


    IF EXISTS (
        SELECT 1
        FROM screening_results
        WHERE idempotency_key = v_idempotency_key
    ) THEN
        RETURN;
    END IF;


    -- ---------------------------------------------------------
    -- Insert
    -- ---------------------------------------------------------

    INSERT INTO screening_results (
        result_id,
        registration_id,
        station_id,
        recorded_by_user_id,
        queue_entry_id,
        screening_type,
        result_data,
        overall_flag,
        is_flagged,
        flag_summary,
        rule_version,
        idempotency_key,
        created_at,
        updated_at,
        version
    )
    VALUES (
        gen_random_uuid(),
        p_registration_id,
        p_station_id,
        p_recorded_by_user_id,
        v_queue_entry_id,
        p_screening_type::"StationType",
        p_result_data,
        CASE
            WHEN p_is_flagged
                THEN 'FLAGGED'::"OverallFlag"
            ELSE
                'NORMAL'::"OverallFlag"
        END,
        p_is_flagged,
        p_flag_summary,
        'VSMS-1.0',
        v_idempotency_key,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP,
        1
    );

END;
$$;


-- =============================================================================
-- 16. STORED PROCEDURE
--     CALL NEXT PARTICIPANT
-- =============================================================================
-- Changes:
--
-- WAITING -> CALLED
--
-- Uses queue_entries.
-- =============================================================================

CREATE OR REPLACE PROCEDURE sp_call_next_participant(
    p_station_id UUID
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_queue_id UUID;
BEGIN

    SELECT queue_id
    INTO v_queue_id
    FROM queue_entries
    WHERE station_id = p_station_id
      AND status::TEXT = 'WAITING'
    ORDER BY
        is_priority DESC,
        entered_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT 1;


    IF v_queue_id IS NULL THEN
        RAISE EXCEPTION
            'No waiting participants at this station';
    END IF;


    UPDATE queue_entries
    SET
        status = 'CALLED'::"QueueStatus",
        called_at = CURRENT_TIMESTAMP
    WHERE queue_id = v_queue_id;

END;
$$;


-- =============================================================================
-- 17. STORED PROCEDURE
--     START SCREENING
-- =============================================================================

CREATE OR REPLACE PROCEDURE sp_start_screening(
    p_queue_id UUID
)
LANGUAGE plpgsql
AS $$
BEGIN

    IF NOT EXISTS (
        SELECT 1
        FROM queue_entries
        WHERE queue_id = p_queue_id
    ) THEN
        RAISE EXCEPTION
            'Queue entry does not exist: %',
            p_queue_id;
    END IF;


    UPDATE queue_entries
    SET
        status = 'IN_PROGRESS'::"QueueStatus",
        started_at = CURRENT_TIMESTAMP
    WHERE queue_id = p_queue_id
      AND status::TEXT IN (
            'WAITING',
            'CALLED'
      );


    IF NOT FOUND THEN
        RAISE EXCEPTION
            'Queue entry cannot be started from its current status';
    END IF;

END;
$$;


-- =============================================================================
-- 18. STORED PROCEDURE
--     COMPLETE SCREENING
-- =============================================================================
-- Requires at least one screening result.
--
-- Queue:
--   -> COMPLETED
--
-- Registration:
--   -> COMPLETED
-- =============================================================================

CREATE OR REPLACE PROCEDURE sp_complete_screening(
    p_registration_id UUID
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_result_count INT;
BEGIN

    -- ---------------------------------------------------------
    -- Registration exists
    -- ---------------------------------------------------------

    IF NOT EXISTS (
        SELECT 1
        FROM event_registrations
        WHERE registration_id = p_registration_id
    ) THEN
        RAISE EXCEPTION
            'Registration does not exist: %',
            p_registration_id;
    END IF;


    -- ---------------------------------------------------------
    -- Require screening result
    -- ---------------------------------------------------------

    SELECT COUNT(*)
    INTO v_result_count
    FROM screening_results
    WHERE registration_id = p_registration_id;


    IF v_result_count = 0 THEN
        RAISE EXCEPTION
            'Cannot complete screening because no screening results exist';
    END IF;


    -- ---------------------------------------------------------
    -- Complete registration
    -- ---------------------------------------------------------

    UPDATE event_registrations
    SET
        registration_status =
            'COMPLETED'::"EventRegistrationStatus"
    WHERE registration_id = p_registration_id;


    -- ---------------------------------------------------------
    -- Complete queue
    -- ---------------------------------------------------------

    UPDATE queue_entries
    SET
        status = 'COMPLETED'::"QueueStatus",
        completed_at = CURRENT_TIMESTAMP
    WHERE registration_id = p_registration_id
      AND status::TEXT NOT IN (
            'COMPLETED',
            'LEFT',
            'CANCELLED'
      );

END;
$$;


-- =============================================================================
-- 19. STORED PROCEDURE
--     MOVE PARTICIPANT BETWEEN STATIONS
-- =============================================================================

CREATE OR REPLACE PROCEDURE sp_move_participant_station(
    p_movement_id UUID,
    p_registration_id UUID,
    p_from_station_id UUID,
    p_to_station_id UUID,
    p_moved_by UUID,
    p_movement_reason VARCHAR
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_registration_event UUID;
    v_from_event UUID;
    v_to_event UUID;
    v_old_queue_id UUID;
    v_new_queue_id UUID;
    v_next_queue_number INT;
BEGIN

    -- ---------------------------------------------------------
    -- Validate reason
    -- ---------------------------------------------------------

    IF p_movement_reason IS NULL
       OR trim(p_movement_reason) = ''
    THEN
        RAISE EXCEPTION
            'Movement reason is required';
    END IF;


    -- ---------------------------------------------------------
    -- Registration
    -- ---------------------------------------------------------

    SELECT event_id
    INTO v_registration_event
    FROM event_registrations
    WHERE registration_id = p_registration_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'Registration does not exist';
    END IF;


    -- ---------------------------------------------------------
    -- From station
    -- ---------------------------------------------------------

    SELECT event_id
    INTO v_from_event
    FROM stations
    WHERE station_id = p_from_station_id;


    IF NOT FOUND THEN
        RAISE EXCEPTION
            'Source station does not exist';
    END IF;


    -- ---------------------------------------------------------
    -- To station
    -- ---------------------------------------------------------

    SELECT event_id
    INTO v_to_event
    FROM stations
    WHERE station_id = p_to_station_id;


    IF NOT FOUND THEN
        RAISE EXCEPTION
            'Destination station does not exist';
    END IF;


    -- ---------------------------------------------------------
    -- Same event
    -- ---------------------------------------------------------

    IF v_registration_event <> v_from_event
       OR v_registration_event <> v_to_event
    THEN
        RAISE EXCEPTION
            'Registration and stations must belong to same event';
    END IF;


    -- ---------------------------------------------------------
    -- Validate user
    -- ---------------------------------------------------------

    IF NOT EXISTS (
        SELECT 1
        FROM users
        WHERE user_id = p_moved_by
    ) THEN
        RAISE EXCEPTION
            'Moving user does not exist';
    END IF;


    -- ---------------------------------------------------------
    -- Find current queue
    -- ---------------------------------------------------------

    SELECT queue_id
    INTO v_old_queue_id
    FROM queue_entries
    WHERE registration_id = p_registration_id
      AND station_id = p_from_station_id
      AND status::TEXT NOT IN (
            'COMPLETED',
            'LEFT',
            'CANCELLED'
      )
    ORDER BY entered_at DESC
    LIMIT 1;


    -- ---------------------------------------------------------
    -- Mark old queue as left
    -- ---------------------------------------------------------

    IF v_old_queue_id IS NOT NULL THEN

        UPDATE queue_entries
        SET
            status = 'LEFT'::"QueueStatus",
            left_queue_at = CURRENT_TIMESTAMP
        WHERE queue_id = v_old_queue_id;

    END IF;


    -- ---------------------------------------------------------
    -- Create movement audit record
    -- ---------------------------------------------------------

    INSERT INTO queue_movements (
        movement_id,
        registration_id,
        from_station_id,
        to_station_id,
        moved_by,
        movement_reason,
        movement_time
    )
    VALUES (
        p_movement_id,
        p_registration_id,
        p_from_station_id,
        p_to_station_id,
        p_moved_by,
        trim(p_movement_reason),
        CURRENT_TIMESTAMP
    );


    -- ---------------------------------------------------------
    -- Determine next queue number
    -- ---------------------------------------------------------

    SELECT
        COALESCE(MAX(queue_number), 0) + 1
    INTO v_next_queue_number
    FROM queue_entries
    WHERE station_id = p_to_station_id;


    -- ---------------------------------------------------------
    -- New queue
    -- ---------------------------------------------------------

    v_new_queue_id := gen_random_uuid();

    INSERT INTO queue_entries (
        queue_id,
        registration_id,
        station_id,
        queue_number,
        status,
        entered_at
    )
    VALUES (
        v_new_queue_id,
        p_registration_id,
        p_to_station_id,
        v_next_queue_number,
        'WAITING'::"QueueStatus",
        CURRENT_TIMESTAMP
    );

END;
$$;


-- =============================================================================
-- 20. STORED PROCEDURE
--     CREATE REVIEW
-- =============================================================================

CREATE OR REPLACE PROCEDURE sp_create_review(
    p_review_id UUID,
    p_registration_id UUID,
    p_reviewed_by_user_id UUID,
    p_outcome TEXT,
    p_urgency TEXT,
    p_clinical_summary TEXT,
    p_recommendations TEXT DEFAULT NULL
)
LANGUAGE plpgsql
AS $$
BEGIN

    -- ---------------------------------------------------------
    -- Validate registration
    -- ---------------------------------------------------------

    IF NOT EXISTS (
        SELECT 1
        FROM event_registrations
        WHERE registration_id = p_registration_id
    ) THEN
        RAISE EXCEPTION
            'Registration does not exist';
    END IF;


    -- ---------------------------------------------------------
    -- Validate user
    -- ---------------------------------------------------------

    IF NOT EXISTS (
        SELECT 1
        FROM users
        WHERE user_id = p_reviewed_by_user_id
    ) THEN
        RAISE EXCEPTION
            'Reviewing user does not exist';
    END IF;


    -- ---------------------------------------------------------
    -- Validate summary
    -- ---------------------------------------------------------

    IF p_clinical_summary IS NULL
       OR trim(p_clinical_summary) = ''
    THEN
        RAISE EXCEPTION
            'Clinical summary is required';
    END IF;


    -- ---------------------------------------------------------
    -- Insert review
    -- ---------------------------------------------------------

    INSERT INTO reviews (
        review_id,
        registration_id,
        version,
        reviewed_by_user_id,
        parent_review_id,
        outcome,
        urgency,
        clinical_summary,
        recommendations,
        reviewed_at,
        created_at,
        updated_at
    )
    VALUES (
        p_review_id,
        p_registration_id,
        1,
        p_reviewed_by_user_id,
        NULL,
        p_outcome::"ReviewOutcome",
        p_urgency::"ClinicalUrgency",
        trim(p_clinical_summary),
        p_recommendations,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
    );

END;
$$;


-- =============================================================================
-- 21. STORED PROCEDURE
--     CREATE REFERRAL
-- =============================================================================
-- Current referrals table references reviews:
--
-- referrals.review_id
--
-- NOT screening_results.result_id.
-- =============================================================================

CREATE OR REPLACE PROCEDURE sp_create_referral(
    p_referral_id UUID,
    p_review_id UUID,
    p_registration_id UUID,
    p_created_by_user_id UUID,
    p_destination_name VARCHAR,
    p_destination_email VARCHAR,
    p_reason TEXT,
    p_instructions TEXT,
    p_urgency TEXT
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_review_registration UUID;
BEGIN

    -- ---------------------------------------------------------
    -- Validate review
    -- ---------------------------------------------------------

    SELECT registration_id
    INTO v_review_registration
    FROM reviews
    WHERE review_id = p_review_id;


    IF NOT FOUND THEN
        RAISE EXCEPTION
            'Review does not exist: %',
            p_review_id;
    END IF;


    -- ---------------------------------------------------------
    -- Review must belong to registration
    -- ---------------------------------------------------------

    IF v_review_registration <> p_registration_id THEN
        RAISE EXCEPTION
            'Review does not belong to registration';
    END IF;


    -- ---------------------------------------------------------
    -- Validate creator
    -- ---------------------------------------------------------

    IF NOT EXISTS (
        SELECT 1
        FROM users
        WHERE user_id = p_created_by_user_id
    ) THEN
        RAISE EXCEPTION
            'Referral creator does not exist';
    END IF;


    -- ---------------------------------------------------------
    -- Required fields
    -- ---------------------------------------------------------

    IF p_destination_name IS NULL
       OR trim(p_destination_name) = ''
    THEN
        RAISE EXCEPTION
            'Referral destination is required';
    END IF;


    IF p_reason IS NULL
       OR trim(p_reason) = ''
    THEN
        RAISE EXCEPTION
            'Referral reason is required';
    END IF;


    -- ---------------------------------------------------------
    -- Insert referral
    -- ---------------------------------------------------------

    INSERT INTO referrals (
        referral_id,
        review_id,
        registration_id,
        created_by_user_id,
        destination_name,
        destination_email,
        reason,
        instructions,
        urgency,
        status,
        created_at,
        updated_at,
        revision_number
    )
    VALUES (
        p_referral_id,
        p_review_id,
        p_registration_id,
        p_created_by_user_id,
        trim(p_destination_name),
        p_destination_email,
        trim(p_reason),
        p_instructions,
        p_urgency::"ClinicalUrgency",
        'DRAFT'::"ReferralStatus",
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP,
        1
    );

END;
$$;


-- =============================================================================
-- 22. STORED PROCEDURE
--     COMPLETE / SEND REFERRAL
-- =============================================================================

CREATE OR REPLACE PROCEDURE sp_send_referral(
    p_referral_id UUID
)
LANGUAGE plpgsql
AS $$
BEGIN

    IF NOT EXISTS (
        SELECT 1
        FROM referrals
        WHERE referral_id = p_referral_id
    ) THEN
        RAISE EXCEPTION
            'Referral does not exist: %',
            p_referral_id;
    END IF;


    UPDATE referrals
    SET
        status = 'SENT'::"ReferralStatus",
        referred_at = CURRENT_TIMESTAMP
    WHERE referral_id = p_referral_id
      AND status::TEXT = 'DRAFT';


    IF NOT FOUND THEN
        RAISE EXCEPTION
            'Referral cannot be sent from its current status';
    END IF;

END;
$$;


-- =============================================================================
-- 23. STORED PROCEDURE
--     ACKNOWLEDGE SCREENING RESULT
-- =============================================================================

CREATE OR REPLACE PROCEDURE sp_acknowledge_screening_result(
    p_result_id UUID
)
LANGUAGE plpgsql
AS $$
BEGIN

    IF NOT EXISTS (
        SELECT 1
        FROM screening_results
        WHERE result_id = p_result_id
    ) THEN
        RAISE EXCEPTION
            'Screening result does not exist';
    END IF;


    UPDATE screening_results
    SET
        acknowledged_at = CURRENT_TIMESTAMP
    WHERE result_id = p_result_id;

END;
$$;


-- =============================================================================
-- 24. STORED PROCEDURE
--     PROCESS SYNC ACTION
-- =============================================================================
-- Supports offline-first processing.
--
-- This procedure does not modify the actual domain entity automatically.
-- It records a successful processing state and response snapshot.
-- =============================================================================

CREATE OR REPLACE PROCEDURE sp_process_sync_action(
    p_sync_action_id UUID,
    p_response_snapshot JSONB DEFAULT NULL
)
LANGUAGE plpgsql
AS $$
BEGIN

    IF NOT EXISTS (
        SELECT 1
        FROM sync_actions
        WHERE sync_action_id = p_sync_action_id
    ) THEN
        RAISE EXCEPTION
            'Sync action does not exist: %',
            p_sync_action_id;
    END IF;


    UPDATE sync_actions
    SET
        status = 'SUCCESS'::"SyncActionStatus",
        response_snapshot = p_response_snapshot,
        error_code = NULL,
        updated_at = CURRENT_TIMESTAMP,
        version = version + 1
    WHERE sync_action_id = p_sync_action_id;


    INSERT INTO sync_action_transitions (
        sync_transition_id,
        sync_action_id,
        status,
        retry_count,
        error_code,
        created_at,
        sequence
    )
    SELECT
        gen_random_uuid(),
        sync_action_id,
        'SUCCESS'::"SyncActionStatus",
        retry_count,
        NULL,
        CURRENT_TIMESTAMP,
        COALESCE(
            (
                SELECT MAX(sat.sequence) + 1
                FROM sync_action_transitions sat
                WHERE sat.sync_action_id =
                      sync_actions.sync_action_id
            ),
            1
        )
    FROM sync_actions
    WHERE sync_action_id = p_sync_action_id;

END;
$$;


-- =============================================================================
-- 25. STORED PROCEDURE
--     FAIL SYNC ACTION
-- =============================================================================

CREATE OR REPLACE PROCEDURE sp_fail_sync_action(
    p_sync_action_id UUID,
    p_error_code VARCHAR
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_retry_count INT;
BEGIN

    SELECT retry_count
    INTO v_retry_count
    FROM sync_actions
    WHERE sync_action_id = p_sync_action_id
    FOR UPDATE;


    IF NOT FOUND THEN
        RAISE EXCEPTION
            'Sync action does not exist';
    END IF;


    v_retry_count := COALESCE(v_retry_count, 0) + 1;


    UPDATE sync_actions
    SET
        status = 'FAILED'::"SyncActionStatus",
        retry_count = v_retry_count,
        error_code = p_error_code,
        updated_at = CURRENT_TIMESTAMP,
        version = version + 1
    WHERE sync_action_id = p_sync_action_id;


    INSERT INTO sync_action_transitions (
        sync_transition_id,
        sync_action_id,
        status,
        retry_count,
        error_code,
        created_at,
        sequence
    )
    VALUES (
        gen_random_uuid(),
        p_sync_action_id,
        'FAILED'::"SyncActionStatus",
        v_retry_count,
        p_error_code,
        CURRENT_TIMESTAMP,
        COALESCE(
            (
                SELECT MAX(sequence) + 1
                FROM sync_action_transitions
                WHERE sync_action_id = p_sync_action_id
            ),
            1
        )
    );

END;
$$;


-- =============================================================================
-- 26. STORED PROCEDURE
--     RETRY SYNC ACTION
-- =============================================================================

CREATE OR REPLACE PROCEDURE sp_retry_sync_action(
    p_sync_action_id UUID
)
LANGUAGE plpgsql
AS $$
BEGIN

    IF NOT EXISTS (
        SELECT 1
        FROM sync_actions
        WHERE sync_action_id = p_sync_action_id
    ) THEN
        RAISE EXCEPTION
            'Sync action does not exist';
    END IF;


    UPDATE sync_actions
    SET
        status = 'PENDING'::"SyncActionStatus",
        error_code = NULL,
        updated_at = CURRENT_TIMESTAMP,
        version = version + 1
    WHERE sync_action_id = p_sync_action_id
      AND status::TEXT = 'FAILED';


    IF NOT FOUND THEN
        RAISE EXCEPTION
            'Only FAILED sync actions can be retried';
    END IF;


    INSERT INTO sync_action_transitions (
        sync_transition_id,
        sync_action_id,
        status,
        retry_count,
        error_code,
        created_at,
        sequence
    )
    SELECT
        gen_random_uuid(),
        sync_action_id,
        'PENDING'::"SyncActionStatus",
        retry_count,
        NULL,
        CURRENT_TIMESTAMP,
        COALESCE(
            (
                SELECT MAX(sequence) + 1
                FROM sync_action_transitions
                WHERE sync_action_id = p_sync_action_id
            ),
            1
        )
    FROM sync_actions
    WHERE sync_action_id = p_sync_action_id;

END;
$$;


-- =============================================================================
-- 27. STORED PROCEDURE
--     LOCK USER ACCOUNT
-- =============================================================================

CREATE OR REPLACE PROCEDURE sp_lock_user_account(
    p_user_id UUID,
    p_lock_minutes INT DEFAULT 15
)
LANGUAGE plpgsql
AS $$
BEGIN

    IF p_lock_minutes <= 0 THEN
        RAISE EXCEPTION
            'Lock duration must be greater than zero';
    END IF;


    IF NOT EXISTS (
        SELECT 1
        FROM users
        WHERE user_id = p_user_id
    ) THEN
        RAISE EXCEPTION
            'User does not exist';
    END IF;


    UPDATE users
    SET
        failed_login_attempts =
            failed_login_attempts + 1,
        locked_until =
            CURRENT_TIMESTAMP
            + make_interval(mins => p_lock_minutes),
        updated_at = CURRENT_TIMESTAMP
    WHERE user_id = p_user_id;

END;
$$;


-- =============================================================================
-- 28. STORED PROCEDURE
--     RESET LOGIN ATTEMPTS
-- =============================================================================

CREATE OR REPLACE PROCEDURE sp_reset_login_attempts(
    p_user_id UUID
)
LANGUAGE plpgsql
AS $$
BEGIN

    UPDATE users
    SET
        failed_login_attempts = 0,
        locked_until = NULL,
        last_login_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    WHERE user_id = p_user_id;


    IF NOT FOUND THEN
        RAISE EXCEPTION
            'User does not exist';
    END IF;

END;
$$;


-- =============================================================================
-- 29. STORED PROCEDURE
--     CANCEL EVENT
-- =============================================================================

CREATE OR REPLACE PROCEDURE sp_cancel_event(
    p_event_id UUID,
    p_cancelled_by_user_id UUID,
    p_cancellation_reason TEXT
)
LANGUAGE plpgsql
AS $$
BEGIN

    IF NOT EXISTS (
        SELECT 1
        FROM events
        WHERE event_id = p_event_id
    ) THEN
        RAISE EXCEPTION
            'Event does not exist';
    END IF;


    IF NOT EXISTS (
        SELECT 1
        FROM users
        WHERE user_id = p_cancelled_by_user_id
    ) THEN
        RAISE EXCEPTION
            'Cancelling user does not exist';
    END IF;


    IF p_cancellation_reason IS NULL
       OR trim(p_cancellation_reason) = ''
    THEN
        RAISE EXCEPTION
            'Cancellation reason is required';
    END IF;


    UPDATE events
    SET
        status = 'CANCELLED'::"EventStatus",
        cancelled_by_user_id = p_cancelled_by_user_id,
        cancelled_at = CURRENT_TIMESTAMP,
        cancellation_reason =
            trim(p_cancellation_reason)
    WHERE event_id = p_event_id;

END;
$$;


-- =============================================================================
-- 30. STORED PROCEDURE
--     REFRESH DASHBOARD MATERIALIZED VIEW
-- =============================================================================

CREATE OR REPLACE PROCEDURE sp_refresh_event_screening_dashboard()
LANGUAGE plpgsql
AS $$
BEGIN

    REFRESH MATERIALIZED VIEW mv_event_screening_dashboard;

END;
$$;


-- =============================================================================
-- 31. MATERIALIZED VIEW
--     EVENT SCREENING DASHBOARD
-- =============================================================================
--
-- Current events column:
--   name
--
-- NOT event_name.
--
-- This was the source of your previous:
--
--   ERROR: column e.event_name does not exist
--
-- =============================================================================

CREATE MATERIALIZED VIEW mv_event_screening_dashboard
AS
SELECT
    e.event_id,
    e.name AS event_name,
    e.venue,
    e.starts_at,
    e.ends_at,
    e.capacity,
    e.status AS event_status,

    COUNT(DISTINCT er.registration_id)
        AS total_registrations,

    COUNT(
        DISTINCT CASE
            WHEN er.checked_in = TRUE
            THEN er.registration_id
        END
    ) AS checked_in_count,

    COUNT(
        DISTINCT CASE
            WHEN er.registration_status::TEXT = 'COMPLETED'
            THEN er.registration_id
        END
    ) AS completed_count,

    COUNT(
        DISTINCT sr.result_id
    ) AS total_screening_results,

    COUNT(
        DISTINCT CASE
            WHEN sr.is_flagged = TRUE
            THEN sr.result_id
        END
    ) AS flagged_screening_results,

    COUNT(
        DISTINCT r.review_id
    ) AS total_reviews,

    COUNT(
        DISTINCT ref.referral_id
    ) AS total_referrals

FROM events e

LEFT JOIN event_registrations er
    ON er.event_id = e.event_id

LEFT JOIN screening_results sr
    ON sr.registration_id = er.registration_id

LEFT JOIN reviews r
    ON r.registration_id = er.registration_id

LEFT JOIN referrals ref
    ON ref.registration_id = er.registration_id

GROUP BY
    e.event_id,
    e.name,
    e.venue,
    e.starts_at,
    e.ends_at,
    e.capacity,
    e.status;


-- =============================================================================
-- 32. INDEX FOR MATERIALIZED VIEW
-- =============================================================================

CREATE UNIQUE INDEX idx_mv_event_screening_dashboard_event
ON mv_event_screening_dashboard(event_id);


-- =============================================================================
-- 33. ADDITIONAL INDEXES
-- =============================================================================
-- Only create indexes that match the actual columns supplied.
-- IF NOT EXISTS prevents duplicate-index errors.
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_event_registrations_event
ON event_registrations(event_id);

CREATE INDEX IF NOT EXISTS idx_event_registrations_participant
ON event_registrations(participant_id);

CREATE INDEX IF NOT EXISTS idx_screening_results_registration
ON screening_results(registration_id);

CREATE INDEX IF NOT EXISTS idx_screening_results_station
ON screening_results(station_id);

CREATE INDEX IF NOT EXISTS idx_screening_results_flagged
ON screening_results(is_flagged);

CREATE INDEX IF NOT EXISTS idx_queue_entries_station_status
ON queue_entries(station_id, status);

CREATE INDEX IF NOT EXISTS idx_queue_entries_registration
ON queue_entries(registration_id);

CREATE INDEX IF NOT EXISTS idx_queue_movements_registration
ON queue_movements(registration_id);

CREATE INDEX IF NOT EXISTS idx_reviews_registration
ON reviews(registration_id);

CREATE INDEX IF NOT EXISTS idx_referrals_registration
ON referrals(registration_id);

CREATE INDEX IF NOT EXISTS idx_staff_assignments_event
ON staff_assignments(event_id);

CREATE INDEX IF NOT EXISTS idx_staff_assignments_station
ON staff_assignments(station_id);


-- =============================================================================
-- 34. VERIFICATION QUERIES
-- =============================================================================

-- -------------------------------------------------------------------------
-- List procedures
-- -------------------------------------------------------------------------

SELECT
    routine_schema,
    routine_name,
    routine_type
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND (
        routine_name LIKE 'sp_%'
        OR routine_name LIKE 'fn_%'
      )
ORDER BY routine_name;


-- -------------------------------------------------------------------------
-- List triggers
-- -------------------------------------------------------------------------

SELECT
    event_object_table,
    trigger_name,
    event_manipulation,
    action_timing,
    action_statement
FROM information_schema.triggers
WHERE trigger_schema = 'public'
ORDER BY event_object_table, trigger_name;


-- -------------------------------------------------------------------------
-- Check materialized view
-- -------------------------------------------------------------------------

SELECT
    schemaname,
    matviewname
FROM pg_matviews
WHERE schemaname = 'public'
  AND matviewname = 'mv_event_screening_dashboard';


-- -------------------------------------------------------------------------
-- Check materialized view data
-- -------------------------------------------------------------------------

SELECT *
FROM mv_event_screening_dashboard
ORDER BY starts_at;


-- =============================================================================
-- END OF VSMS DATABASE OBJECTS
-- =============================================================================