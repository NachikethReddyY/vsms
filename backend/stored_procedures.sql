-- =============================================================================
-- ST0528 Database Systems (Project 2) - VSMS Stored Procedures & Triggers
-- File: stored_procedures.sql
-- Description: Consolidated enterprise-grade database objects for the Visual 
--              Screening Management System (VSMS).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. TRIGGER FUNCTIONS & TRIGGERS
-- -----------------------------------------------------------------------------

-- 1.1 Automatic Timestamp Update Trigger Function
-- Ensures 'updated_at' is always current whenever a row is modified.
CREATE OR REPLACE FUNCTION fn_update_timestamp()
RETURNS TRIGGER 
LANGUAGE plpgsql
AS $$ 
BEGIN 
    NEW.updated_at = NOW(); 
    RETURN NEW; 
END; 
$$;

-- Attach trigger to participants table
DROP TRIGGER IF EXISTS trg_participants_updated_at ON participants;
CREATE TRIGGER trg_participants_updated_at
BEFORE UPDATE ON participants
FOR EACH ROW
EXECUTE FUNCTION fn_update_timestamp();


-- 1.2 Clinical Auto-Flagging Trigger Function (FR-05)
-- Automatically evaluates visual acuity thresholds and sets flags upon insertion/update.
CREATE OR REPLACE FUNCTION fn_auto_flag_visual_acuity()
RETURNS TRIGGER 
LANGUAGE plpgsql
AS $$ 
BEGIN 
    NEW.is_flagged := FALSE; 
    NEW.flag_reason := ''; 
    
    -- Check Driving Standard Flag: Uncorrected or corrected VA worse than 20/40 
    IF NEW.left_eye_va IN ('20/50', '20/100', '20/200') OR NEW.right_eye_va IN ('20/50', '20/100', '20/200') THEN 
        NEW.is_flagged := TRUE; 
        NEW.flag_reason := NEW.flag_reason || '[Driving Standard: VA worse than 20/40] '; 
    END IF; 
    
    -- Check Pathology & Pinhole Flag: Corrected VA <= 20/30 and pinhole does not improve 
    IF NEW.pinhole_left IN ('20/40', '20/50', '20/100', '20/200') THEN 
        NEW.is_flagged := TRUE; 
        NEW.flag_reason := NEW.flag_reason || '[Pathology: Pinhole fails to improve vision] '; 
    END IF; 

    RETURN NEW; 
END; 
$$;

-- Attach auto-flagging trigger to visual_acuity_results table
DROP TRIGGER IF EXISTS trg_auto_flag_va ON visual_acuity_results;
CREATE TRIGGER trg_auto_flag_va
BEFORE INSERT OR UPDATE ON visual_acuity_results
FOR EACH ROW
EXECUTE FUNCTION fn_auto_flag_visual_acuity();


-- 1.3 Audit Logger Trigger Function (BR-06 Compliance)
-- Automatically records audit entries when queue statuses change.
CREATE OR REPLACE FUNCTION fn_audit_queue_transition()
RETURNS TRIGGER 
LANGUAGE plpgsql
AS $$ 
BEGIN 
    IF NEW.status = 'COMPLETED' AND (OLD.status IS NULL OR OLD.status != 'COMPLETED') THEN 
        INSERT INTO audit_logs (participant_id, action, station_name, performed_by, created_at) 
        VALUES (NEW.participant_id, 'STATION_COMPLETED', NEW.station_name, NEW.updated_by, NOW()); 
    END IF; 
    RETURN NEW; 
END; 
$$;

-- Attach audit trigger to station_queues table
DROP TRIGGER IF EXISTS trg_audit_queue_change ON station_queues;
CREATE TRIGGER trg_audit_queue_change
AFTER UPDATE ON station_queues
FOR EACH ROW
EXECUTE FUNCTION fn_audit_queue_transition();


-- -----------------------------------------------------------------------------
-- 2. STORED PROCEDURES
-- -----------------------------------------------------------------------------

-- 2.1 Participant Station Queue Transfer Procedure (FR-04)
-- Atomically completes the current station and adds participant to the next station queue.
CREATE OR REPLACE PROCEDURE sp_transfer_participant(
    p_participant_id VARCHAR,
    p_current_station VARCHAR,
    p_next_station VARCHAR,
    p_performed_by VARCHAR
)
LANGUAGE plpgsql
AS $$
BEGIN
    -- 1. Complete current station entry
    UPDATE station_queues
    SET status = 'COMPLETED',
        updated_by = p_performed_by,
        completed_at = NOW()
    WHERE participant_id = p_participant_id
      AND station_name = p_current_station
      AND status = 'IN_PROGRESS';

    -- 2. If next_station is provided, queue the participant into the next station
    IF p_next_station IS NOT NULL AND p_next_station != '' THEN
        INSERT INTO station_queues (participant_id, station_name, status, created_by, updated_by, joined_at)
        VALUES (p_participant_id, p_next_station, 'WAITING', p_performed_by, p_performed_by, NOW());
    END IF;
END;
$$;


-- 2.2 Record Visual Acuity Screening Results Procedure
-- Inserts or updates screening test results safely.
CREATE OR REPLACE PROCEDURE sp_record_visual_acuity(
    p_participant_id VARCHAR,
    p_left_eye_va VARCHAR,
    p_right_eye_va VARCHAR,
    p_pinhole_left VARCHAR,
    p_pinhole_right VARCHAR,
    p_recorded_by VARCHAR
)
LANGUAGE plpgsql
AS $$
BEGIN
    INSERT INTO visual_acuity_results (
        participant_id, 
        left_eye_va, 
        right_eye_va, 
        pinhole_left, 
        pinhole_right, 
        recorded_by, 
        created_at
    )
    VALUES (
        p_participant_id, 
        p_left_eye_va, 
        p_right_eye_va, 
        p_pinhole_left, 
        p_pinhole_right, 
        p_recorded_by, 
        NOW()
    )
    ON CONFLICT (participant_id) DO UPDATE 
    SET left_eye_va = EXCLUDED.left_eye_va,
        right_eye_va = EXCLUDED.right_eye_va,
        pinhole_left = EXCLUDED.pinhole_left,
        pinhole_right = EXCLUDED.pinhole_right,
        recorded_by = EXCLUDED.recorded_by,
        updated_at = NOW();
END;
$$;


-- 2.3 Cancel/Remove Participant from Active Queue Procedure
CREATE OR REPLACE PROCEDURE sp_cancel_participant_queue(
    p_participant_id VARCHAR,
    p_station_name VARCHAR,
    p_reason TEXT,
    p_performed_by VARCHAR
)
LANGUAGE plpgsql
AS $$
BEGIN
    UPDATE station_queues
    SET status = 'CANCELLED',
        cancellation_reason = p_reason,
        updated_by = p_performed_by,
        updated_at = NOW()
    WHERE participant_id = p_participant_id
      AND station_name = p_station_name
      AND status IN ('WAITING', 'IN_PROGRESS');

    -- Insert cancellation into audit logs
    INSERT INTO audit_logs (participant_id, action, station_name, performed_by, details, created_at)
    VALUES (p_participant_id, 'QUEUE_CANCELLED', p_station_name, p_performed_by, p_reason, NOW());
END;
$$;


-- -----------------------------------------------------------------------------
-- 3. USER-DEFINED FUNCTIONS (UDFs)
-- -----------------------------------------------------------------------------

-- 3.1 Check Overall Participant Screening Completion Status
-- Returns TRUE if a participant has completed all mandatory stations.
CREATE OR REPLACE FUNCTION fn_check_participant_completion(
    p_participant_id VARCHAR
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
    v_total_mandatory_stations INT;
    v_completed_mandatory_stations INT;
BEGIN
    -- Count mandatory stations configured in the system
    SELECT COUNT(DISTINCT station_name) 
    INTO v_total_mandatory_stations 
    FROM screening_stations 
    WHERE is_mandatory = TRUE;

    -- Count completed mandatory stations for the participant
    SELECT COUNT(DISTINCT sq.station_name) 
    INTO v_completed_mandatory_stations 
    FROM station_queues sq
    JOIN screening_stations ss ON sq.station_name = ss.station_name
    WHERE sq.participant_id = p_participant_id 
      AND sq.status = 'COMPLETED'
      AND ss.is_mandatory = TRUE;

    RETURN (v_completed_mandatory_stations >= v_total_mandatory_stations);
END;
$$;


-- 3.2 Visual Acuity Categorization Helper Function
-- Categorizes visual acuity readings into clinical impairment levels.
CREATE OR REPLACE FUNCTION fn_get_visual_acuity_category(
    p_va VARCHAR
)
RETURNS VARCHAR
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN CASE 
        WHEN p_va IN ('20/20', '20/25') THEN 'NORMAL'
        WHEN p_va IN ('20/30', '20/40') THEN 'MILD_IMPAIRMENT'
        WHEN p_va IN ('20/50', '20/100') THEN 'MODERATE_IMPAIRMENT'
        WHEN p_va IN ('20/200') THEN 'SEVERE_IMPAIRMENT'
        ELSE 'UNCLASSIFIED'
    END;
END;
$$;


-- -----------------------------------------------------------------------------
-- 4. MATERIALIZED VIEWS & REFRESH PROCEDURES
-- -----------------------------------------------------------------------------

-- 4.1 Daily Screening Summary Materialized View (FR-07 Reporting Dashboard)
-- Aggregates station throughput, waiting counts, and clinical flag statistics.
DROP MATERIALIZED VIEW IF EXISTS mv_daily_screening_summary;

CREATE MATERIALIZED VIEW mv_daily_screening_summary AS
SELECT 
    DATE(sq.joined_at) AS screening_date,
    sq.station_name,
    COUNT(DISTINCT sq.participant_id) AS total_participants,
    COUNT(CASE WHEN sq.status = 'COMPLETED' THEN 1 END) AS completed_count,
    COUNT(CASE WHEN sq.status = 'WAITING' THEN 1 END) AS waiting_count,
    COUNT(CASE WHEN sq.status = 'IN_PROGRESS' THEN 1 END) AS in_progress_count,
    COUNT(CASE WHEN va.is_flagged = TRUE THEN 1 END) AS total_flagged_cases
FROM station_queues sq
LEFT JOIN visual_acuity_results va ON sq.participant_id = va.participant_id
GROUP BY DATE(sq.joined_at), sq.station_name
WITH DATA;

-- Unique Index required for CONCURRENT REFRESH operations
CREATE UNIQUE INDEX idx_mv_daily_summary ON mv_daily_screening_summary (screening_date, station_name);


-- 4.2 Concurrent Refresh Procedure for Materialized View
-- Can be scheduled via pg_cron or called on-demand by API background jobs.
CREATE OR REPLACE PROCEDURE sp_refresh_screening_summary()
LANGUAGE plpgsql
AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_daily_screening_summary;
END;
$$;