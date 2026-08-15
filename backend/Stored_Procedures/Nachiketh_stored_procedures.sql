-- =============================================================================
-- ST0528 Database Systems (Project 2) - VSMS Stored Procedures & Triggers
-- File: stored_procedures.sql
--
-- Aligned with the current Prisma schema.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. transfer_queue_entry
-- Atomically completes current queue entry, creates next entry, 
-- logs movement, and prevents concurrent transfers via row-level locking.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE PROCEDURE sp_transfer_queue_entry(
    p_queue_id UUID,
    p_target_station_id UUID,
    p_actor_id UUID
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_registration_id    UUID;
    v_current_station_id UUID;
    v_event_id           UUID;
    v_target_event_id    UUID;
    v_queue_number       INTEGER;
    v_is_priority        BOOLEAN;
    v_priority_notes     VARCHAR(255);
    v_new_queue_id       UUID;
BEGIN
    -- Validation
    IF p_queue_id IS NULL OR p_target_station_id IS NULL OR p_actor_id IS NULL THEN
        RAISE EXCEPTION 'Queue ID, Target Station ID, and Actor ID are required';
    END IF;

    -- Lock and fetch current active queue entry
    SELECT 
        qe.registration_id, 
        qe.station_id, 
        er.event_id, 
        qe.queue_number, 
        qe.is_priority, 
        qe.priority_notes
    INTO 
        v_registration_id, 
        v_current_station_id, 
        v_event_id, 
        v_queue_number, 
        v_is_priority, 
        v_priority_notes
    FROM queue_entries qe
    JOIN event_registrations er ON er.registration_id = qe.registration_id
    WHERE qe.id = p_queue_id 
      AND qe.status IN ('WAITING', 'CALLED', 'IN_PROGRESS')
    FOR UPDATE OF qe;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Active queue entry % not found or locked by another transaction', p_queue_id;
    END IF;

    IF v_current_station_id = p_target_station_id THEN
        RAISE EXCEPTION 'Target station cannot be the same as current station';
    END IF;

    -- Validate target station
    SELECT event_id INTO v_target_event_id
    FROM stations
    WHERE station_id = p_target_station_id AND is_active = TRUE AND operational_status <> 'OFFLINE';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Target station % is inactive, offline, or does not exist', p_target_station_id;
    END IF;

    IF v_target_event_id <> v_event_id THEN
        RAISE EXCEPTION 'Target station does not belong to the same event';
    END IF;

    -- Complete current queue entry
    UPDATE queue_entries
    SET status = 'COMPLETED',
        completed_at = CURRENT_TIMESTAMP,
        left_queue_at = CURRENT_TIMESTAMP
    WHERE id = p_queue_id;

    -- Create next queue entry
    INSERT INTO queue_entries (
        registration_id,
        station_id,
        queue_number,
        status,
        is_priority,
        priority_notes,
        entered_at
    ) VALUES (
        v_registration_id,
        p_target_station_id,
        v_queue_number,
        'WAITING',
        COALESCE(v_is_priority, FALSE),
        v_priority_notes,
        CURRENT_TIMESTAMP
    )
    RETURNING id INTO v_new_queue_id;

    -- Record Movement
    INSERT INTO queue_movements (
        registration_id,
        from_station_id,
        to_station_id,
        moved_by,
        movement_reason,
        movement_time
    ) VALUES (
        v_registration_id,
        v_current_station_id,
        p_target_station_id,
        p_actor_id,
        'STATION_TRANSFER',
        CURRENT_TIMESTAMP
    );

    -- Audit Log
    INSERT INTO audit_logs (
        user_id, action, resource, entity_name, entity_id, outcome, details, created_at
    ) VALUES (
        p_actor_id,
        'QUEUE_TRANSFERRED',
        'QUEUE',
        'QueueEntry',
        p_queue_id,
        'SUCCESS',
        jsonb_build_object(
            'fromQueueId', p_queue_id,
            'toQueueId', v_new_queue_id,
            'registrationId', v_registration_id,
            'fromStationId', v_current_station_id,
            'toStationId', p_target_station_id
        ),
        CURRENT_TIMESTAMP
    );
END;
$$;


-- -----------------------------------------------------------------------------
-- 2. cancel_queue_entry
-- Cancels only active queue entries and writes an audit record in the same transaction.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE PROCEDURE sp_cancel_queue_entry(
    p_queue_id UUID,
    p_reason TEXT,
    p_actor_id UUID
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_registration_id UUID;
    v_station_id      UUID;
    v_current_status  VARCHAR;
BEGIN
    IF p_queue_id IS NULL OR p_actor_id IS NULL OR p_reason IS NULL OR LENGTH(TRIM(p_reason)) = 0 THEN
        RAISE EXCEPTION 'Queue ID, Actor ID, and non-empty cancellation reason are required';
    END IF;

    SELECT registration_id, station_id, status
    INTO v_registration_id, v_station_id, v_current_status
    FROM queue_entries
    WHERE id = p_queue_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Queue entry % not found', p_queue_id;
    END IF;

    IF v_current_status NOT IN ('WAITING', 'CALLED', 'IN_PROGRESS') THEN
        RAISE EXCEPTION 'Cannot cancel queue entry in % status', v_current_status;
    END IF;

    UPDATE queue_entries
    SET status = 'CANCELLED',
        left_queue_at = CURRENT_TIMESTAMP
    WHERE id = p_queue_id;

    INSERT INTO audit_logs (
        user_id, action, resource, entity_name, entity_id, outcome, details, created_at
    ) VALUES (
        p_actor_id,
        'QUEUE_CANCELLED',
        'QUEUE',
        'QueueEntry',
        p_queue_id,
        'SUCCESS',
        jsonb_build_object(
            'registrationId', v_registration_id,
            'stationId', v_station_id,
            'previousStatus', v_current_status,
            'reason', TRIM(p_reason)
        ),
        CURRENT_TIMESTAMP
    );
END;
$$;


-- -----------------------------------------------------------------------------
-- 3. claim_next_queue_entry
-- Atomically selects and claims the next waiting participant for a station
-- using FOR UPDATE SKIP LOCKED to eliminate race conditions between screeners.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_claim_next_queue_entry(
    p_station_id UUID,
    p_actor_id UUID
)
RETURNS TABLE (
    claimed_queue_id UUID,
    registration_id UUID,
    queue_number INTEGER,
    is_priority BOOLEAN,
    priority_notes VARCHAR
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_target_queue_id UUID;
BEGIN
    IF p_station_id IS NULL OR p_actor_id IS NULL THEN
        RAISE EXCEPTION 'Station ID and Actor ID are required';
    END IF;

    -- Select next candidate prioritizing priority queue entries, then FIFO
    SELECT qe.id INTO v_target_queue_id
    FROM queue_entries qe
    WHERE qe.station_id = p_station_id
      AND qe.status = 'WAITING'
    ORDER BY qe.is_priority DESC, qe.entered_at ASC
    FOR UPDATE OF qe SKIP LOCKED
    LIMIT 1;

    IF v_target_queue_id IS NULL THEN
        RETURN;
    END IF;

    -- Transition status to CALLED
    UPDATE queue_entries
    SET status = 'CALLED',
        called_at = CURRENT_TIMESTAMP,
        called_by = p_actor_id
    WHERE id = v_target_queue_id;

    -- Record Audit Log
    INSERT INTO audit_logs (
        user_id, action, resource, entity_name, entity_id, outcome, details, created_at
    ) VALUES (
        p_actor_id,
        'QUEUE_CLAIMED',
        'QUEUE',
        'QueueEntry',
        v_target_queue_id,
        'SUCCESS',
        jsonb_build_object('stationId', p_station_id),
        CURRENT_TIMESTAMP
    );

    RETURN QUERY
    SELECT qe.id, qe.registration_id, qe.queue_number, qe.is_priority, qe.priority_notes
    FROM queue_entries qe
    WHERE qe.id = v_target_queue_id;
END;
$$;


-- -----------------------------------------------------------------------------
-- 4. submit_screening_result
-- Handles idempotent result submission, completes queue entry, advances route step.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE PROCEDURE sp_submit_screening_result(
    p_registration_id UUID,
    p_station_id UUID,
    p_request_id VARCHAR,
    p_result JSONB,
    p_actor_id UUID
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_queue_entry_id UUID;
    v_existing_id    UUID;
BEGIN
    IF p_registration_id IS NULL OR p_station_id IS NULL OR p_actor_id IS NULL OR p_request_id IS NULL THEN
        RAISE EXCEPTION 'Registration ID, Station ID, Request ID, and Actor ID are required';
    END IF;

    -- Check Idempotency
    SELECT result_id INTO v_existing_id
    FROM screening_results
    WHERE idempotency_key = TRIM(p_request_id);

    IF FOUND THEN
        -- Idempotent hit: return gracefully without double-processing
        RETURN;
    END IF;

    -- Lock current active queue entry for this registration and station
    SELECT id INTO v_queue_entry_id
    FROM queue_entries
    WHERE registration_id = p_registration_id
      AND station_id = p_station_id
      AND status IN ('CALLED', 'IN_PROGRESS')
    ORDER BY entered_at DESC
    LIMIT 1
    FOR UPDATE;

    -- Save / Upsert Screening Result
    INSERT INTO screening_results (
        registration_id,
        station_id,
        recorded_by_user_id,
        queue_entry_id,
        result_data,
        idempotency_key,
        created_at,
        updated_at
    ) VALUES (
        p_registration_id,
        p_station_id,
        p_actor_id,
        v_queue_entry_id,
        p_result,
        TRIM(p_request_id),
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
    )
    ON CONFLICT (registration_id, station_id) 
    DO UPDATE SET
        result_data = EXCLUDED.result_data,
        recorded_by_user_id = EXCLUDED.recorded_by_user_id,
        updated_at = CURRENT_TIMESTAMP;

    -- Complete queue entry if exists
    IF v_queue_entry_id IS NOT NULL THEN
        UPDATE queue_entries
        SET status = 'COMPLETED',
            completed_at = CURRENT_TIMESTAMP,
            left_queue_at = CURRENT_TIMESTAMP
        WHERE id = v_queue_entry_id;
    END IF;

    -- Advance Route Step
    UPDATE registration_route_steps
    SET completed_at = CURRENT_TIMESTAMP,
        status = 'COMPLETED'
    WHERE registration_id = p_registration_id
      AND station_id = p_station_id
      AND completed_at IS NULL;

    -- Audit Trail
    INSERT INTO audit_logs (
        user_id, action, resource, entity_name, entity_id, outcome, details, created_at
    ) VALUES (
        p_actor_id,
        'SCREENING_SUBMITTED',
        'CLINICAL',
        'ScreeningResult',
        p_registration_id,
        'SUCCESS',
        jsonb_build_object('stationId', p_station_id, 'requestId', p_request_id),
        CURRENT_TIMESTAMP
    );
END;
$$;


-- -----------------------------------------------------------------------------
-- 5. finalize_clinical_review
-- High-risk clinical mutation: records signed review, optional referral creation,
-- registration completion, and signature consumption in a single transaction.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE PROCEDURE sp_finalize_clinical_review(
    p_registration_id UUID,
    p_actor_id UUID,
    p_review_notes TEXT,
    p_referral_required BOOLEAN,
    p_signature_artifact_id UUID,
    p_referral_type VARCHAR DEFAULT NULL,
    p_referral_notes TEXT DEFAULT NULL
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_sig_consumed BOOLEAN;
    v_referral_id  UUID := NULL;
BEGIN
    IF p_registration_id IS NULL OR p_actor_id IS NULL OR p_signature_artifact_id IS NULL THEN
        RAISE EXCEPTION 'Registration ID, Actor ID, and Signature Artifact ID are required';
    END IF;

    -- 1. Validate and consume signature artifact
    SELECT is_consumed INTO v_sig_consumed
    FROM signature_artifacts
    WHERE id = p_signature_artifact_id AND user_id = p_actor_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Signature artifact % not found or does not belong to actor', p_signature_artifact_id;
    END IF;

    IF v_sig_consumed THEN
        RAISE EXCEPTION 'Signature artifact % has already been consumed', p_signature_artifact_id;
    END IF;

    UPDATE signature_artifacts
    SET is_consumed = TRUE,
        consumed_at = CURRENT_TIMESTAMP
    WHERE id = p_signature_artifact_id;

    -- 2. Optional Referral Creation (DRAFT status)
    IF COALESCE(p_referral_required, FALSE) = TRUE THEN
        INSERT INTO referrals (
            registration_id,
            created_by,
            status,
            referral_type,
            notes,
            created_at
        ) VALUES (
            p_registration_id,
            p_actor_id,
            'DRAFT',
            p_referral_type,
            p_referral_notes,
            CURRENT_TIMESTAMP
        )
        RETURNING id INTO v_referral_id;
    END IF;

    -- 3. Update Clinical Review record
    INSERT INTO clinical_reviews (
        registration_id,
        reviewed_by,
        review_notes,
        referral_required,
        referral_id,
        signature_artifact_id,
        finalized_at
    ) VALUES (
        p_registration_id,
        p_actor_id,
        p_review_notes,
        COALESCE(p_referral_required, FALSE),
        v_referral_id,
        p_signature_artifact_id,
        CURRENT_TIMESTAMP
    );

    -- 4. Complete Registration
    UPDATE event_registrations
    SET status = 'COMPLETED',
        updated_at = CURRENT_TIMESTAMP
    WHERE registration_id = p_registration_id;

    -- 5. Audit Log
    INSERT INTO audit_logs (
        user_id, action, resource, entity_name, entity_id, outcome, details, created_at
    ) VALUES (
        p_actor_id,
        'CLINICAL_REVIEW_FINALIZED',
        'CLINICAL',
        'ClinicalReview',
        p_registration_id,
        'SUCCESS',
        jsonb_build_object(
            'referralRequired', COALESCE(p_referral_required, FALSE),
            'referralId', v_referral_id,
            'signatureArtifactId', p_signature_artifact_id
        ),
        CURRENT_TIMESTAMP
    );
END;
$$;


-- -----------------------------------------------------------------------------
-- 6. issue_referral
-- Transitions referral state DRAFT -> ISSUED idempotently and generates an outbox email payload.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE PROCEDURE sp_issue_referral(
    p_referral_id UUID,
    p_actor_id UUID,
    p_idempotency_key VARCHAR
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_status          VARCHAR;
    v_registration_id UUID;
    v_existing_outbox UUID;
BEGIN
    IF p_referral_id IS NULL OR p_actor_id IS NULL OR p_idempotency_key IS NULL THEN
        RAISE EXCEPTION 'Referral ID, Actor ID, and Idempotency Key are required';
    END IF;

    -- Check Outbox for prior idempotency execution
    SELECT id INTO v_existing_outbox
    FROM outbox_messages
    WHERE idempotency_key = TRIM(p_idempotency_key);

    IF FOUND THEN
        RETURN;
    END IF;

    -- Lock referral record
    SELECT status, registration_id
    INTO v_status, v_registration_id
    FROM referrals
    WHERE id = p_referral_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Referral % not found', p_referral_id;
    END IF;

    IF v_status = 'ISSUED' THEN
        -- Already issued; idempotent exit
        RETURN;
    ELSIF v_status <> 'DRAFT' THEN
        RAISE EXCEPTION 'Cannot issue referral in status %', v_status;
    END IF;

    -- Transition Referral State
    UPDATE referrals
    SET status = 'ISSUED',
        issued_by = p_actor_id,
        issued_at = CURRENT_TIMESTAMP
    WHERE id = p_referral_id;

    -- Create Delivery / Outbox Event for Email Dispatcher
    INSERT INTO outbox_messages (
        event_type,
        payload,
        status,
        idempotency_key,
        created_at
    ) VALUES (
        'REFERRAL_ISSUED',
        jsonb_build_object(
            'referralId', p_referral_id,
            'registrationId', v_registration_id,
            'issuedBy', p_actor_id
        ),
        'PENDING',
        TRIM(p_idempotency_key),
        CURRENT_TIMESTAMP
    );

    -- Audit Log
    INSERT INTO audit_logs (
        user_id, action, resource, entity_name, entity_id, outcome, details, created_at
    ) VALUES (
        p_actor_id,
        'REFERRAL_ISSUED',
        'CLINICAL',
        'Referral',
        p_referral_id,
        'SUCCESS',
        jsonb_build_object('idempotencyKey', p_idempotency_key),
        CURRENT_TIMESTAMP
    );
END;
$$;