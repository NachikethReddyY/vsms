-- Generic audit_logs and auth_audit_logs are append-only: they must never be
-- updated or deleted, even by direct SQL. Only INSERT is permitted.
-- (event_audit_logs already has its own immutability trigger.)

CREATE OR REPLACE FUNCTION "prevent_audit_log_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit logs are immutable'
    USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS "audit_logs_immutable" ON "audit_logs";
CREATE TRIGGER "audit_logs_immutable"
BEFORE UPDATE OR DELETE ON "audit_logs"
FOR EACH ROW
EXECUTE FUNCTION "prevent_audit_log_mutation"();

DROP TRIGGER IF EXISTS "auth_audit_logs_immutable" ON "auth_audit_logs";
CREATE TRIGGER "auth_audit_logs_immutable"
BEFORE UPDATE OR DELETE ON "auth_audit_logs"
FOR EACH ROW
EXECUTE FUNCTION "prevent_audit_log_mutation"();
