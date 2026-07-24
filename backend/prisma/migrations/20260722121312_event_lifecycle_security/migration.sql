-- Safety gate: this migration introduces a canonical identity foreign-key
-- boundary. Existing domain rows require an explicit, backed-up identity
-- reconciliation migration and must never be guessed or silently orphaned.
DO $$
DECLARE
  table_name text;
  has_rows boolean;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'events', 'staff_assignments', 'reviews', 'referrals',
    'document_artifacts', 'sync_actions'
  ]
  LOOP
    IF to_regclass(format('public.%I', table_name)) IS NOT NULL THEN
      EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I LIMIT 1)', table_name) INTO has_rows;
      IF has_rows THEN
        RAISE EXCEPTION USING
          ERRCODE = 'P0001',
          MESSAGE = format('Identity migration stopped: table %I contains data', table_name),
          DETAIL = 'Back up the database and run the reviewed identity-reconciliation migration before this deployment.',
          HINT = 'Do not disable this guard or fabricate actor users.';
      END IF;
    END IF;
  END LOOP;
END
$$;

-- CreateEnum
CREATE TYPE "SystemRole" AS ENUM ('ADMIN', 'EVENT_MANAGER', 'STAFF');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "EventAuditAction" AS ENUM ('CREATED', 'UPDATED', 'PUBLISHED', 'STARTED', 'COMPLETED', 'CANCELLED');

-- AlterTable
ALTER TABLE "events" ADD COLUMN     "timezone" VARCHAR(100) NOT NULL DEFAULT 'UTC',
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "users" (
    "user_id" UUID NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "password_hash" TEXT NOT NULL,
    "system_role" "SystemRole" NOT NULL DEFAULT 'STAFF',
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "failed_login_attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(3),
    "last_login_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "refresh_sessions" (
    "refresh_session_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "family_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "last_used_at" TIMESTAMPTZ(3),
    "rotated_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "reuse_detected_at" TIMESTAMPTZ(3),
    "replaced_by_session_id" UUID,
    "user_agent_hash" CHAR(64),
    "network_hint" VARCHAR(64),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "refresh_sessions_pkey" PRIMARY KEY ("refresh_session_id")
);

-- CreateTable
CREATE TABLE "event_audit_logs" (
    "event_audit_log_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "action" "EventAuditAction" NOT NULL,
    "before_snapshot" JSONB,
    "after_snapshot" JSONB,
    "correlation_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_audit_logs_pkey" PRIMARY KEY ("event_audit_log_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

CREATE UNIQUE INDEX "refresh_sessions_token_hash_key" ON "refresh_sessions"("token_hash");
CREATE UNIQUE INDEX "refresh_sessions_replaced_by_session_id_key" ON "refresh_sessions"("replaced_by_session_id");
CREATE INDEX "refresh_sessions_user_id_expires_at_idx" ON "refresh_sessions"("user_id", "expires_at");
CREATE INDEX "refresh_sessions_family_id_created_at_idx" ON "refresh_sessions"("family_id", "created_at");
CREATE INDEX "refresh_sessions_expires_at_revoked_at_idx" ON "refresh_sessions"("expires_at", "revoked_at");

-- CreateIndex
CREATE INDEX "users_system_role_status_idx" ON "users"("system_role", "status");

-- CreateIndex
CREATE INDEX "users_status_locked_until_idx" ON "users"("status", "locked_until");

-- CreateIndex
CREATE INDEX "event_audit_logs_event_id_created_at_event_audit_log_id_idx" ON "event_audit_logs"("event_id", "created_at", "event_audit_log_id");

-- CreateIndex
CREATE INDEX "event_audit_logs_actor_user_id_created_at_idx" ON "event_audit_logs"("actor_user_id", "created_at");

-- CreateIndex
CREATE INDEX "event_audit_logs_correlation_id_idx" ON "event_audit_logs"("correlation_id");

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_cancelled_by_user_id_fkey" FOREIGN KEY ("cancelled_by_user_id") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "refresh_sessions" ADD CONSTRAINT "refresh_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "refresh_sessions" ADD CONSTRAINT "refresh_sessions_replaced_by_session_id_fkey" FOREIGN KEY ("replaced_by_session_id") REFERENCES "refresh_sessions"("refresh_session_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_audit_logs" ADD CONSTRAINT "event_audit_logs_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("event_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_audit_logs" ADD CONSTRAINT "event_audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_assignments" ADD CONSTRAINT "staff_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_assignments" ADD CONSTRAINT "staff_assignments_assigned_by_user_id_fkey" FOREIGN KEY ("assigned_by_user_id") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_reviewed_by_user_id_fkey" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_artifacts" ADD CONSTRAINT "document_artifacts_generated_by_user_id_fkey" FOREIGN KEY ("generated_by_user_id") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_actions" ADD CONSTRAINT "sync_actions_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Domain invariants that Prisma cannot express in schema.prisma.
ALTER TABLE "users"
  ADD CONSTRAINT "users_email_normalized_check"
    CHECK (email = lower(btrim(email))),
  ADD CONSTRAINT "users_failed_login_attempts_check"
    CHECK (failed_login_attempts >= 0);

ALTER TABLE "events"
  ADD CONSTRAINT "events_capacity_check"
    CHECK (capacity BETWEEN 1 AND 100000),
  ADD CONSTRAINT "events_time_range_check"
    CHECK (ends_at > starts_at),
  ADD CONSTRAINT "events_version_check"
    CHECK (version > 0),
  ADD CONSTRAINT "events_cancellation_consistency_check"
    CHECK (
      (status = 'CANCELLED' AND cancelled_at IS NOT NULL AND cancelled_by_user_id IS NOT NULL AND char_length(btrim(cancellation_reason)) BETWEEN 10 AND 1000)
      OR
      (status <> 'CANCELLED' AND cancelled_at IS NULL AND cancelled_by_user_id IS NULL AND cancellation_reason IS NULL)
    );

ALTER TABLE "shifts"
  ADD CONSTRAINT "shifts_time_range_check"
    CHECK (ends_at > starts_at),
  ADD CONSTRAINT "shifts_required_staff_check"
    CHECK (required_staff BETWEEN 1 AND 1000);

ALTER TABLE "refresh_sessions"
  ADD CONSTRAINT "refresh_sessions_expiry_check"
    CHECK (expires_at > created_at);

-- Event audit records are append-only even for application code that bypasses
-- the Express service layer. Migration owners can drop the trigger explicitly
-- during a separately reviewed retention operation.
CREATE OR REPLACE FUNCTION reject_event_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'event audit logs are append-only' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER event_audit_logs_append_only
BEFORE UPDATE OR DELETE ON "event_audit_logs"
FOR EACH ROW EXECUTE FUNCTION reject_event_audit_mutation();
