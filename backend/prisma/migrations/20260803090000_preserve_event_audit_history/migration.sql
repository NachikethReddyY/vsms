-- Event audit history is logically keyed by event_id but retained after an event is deleted.
ALTER TABLE "event_audit_logs" DROP CONSTRAINT IF EXISTS "event_audit_logs_event_id_fkey";
