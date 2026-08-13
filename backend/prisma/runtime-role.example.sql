-- Deployment template: execute as the database owner after substituting a
-- secret-managed password. Never use the migration owner in the application.
CREATE ROLE vsms_runtime LOGIN PASSWORD :'runtime_password';
GRANT CONNECT ON DATABASE :"database_name" TO vsms_runtime;
GRANT USAGE ON SCHEMA public TO vsms_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO vsms_runtime;
GRANT EXECUTE ON FUNCTION public.register_participant_for_event(UUID, UUID, UUID, VARCHAR, BOOLEAN) TO vsms_runtime;
GRANT EXECUTE ON FUNCTION public.cancel_event_registration(UUID, UUID, VARCHAR) TO vsms_runtime;
GRANT EXECUTE ON FUNCTION public.check_in_event_registration(UUID, UUID, UUID) TO vsms_runtime;
GRANT EXECUTE ON FUNCTION public.get_event_registration_summary(UUID) TO vsms_runtime;
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE event_audit_logs FROM vsms_runtime;
REVOKE CREATE ON SCHEMA public FROM vsms_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO vsms_runtime;
