CREATE OR REPLACE FUNCTION "prevent_event_audit_log_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND current_setting('vsms.event_audit_delete_event_id', true) = OLD."event_id"::text THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION 'event audit logs are immutable'
    USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS "event_audit_logs_immutable" ON "event_audit_logs";

CREATE TRIGGER "event_audit_logs_immutable"
BEFORE UPDATE OR DELETE ON "event_audit_logs"
FOR EACH ROW
EXECUTE FUNCTION "prevent_event_audit_log_mutation"();
