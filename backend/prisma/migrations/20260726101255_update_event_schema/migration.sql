-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SystemRole" AS ENUM ('ADMIN', 'EVENT_MANAGER', 'STAFF');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "EventAuditAction" AS ENUM ('CREATED', 'UPDATED', 'PUBLISHED', 'STARTED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ShiftStatus" AS ENUM ('PLANNED', 'ACTIVE', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "StaffAssignmentRole" AS ENUM ('EVENT_MANAGER', 'REGISTRATION', 'SCREENER', 'REVIEWER', 'SUPPORT');

-- CreateEnum
CREATE TYPE "StaffAssignmentStatus" AS ENUM ('ASSIGNED', 'CONFIRMED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "EventRegistrationStatus" AS ENUM ('SIGNED_UP', 'CHECKED_IN', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "StationType" AS ENUM ('VISUAL_ACUITY', 'REFRACTION', 'COLOUR_VISION', 'EYE_HEALTH');

-- CreateEnum
CREATE TYPE "QueueStatus" AS ENUM ('WAITING', 'CALLED', 'IN_PROGRESS', 'COMPLETED', 'SKIPPED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ScanResult" AS ENUM ('SUCCESS', 'INVALID_QR', 'EXPIRED', 'ALREADY_CHECKED_IN', 'UNAUTHORIZED_STATION');

-- CreateEnum
CREATE TYPE "OverallFlag" AS ENUM ('NORMAL', 'REVIEW', 'REFER', 'URGENT');

-- CreateEnum
CREATE TYPE "ReviewOutcome" AS ENUM ('COMPLETE', 'MONITOR', 'REFER', 'URGENT_ESCALATION');

-- CreateEnum
CREATE TYPE "ClinicalUrgency" AS ENUM ('ROUTINE', 'PRIORITY', 'URGENT', 'EMERGENCY');

-- CreateEnum
CREATE TYPE "ReferralStatus" AS ENUM ('DRAFT', 'ISSUED', 'SENT', 'ACKNOWLEDGED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('REFERRAL_PDF', 'CLINICAL_SUMMARY_PDF');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('EMAIL');

-- CreateEnum
CREATE TYPE "NotificationDeliveryStatus" AS ENUM ('QUEUED', 'SENDING', 'DELIVERED', 'FAILED', 'BOUNCED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SyncOperation" AS ENUM ('CREATE', 'UPDATE', 'DELETE');

-- CreateEnum
CREATE TYPE "SyncActionStatus" AS ENUM ('PENDING', 'PROCESSING', 'APPLIED', 'CONFLICT', 'FAILED');

-- CreateEnum
CREATE TYPE "IncidentSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateTable
CREATE TABLE "users" (
    "user_id" UUID NOT NULL,
    "username" VARCHAR(100) NOT NULL,
    "full_name" VARCHAR(100) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "contact_number" VARCHAR(20),
    "emergency_contact" VARCHAR(20),
    "date_of_birth" DATE,
    "gender" VARCHAR(1),
    "employee_number" VARCHAR(20) NOT NULL,
    "department" VARCHAR(100),
    "system_role" "SystemRole" NOT NULL DEFAULT 'STAFF',
    "designation" VARCHAR(100),
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "failed_login_attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(3),
    "last_login_at" TIMESTAMPTZ(3),
    "consent_confirmation" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "user_credentials" (
    "credential_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_credentials_pkey" PRIMARY KEY ("credential_id")
);

-- CreateTable
CREATE TABLE "refresh_sessions" (
    "refresh_session_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "family_id" UUID NOT NULL,
    "user_agent_hash" CHAR(64),
    "network_hint" VARCHAR(64),
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMPTZ(3),
    "rotated_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "reuse_detected_at" TIMESTAMPTZ(3),
    "replaced_by_session_id" UUID,

    CONSTRAINT "refresh_sessions_pkey" PRIMARY KEY ("refresh_session_id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "role_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "SystemRole" NOT NULL,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("role_id")
);

-- CreateTable
CREATE TABLE "participants" (
    "participant_id" UUID NOT NULL,
    "nric" TEXT NOT NULL,
    "nric_masked" VARCHAR(9) NOT NULL,
    "first_name" VARCHAR(100) NOT NULL,
    "last_name" VARCHAR(100) NOT NULL,
    "date_of_birth" DATE NOT NULL,
    "gender" VARCHAR(1) NOT NULL,
    "race" VARCHAR(50),
    "nationality" VARCHAR(50) DEFAULT 'Singaporean',
    "address_street" VARCHAR(255),
    "address_unit" VARCHAR(20),
    "address_postal_code" VARCHAR(10),
    "contact_number" VARCHAR(20) NOT NULL,
    "emergency_contact" VARCHAR(20) NOT NULL,
    "emergency_contact_name" VARCHAR(100),
    "consent_given" BOOLEAN NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "participants_pkey" PRIMARY KEY ("participant_id")
);

-- CreateTable
CREATE TABLE "events" (
    "event_id" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "description" TEXT,
    "banner_key" VARCHAR(50) NOT NULL DEFAULT 'COMMUNITY_SCREENING',
    "artwork_data_url" TEXT,
    "venue" VARCHAR(255) NOT NULL,
    "address" VARCHAR(500),
    "postal_code" VARCHAR(6),
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "location_provider" VARCHAR(20),
    "location_reference" VARCHAR(255),
    "timezone" VARCHAR(100) NOT NULL DEFAULT 'UTC',
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "capacity" INTEGER NOT NULL,
    "expected_attendance" INTEGER,
    "create_idempotency_key" VARCHAR(100),
    "create_payload_hash" CHAR(64),
    "status" "EventStatus" NOT NULL DEFAULT 'DRAFT',
    "created_by_user_id" UUID NOT NULL,
    "cancelled_by_user_id" UUID,
    "cancelled_at" TIMESTAMPTZ(3),
    "cancellation_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "events_pkey" PRIMARY KEY ("event_id")
);

-- CreateTable
CREATE TABLE "event_days" (
    "event_day_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "event_days_pkey" PRIMARY KEY ("event_day_id")
);

-- CreateTable
CREATE TABLE "event_station_availabilities" (
    "event_station_availability_id" UUID NOT NULL,
    "event_station_id" UUID NOT NULL,
    "event_day_id" UUID NOT NULL,
    "is_available" BOOLEAN NOT NULL DEFAULT true,
    "starts_at" TIMESTAMPTZ(3),
    "ends_at" TIMESTAMPTZ(3),
    "capacity" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "event_station_availabilities_pkey" PRIMARY KEY ("event_station_availability_id")
);

-- CreateTable
CREATE TABLE "event_registrations" (
    "registration_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "participant_id" UUID NOT NULL,
    "registered_by" UUID NOT NULL,
    "registration_status" "EventRegistrationStatus" NOT NULL DEFAULT 'SIGNED_UP',
    "participant_display_name" VARCHAR(150),
    "queue_number" INTEGER,
    "pass_token" VARCHAR(255),
    "checked_in" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "event_registrations_pkey" PRIMARY KEY ("registration_id")
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

-- CreateTable
CREATE TABLE "shifts" (
    "shift_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "required_staff" INTEGER NOT NULL DEFAULT 1,
    "status" "ShiftStatus" NOT NULL DEFAULT 'PLANNED',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "shifts_pkey" PRIMARY KEY ("shift_id")
);

-- CreateTable
CREATE TABLE "stations" (
    "station_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "station_name" VARCHAR(100) NOT NULL,
    "station_type" "StationType" NOT NULL,
    "station_order" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "stations_pkey" PRIMARY KEY ("station_id")
);

-- CreateTable
CREATE TABLE "staff_assignments" (
    "assignment_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "station_id" UUID,
    "shift_id" UUID,
    "user_id" UUID NOT NULL,
    "assigned_by" UUID NOT NULL,
    "assignment_role" "StaffAssignmentRole",
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignment_status" "StaffAssignmentStatus" NOT NULL DEFAULT 'ASSIGNED',
    "status" "StaffAssignmentStatus" DEFAULT 'ASSIGNED',
    "notes" TEXT,

    CONSTRAINT "staff_assignments_pkey" PRIMARY KEY ("assignment_id")
);

-- CreateTable
CREATE TABLE "queue_entries" (
    "queue_id" UUID NOT NULL,
    "registration_id" UUID NOT NULL,
    "station_id" UUID NOT NULL,
    "queue_number" INTEGER NOT NULL,
    "status" "QueueStatus" NOT NULL DEFAULT 'WAITING',
    "entered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "called_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "left_queue_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "queue_entries_pkey" PRIMARY KEY ("queue_id")
);

-- CreateTable
CREATE TABLE "queue_movements" (
    "movement_id" UUID NOT NULL,
    "registration_id" UUID NOT NULL,
    "from_station_id" UUID NOT NULL,
    "to_station_id" UUID NOT NULL,
    "moved_by" UUID NOT NULL,
    "movement_reason" VARCHAR(100) NOT NULL,
    "movement_time" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "queue_movements_pkey" PRIMARY KEY ("movement_id")
);

-- CreateTable
CREATE TABLE "scan_logs" (
    "scan_id" UUID NOT NULL,
    "qr_id" UUID,
    "user_id" UUID,
    "station_id" UUID NOT NULL,
    "scan_result" "ScanResult" NOT NULL,
    "device_name" VARCHAR(100) NOT NULL,
    "ip_address" VARCHAR(45) NOT NULL,
    "scanned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "registration_id" UUID,

    CONSTRAINT "scan_logs_pkey" PRIMARY KEY ("scan_id")
);

-- CreateTable
CREATE TABLE "qr_code_passes" (
    "qr_id" UUID NOT NULL,
    "registration_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "revoked_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "qr_code_passes_pkey" PRIMARY KEY ("qr_id")
);

-- CreateTable
CREATE TABLE "screening_results" (
    "result_id" UUID NOT NULL,
    "registration_id" UUID NOT NULL,
    "station_id" UUID NOT NULL,
    "recorded_by_user_id" UUID NOT NULL,
    "queue_entry_id" UUID,
    "screening_type" "StationType" NOT NULL,
    "result_data" JSONB NOT NULL,
    "overall_flag" "OverallFlag" NOT NULL DEFAULT 'NORMAL',
    "is_flagged" BOOLEAN NOT NULL DEFAULT false,
    "flag_summary" TEXT,
    "rule_version" VARCHAR(20) NOT NULL DEFAULT 'VSMS-VA-1.0',
    "acknowledged_at" TIMESTAMPTZ(3),
    "idempotency_key" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "screening_results_pkey" PRIMARY KEY ("result_id")
);

-- CreateTable
CREATE TABLE "reviews" (
    "review_id" UUID NOT NULL,
    "registration_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "reviewed_by_user_id" UUID NOT NULL,
    "parent_review_id" UUID,
    "outcome" "ReviewOutcome" NOT NULL,
    "urgency" "ClinicalUrgency" NOT NULL,
    "clinical_summary" TEXT NOT NULL,
    "recommendations" TEXT,
    "reviewed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("review_id")
);

-- CreateTable
CREATE TABLE "referrals" (
    "referral_id" UUID NOT NULL,
    "review_id" UUID NOT NULL,
    "registration_id" UUID NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "destination_name" VARCHAR(200) NOT NULL,
    "destination_email" VARCHAR(255),
    "reason" TEXT NOT NULL,
    "instructions" TEXT,
    "urgency" "ClinicalUrgency" NOT NULL,
    "status" "ReferralStatus" NOT NULL DEFAULT 'DRAFT',
    "referred_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "referrals_pkey" PRIMARY KEY ("referral_id")
);

-- CreateTable
CREATE TABLE "document_artifacts" (
    "document_id" UUID NOT NULL,
    "review_id" UUID NOT NULL,
    "referral_id" UUID,
    "document_type" "DocumentType" NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "storage_key" TEXT NOT NULL,
    "content_hash" CHAR(64) NOT NULL,
    "mime_type" VARCHAR(100) NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "generated_by_user_id" UUID NOT NULL,
    "generated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_artifacts_pkey" PRIMARY KEY ("document_id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "audit_id" UUID NOT NULL,
    "user_id" UUID,
    "action" VARCHAR(100) NOT NULL,
    "resource" VARCHAR(100) NOT NULL,
    "details" JSONB,
    "ip_address" VARCHAR(45),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("audit_id")
);

-- CreateTable
CREATE TABLE "login_history" (
    "login_history_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "success" BOOLEAN NOT NULL,
    "ip_address" VARCHAR(45),
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_history_pkey" PRIMARY KEY ("login_history_id")
);

-- CreateTable
CREATE TABLE "security_incidents" (
    "incident_id" UUID NOT NULL,
    "user_id" UUID,
    "severity" "IncidentSeverity" NOT NULL DEFAULT 'MEDIUM',
    "description" TEXT NOT NULL,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "resolved_by" UUID,
    "resolved_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "security_incidents_pkey" PRIMARY KEY ("incident_id")
);

-- CreateTable
CREATE TABLE "notification_deliveries" (
    "notification_id" UUID NOT NULL,
    "user_id" UUID,
    "referral_id" UUID,
    "channel" "NotificationChannel" NOT NULL DEFAULT 'EMAIL',
    "status" "NotificationDeliveryStatus" NOT NULL DEFAULT 'QUEUED',
    "recipient" VARCHAR(255) NOT NULL,
    "subject" VARCHAR(255) NOT NULL,
    "body" TEXT NOT NULL,
    "failure_reason" TEXT,
    "sent_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("notification_id")
);

-- CreateTable
CREATE TABLE "sync_actions" (
    "sync_action_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "operation" "SyncOperation" NOT NULL,
    "entity_type" VARCHAR(50) NOT NULL,
    "entity_id" UUID NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "SyncActionStatus" NOT NULL DEFAULT 'PENDING',
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "error_log" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sync_actions_pkey" PRIMARY KEY ("sync_action_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_employee_number_key" ON "users"("employee_number");

-- CreateIndex
CREATE INDEX "users_status_department_idx" ON "users"("status", "department");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "user_credentials_user_id_key" ON "user_credentials"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_sessions_token_hash_key" ON "refresh_sessions"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_sessions_replaced_by_session_id_key" ON "refresh_sessions"("replaced_by_session_id");

-- CreateIndex
CREATE INDEX "refresh_sessions_user_id_expires_at_idx" ON "refresh_sessions"("user_id", "expires_at");

-- CreateIndex
CREATE INDEX "refresh_sessions_family_id_created_at_idx" ON "refresh_sessions"("family_id", "created_at");

-- CreateIndex
CREATE INDEX "user_roles_user_id_role_idx" ON "user_roles"("user_id", "role");

-- CreateIndex
CREATE UNIQUE INDEX "user_roles_user_id_role_key" ON "user_roles"("user_id", "role");

-- CreateIndex
CREATE UNIQUE INDEX "participants_nric_key" ON "participants"("nric");

-- CreateIndex
CREATE INDEX "participants_last_name_first_name_idx" ON "participants"("last_name", "first_name");

-- CreateIndex
CREATE INDEX "participants_contact_number_idx" ON "participants"("contact_number");

-- CreateIndex
CREATE INDEX "events_status_starts_at_idx" ON "events"("status", "starts_at");

-- CreateIndex
CREATE INDEX "events_created_by_user_id_idx" ON "events"("created_by_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "events_created_by_user_id_create_idempotency_key_key" ON "events"("created_by_user_id", "create_idempotency_key");

-- CreateIndex
CREATE INDEX "event_days_event_id_starts_at_idx" ON "event_days"("event_id", "starts_at");

-- CreateIndex
CREATE UNIQUE INDEX "event_days_event_id_date_key" ON "event_days"("event_id", "date");

-- CreateIndex
CREATE INDEX "event_station_availabilities_event_day_id_is_available_idx" ON "event_station_availabilities"("event_day_id", "is_available");

-- CreateIndex
CREATE UNIQUE INDEX "event_station_availabilities_event_station_id_event_day_id_key" ON "event_station_availabilities"("event_station_id", "event_day_id");

-- CreateIndex
CREATE UNIQUE INDEX "event_registrations_pass_token_key" ON "event_registrations"("pass_token");

-- CreateIndex
CREATE INDEX "event_registrations_event_id_registration_status_checked_in_idx" ON "event_registrations"("event_id", "registration_status", "checked_in");

-- CreateIndex
CREATE INDEX "event_registrations_participant_id_idx" ON "event_registrations"("participant_id");

-- CreateIndex
CREATE INDEX "event_registrations_registered_by_idx" ON "event_registrations"("registered_by");

-- CreateIndex
CREATE UNIQUE INDEX "event_registrations_event_id_participant_id_key" ON "event_registrations"("event_id", "participant_id");

-- CreateIndex
CREATE INDEX "event_audit_logs_event_id_created_at_event_audit_log_id_idx" ON "event_audit_logs"("event_id", "created_at", "event_audit_log_id");

-- CreateIndex
CREATE INDEX "event_audit_logs_actor_user_id_created_at_idx" ON "event_audit_logs"("actor_user_id", "created_at");

-- CreateIndex
CREATE INDEX "event_audit_logs_correlation_id_idx" ON "event_audit_logs"("correlation_id");

-- CreateIndex
CREATE INDEX "shifts_event_id_starts_at_idx" ON "shifts"("event_id", "starts_at");

-- CreateIndex
CREATE UNIQUE INDEX "shifts_event_id_name_starts_at_key" ON "shifts"("event_id", "name", "starts_at");

-- CreateIndex
CREATE INDEX "stations_event_id_is_active_station_order_idx" ON "stations"("event_id", "is_active", "station_order");

-- CreateIndex
CREATE UNIQUE INDEX "stations_event_id_station_type_key" ON "stations"("event_id", "station_type");

-- CreateIndex
CREATE UNIQUE INDEX "stations_event_id_station_order_key" ON "stations"("event_id", "station_order");

-- CreateIndex
CREATE INDEX "staff_assignments_event_id_assignment_status_idx" ON "staff_assignments"("event_id", "assignment_status");

-- CreateIndex
CREATE INDEX "staff_assignments_user_id_assignment_status_idx" ON "staff_assignments"("user_id", "assignment_status");

-- CreateIndex
CREATE UNIQUE INDEX "staff_assignments_event_id_user_id_shift_id_station_id_key" ON "staff_assignments"("event_id", "user_id", "shift_id", "station_id");

-- CreateIndex
CREATE INDEX "queue_entries_station_id_status_queue_number_idx" ON "queue_entries"("station_id", "status", "queue_number");

-- CreateIndex
CREATE INDEX "queue_entries_registration_id_status_idx" ON "queue_entries"("registration_id", "status");

-- CreateIndex
CREATE INDEX "queue_movements_registration_id_idx" ON "queue_movements"("registration_id");

-- CreateIndex
CREATE INDEX "queue_movements_moved_by_idx" ON "queue_movements"("moved_by");

-- CreateIndex
CREATE INDEX "scan_logs_station_id_scanned_at_idx" ON "scan_logs"("station_id", "scanned_at");

-- CreateIndex
CREATE INDEX "scan_logs_qr_id_idx" ON "scan_logs"("qr_id");

-- CreateIndex
CREATE INDEX "scan_logs_registration_id_idx" ON "scan_logs"("registration_id");

-- CreateIndex
CREATE UNIQUE INDEX "qr_code_passes_registration_id_key" ON "qr_code_passes"("registration_id");

-- CreateIndex
CREATE UNIQUE INDEX "qr_code_passes_token_hash_key" ON "qr_code_passes"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "screening_results_idempotency_key_key" ON "screening_results"("idempotency_key");

-- CreateIndex
CREATE INDEX "screening_results_station_id_is_flagged_idx" ON "screening_results"("station_id", "is_flagged");

-- CreateIndex
CREATE INDEX "screening_results_overall_flag_is_flagged_idx" ON "screening_results"("overall_flag", "is_flagged");

-- CreateIndex
CREATE INDEX "screening_results_recorded_by_user_id_idx" ON "screening_results"("recorded_by_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "screening_results_registration_id_station_id_key" ON "screening_results"("registration_id", "station_id");

-- CreateIndex
CREATE INDEX "reviews_registration_id_reviewed_at_idx" ON "reviews"("registration_id", "reviewed_at");

-- CreateIndex
CREATE INDEX "reviews_reviewed_by_user_id_idx" ON "reviews"("reviewed_by_user_id");

-- CreateIndex
CREATE INDEX "reviews_outcome_urgency_idx" ON "reviews"("outcome", "urgency");

-- CreateIndex
CREATE UNIQUE INDEX "reviews_registration_id_version_key" ON "reviews"("registration_id", "version");

-- CreateIndex
CREATE INDEX "referrals_registration_id_created_at_idx" ON "referrals"("registration_id", "created_at");

-- CreateIndex
CREATE INDEX "referrals_review_id_idx" ON "referrals"("review_id");

-- CreateIndex
CREATE INDEX "referrals_created_by_user_id_idx" ON "referrals"("created_by_user_id");

-- CreateIndex
CREATE INDEX "referrals_status_urgency_idx" ON "referrals"("status", "urgency");

-- CreateIndex
CREATE INDEX "document_artifacts_review_id_idx" ON "document_artifacts"("review_id");

-- CreateIndex
CREATE INDEX "document_artifacts_referral_id_idx" ON "document_artifacts"("referral_id");

-- CreateIndex
CREATE INDEX "audit_logs_user_id_created_at_idx" ON "audit_logs"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "login_history_user_id_created_at_idx" ON "login_history"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "user_credentials" ADD CONSTRAINT "user_credentials_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_sessions" ADD CONSTRAINT "refresh_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_sessions" ADD CONSTRAINT "refresh_sessions_replaced_by_session_id_fkey" FOREIGN KEY ("replaced_by_session_id") REFERENCES "refresh_sessions"("refresh_session_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_cancelled_by_user_id_fkey" FOREIGN KEY ("cancelled_by_user_id") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_days" ADD CONSTRAINT "event_days_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("event_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_station_availabilities" ADD CONSTRAINT "event_station_availabilities_event_day_id_fkey" FOREIGN KEY ("event_day_id") REFERENCES "event_days"("event_day_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_registrations" ADD CONSTRAINT "event_registrations_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "participants"("participant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_registrations" ADD CONSTRAINT "event_registrations_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("event_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_registrations" ADD CONSTRAINT "event_registrations_registered_by_fkey" FOREIGN KEY ("registered_by") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_audit_logs" ADD CONSTRAINT "event_audit_logs_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("event_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_audit_logs" ADD CONSTRAINT "event_audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("event_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stations" ADD CONSTRAINT "stations_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("event_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_assignments" ADD CONSTRAINT "staff_assignments_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("event_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_assignments" ADD CONSTRAINT "staff_assignments_station_id_fkey" FOREIGN KEY ("station_id") REFERENCES "stations"("station_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_assignments" ADD CONSTRAINT "staff_assignments_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "shifts"("shift_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_assignments" ADD CONSTRAINT "staff_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_assignments" ADD CONSTRAINT "staff_assignments_assigned_by_fkey" FOREIGN KEY ("assigned_by") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_entries" ADD CONSTRAINT "queue_entries_registration_id_fkey" FOREIGN KEY ("registration_id") REFERENCES "event_registrations"("registration_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_entries" ADD CONSTRAINT "queue_entries_station_id_fkey" FOREIGN KEY ("station_id") REFERENCES "stations"("station_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_movements" ADD CONSTRAINT "queue_movements_registration_id_fkey" FOREIGN KEY ("registration_id") REFERENCES "event_registrations"("registration_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_movements" ADD CONSTRAINT "queue_movements_from_station_id_fkey" FOREIGN KEY ("from_station_id") REFERENCES "stations"("station_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_movements" ADD CONSTRAINT "queue_movements_to_station_id_fkey" FOREIGN KEY ("to_station_id") REFERENCES "stations"("station_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_movements" ADD CONSTRAINT "queue_movements_moved_by_fkey" FOREIGN KEY ("moved_by") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scan_logs" ADD CONSTRAINT "scan_logs_qr_id_fkey" FOREIGN KEY ("qr_id") REFERENCES "qr_code_passes"("qr_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scan_logs" ADD CONSTRAINT "scan_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scan_logs" ADD CONSTRAINT "scan_logs_station_id_fkey" FOREIGN KEY ("station_id") REFERENCES "stations"("station_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scan_logs" ADD CONSTRAINT "scan_logs_registration_id_fkey" FOREIGN KEY ("registration_id") REFERENCES "event_registrations"("registration_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qr_code_passes" ADD CONSTRAINT "qr_code_passes_registration_id_fkey" FOREIGN KEY ("registration_id") REFERENCES "event_registrations"("registration_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qr_code_passes" ADD CONSTRAINT "qr_code_passes_revoked_by_fkey" FOREIGN KEY ("revoked_by") REFERENCES "users"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "screening_results" ADD CONSTRAINT "screening_results_registration_id_fkey" FOREIGN KEY ("registration_id") REFERENCES "event_registrations"("registration_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "screening_results" ADD CONSTRAINT "screening_results_station_id_fkey" FOREIGN KEY ("station_id") REFERENCES "stations"("station_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "screening_results" ADD CONSTRAINT "screening_results_queue_entry_id_fkey" FOREIGN KEY ("queue_entry_id") REFERENCES "queue_entries"("queue_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "screening_results" ADD CONSTRAINT "screening_results_recorded_by_user_id_fkey" FOREIGN KEY ("recorded_by_user_id") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_registration_id_fkey" FOREIGN KEY ("registration_id") REFERENCES "event_registrations"("registration_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_reviewed_by_user_id_fkey" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_parent_review_id_fkey" FOREIGN KEY ("parent_review_id") REFERENCES "reviews"("review_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "reviews"("review_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_artifacts" ADD CONSTRAINT "document_artifacts_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "reviews"("review_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_artifacts" ADD CONSTRAINT "document_artifacts_referral_id_fkey" FOREIGN KEY ("referral_id") REFERENCES "referrals"("referral_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_artifacts" ADD CONSTRAINT "document_artifacts_generated_by_user_id_fkey" FOREIGN KEY ("generated_by_user_id") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "login_history" ADD CONSTRAINT "login_history_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_incidents" ADD CONSTRAINT "security_incidents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_incidents" ADD CONSTRAINT "security_incidents_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "users"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_referral_id_fkey" FOREIGN KEY ("referral_id") REFERENCES "referrals"("referral_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_actions" ADD CONSTRAINT "sync_actions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;
