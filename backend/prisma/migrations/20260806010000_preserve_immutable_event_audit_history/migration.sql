-- Event audit history is retained after an event is deleted (the preceding
-- migration removes its event FK). Keep those records immutable thereafter.
CREATE OR REPLACE FUNCTION "prevent_event_audit_log_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'event audit logs are immutable'
    USING ERRCODE = '42501';
END;
$$;
