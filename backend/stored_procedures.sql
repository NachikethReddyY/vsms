-- -- =============================================================================
-- ST0528 Database Systems (Project 2) - VSMS Stored Procedures & Triggers
-- File: stored_procedures.sql
-- Description: Triggers, Trigger Functions, Stored Procedures, and Functions 
--              for Visual Screening Management System (VSMS).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. TRIGGER FUNCTIONS & TRIGGERS
-- -----------------------------------------------------------------------------

-- 1.1 Automatic Timestamp Update Trigger Function
-- Ensures 'updated_at' is always current whenever a row is modified.
CREATE OR REPLACE FUNCTION fn_update_timestamp()
RETURNS TRIGGER 
LANGUAGE plpgsql
AS $$ BEGIN     NEW.updated_at = NOW();     RETURN NEW; END; $$;

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
AS $$ BEGIN     NEW.is_flagged := FALSE;     NEW.flag_reason := '';      -- Check Driving Standard Flag: Uncorrected or corrected VA worse than 20/40     IF NEW.left_eye_va IN ('20/50', '20/100', '20/200') OR NEW.right_eye_va IN ('20/50', '20/100', '20/200') THEN         NEW.is_flagged := TRUE;         NEW.flag_reason := NEW.flag_reason \vert{}\vert{} '[Driving Standard: VA worse than 20/40] ';     END IF;      -- Check Pathology & Pinhole Flag: Corrected VA <= 20/30 and pinhole does not improve     IF NEW.pinhole_left IN ('20/40', '20/50', '20/100', '20/200') THEN         NEW.is_flagged := TRUE;         NEW.flag_reason := NEW.flag_reason \vert{}\vert{} '[Pathology: Pinhole fails to improve vision] ';     END IF;      RETURN NEW; END; $$;

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
AS $$ BEGIN     IF NEW.status = 'COMPLETED' AND (OLD.status IS NULL OR OLD.status != 'COMPLETED') THEN         INSERT INTO audit_logs (participant_id, action, station_name, performed_by, created_at)         VALUES (NEW.participant_id, 'STATION_COMPLETED', NEW.station_name, NEW.updated_by, NOW());     END IF;     RETURN NEW; END; $$;

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