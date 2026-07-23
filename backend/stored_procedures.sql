-- =============================================================================
-- ST0528 Database Systems (Project 2) - VSMS Stored Procedures, Functions & Triggers
-- File: stored_procedures.sql
-- Description: Consolidated enterprise-grade database objects for the Visual 
--              Screening Management System (VSMS).
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 0. SUPPORTING TABLES & SCHEMAS
-- -----------------------------------------------------------------------------

-- Core Participants Table
CREATE TABLE IF NOT EXISTS participants (
    participant_id VARCHAR(50) PRIMARY KEY,
    full_name VARCHAR(100) NOT NULL,
    date_of_birth DATE,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Core Station Queues Table
CREATE TABLE IF NOT EXISTS station_queues (
    queue_id BIGSERIAL PRIMARY KEY,
    participant_id VARCHAR(50) NOT NULL REFERENCES participants(participant_id) ON DELETE CASCADE,
    station_name VARCHAR(100) NOT NULL,
    status VARCHAR(20) NOT NULL CHECK (status IN ('WAITING', 'IN_PROGRESS', 'COMPLETED', 'SKIPPED', 'CANCELLED')),
    created_by VARCHAR(50) NOT NULL,
    updated_by VARCHAR(50),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMPTZ
);

-- Core Visual Acuity Results Table
CREATE TABLE IF NOT EXISTS visual_acuity_results (
    participant_id VARCHAR(50) PRIMARY KEY REFERENCES participants(participant_id) ON DELETE CASCADE,
    left_eye_va VARCHAR(10),
    right_eye_va VARCHAR(10),
    pinhole_left VARCHAR(10),
    pinhole_right VARCHAR(10),
    is_flagged BOOLEAN DEFAULT FALSE,
    flag_reason TEXT,
    recorded_by VARCHAR(50) NOT NULL,
    recorded_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Role-Based Access Control Mapping Table (BR-06 / FR-02)
CREATE TABLE IF NOT EXISTS user_roles (
    user_id VARCHAR(50) NOT NULL,
    station_name VARCHAR(50) NOT NULL,
    role_name VARCHAR(50) NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    granted_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, station_name)
);

-- Immutable Security & Operational Audit Log Table (BR-06)
CREATE TABLE IF NOT EXISTS audit_logs (
    audit_id BIGSERIAL PRIMARY KEY,
    participant_id VARCHAR(50) NOT NULL,
    action VARCHAR(100) NOT NULL,
    station_name VARCHAR(100) NOT NULL,
    performed_by VARCHAR(50) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Centralized System Error & Exception Log Table
CREATE TABLE IF NOT EXISTS system_error_logs (
    error_id BIGSERIAL PRIMARY KEY,
    procedure_name VARCHAR(100) NOT NULL,
    error_code VARCHAR(10) NOT NULL,
    error_message TEXT NOT NULL,
    participant_id VARCHAR(50),
    performed_by VARCHAR(50),
    logged_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);


-- -----------------------------------------------------------------------------
-- 1. USER-DEFINED FUNCTIONS (UDFs)
-- -----------------------------------------------------------------------------

-- 1.1 Calculate Age from Date of Birth (Scalar UDF)
CREATE OR REPLACE FUNCTION fn_calculate_age(p_dob DATE)
RETURNS INT
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
    IF p_dob IS NULL THEN
        RETURN NULL;
    END IF;
    RETURN EXTRACT(YEAR FROM AGE(CURRENT_DATE, p_dob));
END;
$$;

-- 1.2 Validate Visual Acuity Format (Scalar UDF)
CREATE OR REPLACE FUNCTION fn_is_valid_va_notation(p_va VARCHAR)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
    IF p_va IS NULL OR p_va = '' THEN
        RETURN TRUE; -- Allow NULL/empty for optional fields
    END IF;
    -- Validates standard Snellen format (e.g., 20/20 up to 20/400)
    RETURN p_va ~ '^20\/(10|15|20|25|30|40|50|60|70|80|100|200|400)$';
END;
$$;

-- 1.3 Active Station Queue Fetcher (Table-Valued UDF)
CREATE OR REPLACE FUNCTION fn_get_station_queue(p_station_name VARCHAR(50))
RETURNS TABLE (
    queue_id BIGINT,
    participant_id VARCHAR(50),
    participant_name VARCHAR(100),
    status VARCHAR(20),
    wait_time_minutes NUMERIC,
    created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        sq.queue_id,
        sq.participant_id,
        p.full_name AS participant_name,
        sq.status,
        ROUND((EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - sq.created_at)) / 60)::NUMERIC, 1) AS wait_time_minutes,
        sq.created_at
    FROM station_queues sq
    JOIN participants p ON sq.participant_id = p.participant_id
    WHERE sq.station_name = p_station_name
      AND sq.status IN ('WAITING', 'IN_PROGRESS')
    ORDER BY sq.created_at ASC;
END;
$$;

-- 1.4 Participant Audit Trajectory Fetcher (Table-Valued UDF)
CREATE OR REPLACE FUNCTION fn_get_participant_history(p_participant_id VARCHAR(50))
RETURNS TABLE (
    audit_id BIGINT,
    action VARCHAR(100),
    station_name VARCHAR(100),
    performed_by VARCHAR(50),
    event_timestamp TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        al.audit_id,
        al.action,
        al.station_name,
        al.performed_by,
        al.created_at AS timestamp
    FROM audit_logs al
    WHERE al.participant_id = p_participant_id
    ORDER BY al.created_at ASC;
END;
$$;


-- -----------------------------------------------------------------------------
-- 2. TRIGGER FUNCTIONS & TRIGGERS
-- -----------------------------------------------------------------------------

-- 2.1 Automatic Timestamp Update Trigger Function
CREATE OR REPLACE FUNCTION fn_update_timestamp()
RETURNS TRIGGER 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN 
    NEW.updated_at = CURRENT_TIMESTAMP; 
    RETURN NEW; 
END; 
$$;

DROP TRIGGER IF EXISTS trg_participants_updated_at ON participants;
CREATE TRIGGER trg_participants_updated_at
BEFORE UPDATE ON participants
FOR EACH ROW
EXECUTE FUNCTION fn_update_timestamp();


-- 2.2 Clinical Auto-Flagging Trigger Function (FR-05)
CREATE OR REPLACE FUNCTION fn_auto_flag_visual_acuity()
RETURNS TRIGGER 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN 
    NEW.is_flagged := FALSE; 
    NEW.flag_reason := COALESCE(NEW.flag_reason, ''); 

    -- Check Driving Standard Flag: Uncorrected or corrected VA worse than 20/40
    IF NEW.left_eye_va IN ('20/50', '20/60', '20/70', '20/80', '20/100', '20/200', '20/400') 
       OR NEW.right_eye_va IN ('20/50', '20/60', '20/70', '20/80', '20/100', '20/200', '20/400') THEN 
        NEW.is_flagged := TRUE; 
        NEW.flag_reason := NEW.flag_reason || '[Driving Standard: VA worse than 20/40] '; 
    END IF; 

    -- Check Pathology & Pinhole Flag: Corrected VA <= 20/30 and pinhole fails to improve
    IF NEW.pinhole_left IN ('20/40', '20/50', '20/60', '20/70', '20/80', '20/100', '20/200', '20/400') 
       OR NEW.pinhole_right IN ('20/40', '20/50', '20/60', '20/70', '20/80', '20/100', '20/200', '20/400') THEN 
        NEW.is_flagged := TRUE; 
        NEW.flag_reason := NEW.flag_reason || '[Pathology: Pinhole fails to improve vision] '; 
    END IF; 

    RETURN NEW; 
END; 
$$;

DROP TRIGGER IF EXISTS trg_auto_flag_va ON visual_acuity_results;
CREATE TRIGGER trg_auto_flag_va
BEFORE INSERT OR UPDATE ON visual_acuity_results
FOR EACH ROW
EXECUTE FUNCTION fn_auto_flag_visual_acuity();


-- 2.3 Audit Logger Trigger Function (BR-06 Compliance)
CREATE OR REPLACE FUNCTION fn_audit_queue_transition()
RETURNS TRIGGER 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN 
    IF NEW.status = 'COMPLETED' AND (OLD.status IS NULL OR OLD.status != 'COMPLETED') THEN 
        INSERT INTO audit_logs (
            participant_id, 
            action, 
            station_name, 
            performed_by, 
            created_at
        ) VALUES (
            NEW.participant_id, 
            'STATION_COMPLETED_TRIGGER', 
            NEW.station_name, 
            COALESCE(NEW.updated_by, 'SYSTEM'), 
            CURRENT_TIMESTAMP
        ); 
    END IF; 
    RETURN NEW; 
END; 
$$;

DROP TRIGGER IF EXISTS trg_audit_queue_change ON station_queues;
CREATE TRIGGER trg_audit_queue_change
AFTER UPDATE ON station_queues
FOR EACH ROW
EXECUTE FUNCTION fn_audit_queue_transition();


-- -----------------------------------------------------------------------------
-- 3. STORED PROCEDURES
-- -----------------------------------------------------------------------------

-- 3.1 Participant Station Queue Transfer Procedure (FR-04)
CREATE OR REPLACE PROCEDURE sp_transfer_participant(
    p_participant_id VARCHAR(50),
    p_current_station VARCHAR(50),
    p_next_station VARCHAR(50),
    p_performed_by VARCHAR(50)
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_queue_id BIGINT;
    v_has_permission BOOLEAN;
    v_err_state TEXT;
    v_err_msg TEXT;
BEGIN
    -- 1. Parameter Validation
    IF p_participant_id IS NULL OR p_current_station IS NULL OR p_next_station IS NULL OR p_performed_by IS NULL THEN
        RAISE EXCEPTION 'Invalid Input: All transfer parameters must be non-null.'
            USING ERRCODE = '22023';
    END IF;

    -- 2. Role-Based Access Control Verification (BR-06)
    SELECT EXISTS (
        SELECT 1 FROM user_roles 
        WHERE user_id = p_performed_by 
          AND station_name = p_current_station 
          AND is_active = TRUE
    ) INTO v_has_permission;

    IF NOT v_has_permission THEN
        INSERT INTO system_error_logs (procedure_name, error_code, error_message, participant_id, performed_by)
        VALUES ('sp_transfer_participant', '42000', 'UNAUTHORIZED_STATION_ACCESS_ATTEMPT', p_participant_id, p_performed_by);

        RAISE EXCEPTION 'Access Denied: User % is not authorized to execute operations at station %', p_performed_by, p_current_station
            USING ERRCODE = '42000';
    END IF;

    -- 3. Concurrency Protection: Lock Current Queue Record (Pessimistic Lock)
    SELECT queue_id INTO v_queue_id
    FROM station_queues
    WHERE participant_id = p_participant_id 
      AND station_name = p_current_station 
      AND status = 'IN_PROGRESS'
    FOR UPDATE;

    IF v_queue_id IS NULL THEN
        RAISE EXCEPTION 'Active in-progress queue record not found for participant % at station %', p_participant_id, p_current_station
            USING ERRCODE = 'P0002';
    END IF;

    -- 4. Atomic Station Queue State Transition
    UPDATE station_queues
    SET status = 'COMPLETED',
        updated_by = p_performed_by,
        completed_at = CURRENT_TIMESTAMP
    WHERE queue_id = v_queue_id;

    -- Enqueue into Next Target Station
    INSERT INTO station_queues (
        participant_id, 
        station_name, 
        status, 
        created_by, 
        created_at
    ) VALUES (
        p_participant_id, 
        p_next_station, 
        'WAITING', 
        p_performed_by, 
        CURRENT_TIMESTAMP
    );

    -- 5. Immutable Audit Trail Logging
    INSERT INTO audit_logs (
        participant_id, 
        action, 
        station_name, 
        performed_by, 
        created_at
    ) VALUES (
        p_participant_id, 
        'TRANSFER_EXECUTED', 
        p_current_station || ' -> ' || p_next_station, 
        p_performed_by, 
        CURRENT_TIMESTAMP
    );

EXCEPTION
    WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS 
            v_err_state = RETURNED_SQLSTATE,
            v_err_msg = MESSAGE_TEXT;
            
        INSERT INTO system_error_logs (
            procedure_name, 
            error_code, 
            error_message, 
            participant_id, 
            performed_by
        ) VALUES (
            'sp_transfer_participant', 
            v_err_state, 
            v_err_msg, 
            p_participant_id, 
            p_performed_by
        );
        
        RAISE EXCEPTION 'Transfer transaction failed for Participant ID %: % (SQLSTATE %)', p_participant_id, v_err_msg, v_err_state;
END;
$$;


-- 3.2 Record Visual Acuity Screening Results Procedure (FR-05)
CREATE OR REPLACE PROCEDURE sp_record_visual_acuity(
    p_participant_id VARCHAR(50),
    p_left_eye_va VARCHAR(10),
    p_right_eye_va VARCHAR(10),
    p_pinhole_left VARCHAR(10),
    p_pinhole_right VARCHAR(10),
    p_performed_by VARCHAR(50)
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_has_permission BOOLEAN;
    v_err_state TEXT;
    v_err_msg TEXT;
BEGIN
    -- 1. Input Format Validation via UDFs
    IF NOT fn_is_valid_va_notation(p_left_eye_va) OR NOT fn_is_valid_va_notation(p_right_eye_va) THEN
        RAISE EXCEPTION 'Invalid Visual Acuity Notation: Must conform to Snellen standards (e.g., 20/20, 20/40).'
            USING ERRCODE = '22023';
    END IF;

    -- 2. Authorization Check
    SELECT EXISTS (
        SELECT 1 FROM user_roles 
        WHERE user_id = p_performed_by 
          AND station_name = 'VISUAL_ACUITY' 
          AND is_active = TRUE
    ) INTO v_has_permission;

    IF NOT v_has_permission THEN
        INSERT INTO system_error_logs (procedure_name, error_code, error_message, participant_id, performed_by)
        VALUES ('sp_record_visual_acuity', '42000', 'UNAUTHORIZED_VA_STATION_ACCESS', p_participant_id, p_performed_by);

        RAISE EXCEPTION 'Access Denied: User % is not authorized to submit visual acuity exams.', p_performed_by
            USING ERRCODE = '42000';
    END IF;

    -- 3. Atomic Upsert Clinical Record
    INSERT INTO visual_acuity_results (
        participant_id,
        left_eye_va,
        right_eye_va,
        pinhole_left,
        pinhole_right,
        recorded_by,
        recorded_at
    ) VALUES (
        p_participant_id,
        p_left_eye_va,
        p_right_eye_va,
        p_pinhole_left,
        p_pinhole_right,
        p_performed_by,
        CURRENT_TIMESTAMP
    )
    ON CONFLICT (participant_id) DO UPDATE 
    SET left_eye_va = EXCLUDED.left_eye_va,
        right_eye_va = EXCLUDED.right_eye_va,
        pinhole_left = EXCLUDED.pinhole_left,
        pinhole_right = EXCLUDED.pinhole_right,
        recorded_by = EXCLUDED.recorded_by,
        recorded_at = CURRENT_TIMESTAMP;

    -- 4. Audit Log
    INSERT INTO audit_logs (
        participant_id, action, station_name, performed_by, created_at
    ) VALUES (
        p_participant_id, 'CLINICAL_DATA_RECORDED', 'VISUAL_ACUITY', p_performed_by, CURRENT_TIMESTAMP
    );

EXCEPTION
    WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS 
            v_err_state = RETURNED_SQLSTATE,
            v_err_msg = MESSAGE_TEXT;
            
        INSERT INTO system_error_logs (
            procedure_name, error_code, error_message, participant_id, performed_by
        ) VALUES (
            'sp_record_visual_acuity', v_err_state, v_err_msg, p_participant_id, p_performed_by
        );
        
        RAISE EXCEPTION 'Visual Acuity recording failed for Participant ID %: %', p_participant_id, v_err_msg;
END;
$$;


-- -----------------------------------------------------------------------------
-- 4. PERFORMANCE & REPORTING OBJECTS
-- -----------------------------------------------------------------------------

-- Partial Index for Active Station Queues Optimization
CREATE INDEX IF NOT EXISTS idx_active_queues 
ON station_queues (station_name, status) 
WHERE status IN ('WAITING', 'IN_PROGRESS');

-- Operational Reporting Materialized View
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_station_throughput AS
SELECT 
    station_name,
    COUNT(CASE WHEN status = 'COMPLETED' THEN 1 END) AS total_completed,
    COUNT(CASE WHEN status = 'WAITING' THEN 1 END) AS total_waiting,
    AVG(EXTRACT(EPOCH FROM (completed_at - created_at))/60)::NUMERIC(10,2) AS avg_wait_time_minutes
FROM station_queues
GROUP BY station_name;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_station_throughput ON mv_station_throughput(station_name);

COMMIT;