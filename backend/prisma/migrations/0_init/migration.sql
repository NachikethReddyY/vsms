-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "QueueStatus" AS ENUM ('WAITING', 'IN_PROGRESS', 'COMPLETED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "ScanResult" AS ENUM ('SUCCESS', 'INVALID', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'UPCOMING', 'ONGOING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ShiftStatus" AS ENUM ('PLANNED', 'ACTIVE', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "StaffAssignmentRole" AS ENUM ('EVENT_MANAGER', 'REGISTRATION', 'SCREENER', 'REVIEWER', 'SUPPORT');

-- CreateEnum
CREATE TYPE "StaffAssignmentStatus" AS ENUM ('ASSIGNED', 'CONFIRMED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RegistrationStatus" AS ENUM ('REGISTERED', 'CHECKED_IN', 'CANCELLED');

-- CreateEnum
CREATE TYPE "Urgency" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "Outcome" AS ENUM ('PASSED', 'FAILED', 'PENDING', 'REFERRED');

-- CreateEnum
CREATE TYPE "DocType" AS ENUM ('PDF', 'IMAGE', 'REPORT', 'SUMMARY', 'REFERRAL_PDF', 'CLINICAL_SUMMARY_PDF');

-- CreateEnum
CREATE TYPE "Channel" AS ENUM ('EMAIL', 'SMS', 'IN_APP');

-- CreateEnum
CREATE TYPE "ReviewOutcome" AS ENUM ('COMPLETE', 'MONITOR', 'REFER', 'URGENT_ESCALATION');

-- CreateEnum
CREATE TYPE "ClinicalUrgency" AS ENUM ('ROUTINE', 'PRIORITY', 'URGENT', 'EMERGENCY');

-- CreateEnum
CREATE TYPE "ReferralStatus" AS ENUM ('DRAFT', 'ISSUED', 'SENT', 'ACKNOWLEDGED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "NotificationDeliveryStatus" AS ENUM ('QUEUED', 'SENDING', 'DELIVERED', 'FAILED', 'BOUNCED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SyncOperation" AS ENUM ('CREATE', 'UPDATE', 'DELETE');

-- CreateEnum
CREATE TYPE "SyncActionStatus" AS ENUM ('PENDING', 'PROCESSING', 'APPLIED', 'CONFLICT', 'FAILED');

-- CreateEnum
CREATE TYPE "EmergencyContactStatus" AS ENUM ('ACTIVE', 'REMOVED');

-- CreateEnum
CREATE TYPE "ConsentStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "AuthOutcome" AS ENUM ('SUCCESS', 'FAILED', 'DENIED');

-- CreateTable
CREATE TABLE "user" (
    "user_id" UUID NOT NULL,
    "full_name" VARCHAR(100) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "contact_number" VARCHAR(20),
    "emergency_contact" VARCHAR(20),
    "date_of_birth" DATE,
    "gender" VARCHAR(1),
    "employee_number" VARCHAR(20) NOT NULL,
    "department" VARCHAR(100),
    "designation" VARCHAR(100),
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "consent_confirmation" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "user_credential" (
    "credential_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_credential_pkey" PRIMARY KEY ("credential_id")
);

-- CreateTable
CREATE TABLE "role" (
    "role_id" UUID NOT NULL,
    "role_name" VARCHAR(50) NOT NULL,
    "description" VARCHAR(255),
    "precedence" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_pkey" PRIMARY KEY ("role_id")
);

-- CreateTable
CREATE TABLE "user_role" (
    "user_role_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "assigned_by" UUID,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_role_pkey" PRIMARY KEY ("user_role_id")
);

-- CreateTable
CREATE TABLE "participant" (
    "participant_id" UUID NOT NULL,
    "first_name" VARCHAR(100) NOT NULL,
    "last_name" VARCHAR(100) NOT NULL,
    "date_of_birth" DATE NOT NULL,
    "gender" VARCHAR(1) NOT NULL,
    "contact_number" VARCHAR(20) NOT NULL,
    "emergency_contact" VARCHAR(20) NOT NULL,
    "consent_given" BOOLEAN NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "participant_pkey" PRIMARY KEY ("participant_id")
);

-- CreateTable
CREATE TABLE "event" (
    "event_id" UUID NOT NULL,
    "event_name" VARCHAR(100) NOT NULL,
    "location" VARCHAR(255) NOT NULL,
    "event_date" DATE NOT NULL,
    "start_time" TIME NOT NULL,
    "end_time" TIME NOT NULL,
    "status" "EventStatus" NOT NULL,
    "cancellation_reason" TEXT,
    "cancelled_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "event_pkey" PRIMARY KEY ("event_id")
);

-- CreateTable
CREATE TABLE "shift" (
    "shift_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "required_staff" INTEGER NOT NULL DEFAULT 1,
    "status" "ShiftStatus" NOT NULL DEFAULT 'PLANNED',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "shift_pkey" PRIMARY KEY ("shift_id")
);

-- CreateTable
CREATE TABLE "event_registration" (
    "registration_id" UUID NOT NULL,
    "participant_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "queue_number" INTEGER NOT NULL,
    "registration_status" "RegistrationStatus" NOT NULL,
    "registered_by" UUID NOT NULL,
    "registered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "checked_in" BOOLEAN NOT NULL DEFAULT false,
    "checked_in_at" TIMESTAMP(3),

    CONSTRAINT "event_registration_pkey" PRIMARY KEY ("registration_id")
);

-- CreateTable
CREATE TABLE "qr_code_pass" (
    "qr_id" UUID NOT NULL,
    "registration_id" UUID NOT NULL,
    "token" VARCHAR(255) NOT NULL,
    "issue_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "revoked_at" TIMESTAMP(3),
    "revoked_by" UUID,
    "revoked_reason" VARCHAR(255),

    CONSTRAINT "qr_code_pass_pkey" PRIMARY KEY ("qr_id")
);

-- CreateTable
CREATE TABLE "station" (
    "station_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "station_name" VARCHAR(100) NOT NULL,
    "station_type" VARCHAR(100) NOT NULL,
    "station_order" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "time_created" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "station_pkey" PRIMARY KEY ("station_id")
);

-- CreateTable
CREATE TABLE "staff_assignment" (
    "assignment_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "station_id" UUID,
    "shift_id" UUID,
    "user_id" UUID NOT NULL,
    "assigned_by" UUID NOT NULL,
    "assignment_role" "StaffAssignmentRole",
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignment_status" "AssignmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "status" "StaffAssignmentStatus" DEFAULT 'ASSIGNED',
    "notes" TEXT,

    CONSTRAINT "staff_assignment_pkey" PRIMARY KEY ("assignment_id")
);

-- CreateTable
CREATE TABLE "queue_entry" (
    "queue_id" UUID NOT NULL,
    "registration_id" UUID NOT NULL,
    "station_id" UUID NOT NULL,
    "queue_number" INTEGER NOT NULL,
    "status" "QueueStatus" NOT NULL,
    "entered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "called_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "left_queue_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "queue_entry_pkey" PRIMARY KEY ("queue_id")
);

-- CreateTable
CREATE TABLE "queue_movement" (
    "movement_id" UUID NOT NULL,
    "registration_id" UUID NOT NULL,
    "from_station_id" UUID NOT NULL,
    "to_station_id" UUID NOT NULL,
    "moved_by" UUID NOT NULL,
    "movement_reason" VARCHAR(100) NOT NULL,
    "movement_time" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "queue_movement_pkey" PRIMARY KEY ("movement_id")
);

-- CreateTable
CREATE TABLE "scan_log" (
    "scan_id" UUID NOT NULL,
    "qr_id" UUID,
    "user_id" UUID,
    "station_id" UUID NOT NULL,
    "scan_result" "ScanResult" NOT NULL,
    "device_name" VARCHAR(100) NOT NULL,
    "ip_address" VARCHAR(45) NOT NULL,
    "scanned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "registration_id" UUID,

    CONSTRAINT "scan_log_pkey" PRIMARY KEY ("scan_id")
);

-- CreateTable
CREATE TABLE "screening_result" (
    "result_id" UUID NOT NULL,
    "registration_id" UUID NOT NULL,
    "station_id" UUID NOT NULL,
    "queue_entry_id" UUID,
    "recorded_by" UUID NOT NULL,
    "screening_type" VARCHAR(50) NOT NULL,
    "result_data" JSONB NOT NULL,
    "overall_flag" VARCHAR(50),
    "is_flagged" BOOLEAN NOT NULL DEFAULT false,
    "flag_summary" TEXT,
    "rule_version" VARCHAR(20) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "screening_result_pkey" PRIMARY KEY ("result_id")
);

-- CreateTable
CREATE TABLE "review" (
    "review_id" UUID NOT NULL,
    "registration_id" UUID,
    "reviewer_id" UUID NOT NULL,
    "outcome" "Outcome",
    "reviewOutcome" "ReviewOutcome",
    "urgency" "Urgency",
    "clinicalUrgency" "ClinicalUrgency" DEFAULT 'ROUTINE',
    "clinical_summary" TEXT NOT NULL,
    "recommendations" TEXT,
    "review_datetime" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "previous_review_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "review_pkey" PRIMARY KEY ("review_id")
);

-- CreateTable
CREATE TABLE "referral" (
    "referral_id" UUID NOT NULL,
    "review_id" UUID NOT NULL,
    "registration_id" UUID,
    "created_by" UUID NOT NULL,
    "destination" VARCHAR(255) NOT NULL,
    "destination_email" VARCHAR(255),
    "reason" TEXT NOT NULL,
    "instructions" TEXT,
    "urgency" "Urgency",
    "clinicalUrgency" "ClinicalUrgency",
    "status" "ReferralStatus" NOT NULL DEFAULT 'DRAFT',
    "referral_datetime" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "referral_pkey" PRIMARY KEY ("referral_id")
);

-- CreateTable
CREATE TABLE "document_artifact" (
    "document_id" UUID NOT NULL,
    "review_id" UUID,
    "referral_id" UUID,
    "document_type" "DocType" NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "storage_key" VARCHAR(500) NOT NULL,
    "file_hash" CHAR(64) NOT NULL,
    "file_name" VARCHAR(100),
    "file_size" BIGINT NOT NULL,
    "generated_by" UUID NOT NULL,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3),

    CONSTRAINT "document_artifact_pkey" PRIMARY KEY ("document_id")
);

-- CreateTable
CREATE TABLE "notification_delivery" (
    "notification_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "referral_id" UUID,
    "document_id" UUID,
    "channel" "Channel" NOT NULL DEFAULT 'EMAIL',
    "recipient" BYTEA,
    "recipient_address_encrypted" BYTEA,
    "template_id" UUID,
    "template_key" VARCHAR(100),
    "status" "NotificationDeliveryStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_delivery_pkey" PRIMARY KEY ("notification_id")
);

-- CreateTable
CREATE TABLE "sync_action" (
    "sync_action_id" UUID NOT NULL,
    "device_id" VARCHAR(255) NOT NULL,
    "user_id" UUID NOT NULL,
    "registration_id" UUID,
    "entity_type" VARCHAR(100) NOT NULL,
    "entity_id" UUID NOT NULL,
    "operation" "SyncOperation",
    "base_version" INTEGER,
    "payload" JSONB NOT NULL,
    "status" "SyncActionStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),

    CONSTRAINT "sync_action_pkey" PRIMARY KEY ("sync_action_id")
);

-- CreateTable
CREATE TABLE "login_history" (
    "login_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "login_time" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "logout_time" TIMESTAMP(3),
    "login_status" TEXT NOT NULL,
    "ip_address" VARCHAR(45) NOT NULL,
    "device_name" VARCHAR(100) NOT NULL,

    CONSTRAINT "login_history_pkey" PRIMARY KEY ("login_id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "audit_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "action" VARCHAR(100) NOT NULL,
    "entity_name" VARCHAR(50) NOT NULL,
    "entity_id" UUID NOT NULL,
    "old_value" JSONB,
    "new_value" JSONB,
    "ip_address" VARCHAR(45) NOT NULL,
    "device_name" VARCHAR(100) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("audit_id")
);

-- CreateTable
CREATE TABLE "security_incident" (
    "incident_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "incident_type" VARCHAR(100) NOT NULL,
    "severity" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "resolved_by" UUID,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "security_incident_pkey" PRIMARY KEY ("incident_id")
);

-- CreateTable
CREATE TABLE "auth_audit_log" (
    "auth_log_id" UUID NOT NULL,
    "user_id" UUID,
    "device_id" UUID,
    "event_type" VARCHAR(50) NOT NULL,
    "outcome" "AuthOutcome" NOT NULL,
    "failure_category" VARCHAR(50),
    "identifier_hash" CHAR(64),
    "ip_address" VARCHAR(45),
    "user_agent" VARCHAR(500),
    "request_id" UUID,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_audit_log_pkey" PRIMARY KEY ("auth_log_id")
);

-- CreateTable
CREATE TABLE "participant_emergency_contact" (
    "emergency_contact_id" UUID NOT NULL,
    "participant_id" UUID NOT NULL,
    "contact_name" VARCHAR(120) NOT NULL,
    "relationship" VARCHAR(60) NOT NULL,
    "phone_number" VARCHAR(30) NOT NULL,
    "email" VARCHAR(255),
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "status" "EmergencyContactStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "participant_emergency_contact_pkey" PRIMARY KEY ("emergency_contact_id")
);

-- CreateTable
CREATE TABLE "consent_form_version" (
    "consent_form_version_id" UUID NOT NULL,
    "form_code" VARCHAR(50) NOT NULL,
    "version_number" VARCHAR(30) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "content_hash" CHAR(64) NOT NULL,
    "document_object_key" VARCHAR(500) NOT NULL,
    "effective_from" TIMESTAMPTZ(3) NOT NULL,
    "effective_to" TIMESTAMPTZ(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consent_form_version_pkey" PRIMARY KEY ("consent_form_version_id")
);

-- CreateTable
CREATE TABLE "participant_consent" (
    "consent_id" UUID NOT NULL,
    "participant_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "registration_id" UUID,
    "consent_form_version_id" UUID NOT NULL,
    "consent_status" "ConsentStatus" NOT NULL DEFAULT 'PENDING',
    "signer_name" VARCHAR(150),
    "signer_relationship" VARCHAR(60),
    "signature_object_key" VARCHAR(500),
    "signature_sha256" CHAR(64),
    "signature_mime_type" VARCHAR(100),
    "device_id" UUID,
    "recorded_by" UUID NOT NULL,
    "signed_at" TIMESTAMPTZ(3),
    "withdrawn_at" TIMESTAMPTZ(3),
    "withdrawal_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "participant_consent_pkey" PRIMARY KEY ("consent_id")
);

-- CreateTable
CREATE TABLE "registration_status_history" (
    "history_id" UUID NOT NULL,
    "registration_id" UUID NOT NULL,
    "from_status" "RegistrationStatus",
    "to_status" "RegistrationStatus" NOT NULL,
    "changed_by" UUID NOT NULL,
    "reason" VARCHAR(200),
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "registration_status_history_pkey" PRIMARY KEY ("history_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "user_employee_number_key" ON "user"("employee_number");

-- CreateIndex
CREATE INDEX "user_status_idx" ON "user"("status");

-- CreateIndex
CREATE UNIQUE INDEX "user_credential_user_id_key" ON "user_credential"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "role_role_name_key" ON "role"("role_name");

-- CreateIndex
CREATE INDEX "user_role_role_id_idx" ON "user_role"("role_id");

-- CreateIndex
CREATE INDEX "user_role_assigned_by_idx" ON "user_role"("assigned_by");

-- CreateIndex
CREATE UNIQUE INDEX "user_role_user_id_role_id_key" ON "user_role"("user_id", "role_id");

-- CreateIndex
CREATE INDEX "shift_event_id_starts_at_idx" ON "shift"("event_id", "starts_at");

-- CreateIndex
CREATE UNIQUE INDEX "shift_event_id_name_starts_at_key" ON "shift"("event_id", "name", "starts_at");

-- CreateIndex
CREATE INDEX "qr_code_pass_token_idx" ON "qr_code_pass"("token");

-- CreateIndex
CREATE INDEX "qr_code_pass_is_active_idx" ON "qr_code_pass"("is_active");

-- CreateIndex
CREATE INDEX "staff_assignment_event_id_idx" ON "staff_assignment"("event_id");

-- CreateIndex
CREATE INDEX "staff_assignment_station_id_idx" ON "staff_assignment"("station_id");

-- CreateIndex
CREATE INDEX "staff_assignment_user_id_idx" ON "staff_assignment"("user_id");

-- CreateIndex
CREATE INDEX "auth_audit_log_user_id_occurred_at_idx" ON "auth_audit_log"("user_id", "occurred_at");

-- CreateIndex
CREATE INDEX "auth_audit_log_event_type_occurred_at_idx" ON "auth_audit_log"("event_type", "occurred_at");

-- CreateIndex
CREATE INDEX "auth_audit_log_request_id_idx" ON "auth_audit_log"("request_id");

-- CreateIndex
CREATE INDEX "auth_audit_log_device_id_occurred_at_idx" ON "auth_audit_log"("device_id", "occurred_at");

-- CreateIndex
CREATE INDEX "participant_emergency_contact_participant_id_idx" ON "participant_emergency_contact"("participant_id");

-- CreateIndex
CREATE INDEX "participant_emergency_contact_created_by_idx" ON "participant_emergency_contact"("created_by");

-- CreateIndex
CREATE INDEX "participant_emergency_contact_updated_by_idx" ON "participant_emergency_contact"("updated_by");

-- CreateIndex
CREATE INDEX "participant_emergency_contact_participant_id_is_primary_sta_idx" ON "participant_emergency_contact"("participant_id", "is_primary", "status");

-- CreateIndex
CREATE INDEX "consent_form_version_is_active_effective_from_idx" ON "consent_form_version"("is_active", "effective_from");

-- CreateIndex
CREATE INDEX "consent_form_version_created_by_idx" ON "consent_form_version"("created_by");

-- CreateIndex
CREATE UNIQUE INDEX "consent_form_version_form_code_version_number_key" ON "consent_form_version"("form_code", "version_number");

-- CreateIndex
CREATE INDEX "participant_consent_participant_id_idx" ON "participant_consent"("participant_id");

-- CreateIndex
CREATE INDEX "participant_consent_event_id_idx" ON "participant_consent"("event_id");

-- CreateIndex
CREATE INDEX "participant_consent_registration_id_idx" ON "participant_consent"("registration_id");

-- CreateIndex
CREATE INDEX "participant_consent_consent_form_version_id_idx" ON "participant_consent"("consent_form_version_id");

-- CreateIndex
CREATE INDEX "participant_consent_recorded_by_idx" ON "participant_consent"("recorded_by");

-- CreateIndex
CREATE INDEX "participant_consent_device_id_idx" ON "participant_consent"("device_id");

-- CreateIndex
CREATE INDEX "registration_status_history_registration_id_occurred_at_idx" ON "registration_status_history"("registration_id", "occurred_at");

-- CreateIndex
CREATE INDEX "registration_status_history_changed_by_idx" ON "registration_status_history"("changed_by");

-- AddForeignKey
ALTER TABLE "user_credential" ADD CONSTRAINT "user_credential_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_role" ADD CONSTRAINT "user_role_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_role" ADD CONSTRAINT "user_role_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "role"("role_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_role" ADD CONSTRAINT "user_role_assigned_by_fkey" FOREIGN KEY ("assigned_by") REFERENCES "user"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift" ADD CONSTRAINT "shift_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "event"("event_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_registration" ADD CONSTRAINT "event_registration_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "participant"("participant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_registration" ADD CONSTRAINT "event_registration_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "event"("event_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_registration" ADD CONSTRAINT "event_registration_registered_by_fkey" FOREIGN KEY ("registered_by") REFERENCES "user"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qr_code_pass" ADD CONSTRAINT "qr_code_pass_registration_id_fkey" FOREIGN KEY ("registration_id") REFERENCES "event_registration"("registration_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qr_code_pass" ADD CONSTRAINT "qr_code_pass_revoked_by_fkey" FOREIGN KEY ("revoked_by") REFERENCES "user"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "station" ADD CONSTRAINT "station_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "event"("event_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_assignment" ADD CONSTRAINT "staff_assignment_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "event"("event_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_assignment" ADD CONSTRAINT "staff_assignment_station_id_fkey" FOREIGN KEY ("station_id") REFERENCES "station"("station_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_assignment" ADD CONSTRAINT "staff_assignment_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "shift"("shift_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_assignment" ADD CONSTRAINT "staff_assignment_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_assignment" ADD CONSTRAINT "staff_assignment_assigned_by_fkey" FOREIGN KEY ("assigned_by") REFERENCES "user"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_entry" ADD CONSTRAINT "queue_entry_registration_id_fkey" FOREIGN KEY ("registration_id") REFERENCES "event_registration"("registration_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_entry" ADD CONSTRAINT "queue_entry_station_id_fkey" FOREIGN KEY ("station_id") REFERENCES "station"("station_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_movement" ADD CONSTRAINT "queue_movement_registration_id_fkey" FOREIGN KEY ("registration_id") REFERENCES "event_registration"("registration_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_movement" ADD CONSTRAINT "queue_movement_from_station_id_fkey" FOREIGN KEY ("from_station_id") REFERENCES "station"("station_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_movement" ADD CONSTRAINT "queue_movement_to_station_id_fkey" FOREIGN KEY ("to_station_id") REFERENCES "station"("station_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_movement" ADD CONSTRAINT "queue_movement_moved_by_fkey" FOREIGN KEY ("moved_by") REFERENCES "user"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scan_log" ADD CONSTRAINT "scan_log_qr_id_fkey" FOREIGN KEY ("qr_id") REFERENCES "qr_code_pass"("qr_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scan_log" ADD CONSTRAINT "scan_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scan_log" ADD CONSTRAINT "scan_log_station_id_fkey" FOREIGN KEY ("station_id") REFERENCES "station"("station_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scan_log" ADD CONSTRAINT "scan_log_registration_id_fkey" FOREIGN KEY ("registration_id") REFERENCES "event_registration"("registration_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "screening_result" ADD CONSTRAINT "screening_result_registration_id_fkey" FOREIGN KEY ("registration_id") REFERENCES "event_registration"("registration_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "screening_result" ADD CONSTRAINT "screening_result_station_id_fkey" FOREIGN KEY ("station_id") REFERENCES "station"("station_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "screening_result" ADD CONSTRAINT "screening_result_queue_entry_id_fkey" FOREIGN KEY ("queue_entry_id") REFERENCES "queue_entry"("queue_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "screening_result" ADD CONSTRAINT "screening_result_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "user"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review" ADD CONSTRAINT "review_registration_id_fkey" FOREIGN KEY ("registration_id") REFERENCES "event_registration"("registration_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review" ADD CONSTRAINT "review_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "user"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review" ADD CONSTRAINT "review_previous_review_id_fkey" FOREIGN KEY ("previous_review_id") REFERENCES "review"("review_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral" ADD CONSTRAINT "referral_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "review"("review_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral" ADD CONSTRAINT "referral_registration_id_fkey" FOREIGN KEY ("registration_id") REFERENCES "event_registration"("registration_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral" ADD CONSTRAINT "referral_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "user"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_artifact" ADD CONSTRAINT "document_artifact_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "review"("review_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_artifact" ADD CONSTRAINT "document_artifact_referral_id_fkey" FOREIGN KEY ("referral_id") REFERENCES "referral"("referral_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_artifact" ADD CONSTRAINT "document_artifact_generated_by_fkey" FOREIGN KEY ("generated_by") REFERENCES "user"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_delivery" ADD CONSTRAINT "notification_delivery_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_delivery" ADD CONSTRAINT "notification_delivery_referral_id_fkey" FOREIGN KEY ("referral_id") REFERENCES "referral"("referral_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_delivery" ADD CONSTRAINT "notification_delivery_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "document_artifact"("document_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_action" ADD CONSTRAINT "sync_action_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "login_history" ADD CONSTRAINT "login_history_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_incident" ADD CONSTRAINT "security_incident_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_incident" ADD CONSTRAINT "security_incident_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "user"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_audit_log" ADD CONSTRAINT "auth_audit_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "participant_emergency_contact" ADD CONSTRAINT "participant_emergency_contact_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "participant"("participant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "participant_emergency_contact" ADD CONSTRAINT "participant_emergency_contact_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "user"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "participant_emergency_contact" ADD CONSTRAINT "participant_emergency_contact_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "user"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_form_version" ADD CONSTRAINT "consent_form_version_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "user"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "participant_consent" ADD CONSTRAINT "participant_consent_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "participant"("participant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "participant_consent" ADD CONSTRAINT "participant_consent_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "event"("event_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "participant_consent" ADD CONSTRAINT "participant_consent_registration_id_fkey" FOREIGN KEY ("registration_id") REFERENCES "event_registration"("registration_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "participant_consent" ADD CONSTRAINT "participant_consent_consent_form_version_id_fkey" FOREIGN KEY ("consent_form_version_id") REFERENCES "consent_form_version"("consent_form_version_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "participant_consent" ADD CONSTRAINT "participant_consent_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "user"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registration_status_history" ADD CONSTRAINT "registration_status_history_registration_id_fkey" FOREIGN KEY ("registration_id") REFERENCES "event_registration"("registration_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registration_status_history" ADD CONSTRAINT "registration_status_history_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "user"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

