-- CreateEnum
CREATE TYPE "ParticipantStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'DECEASED');

-- CreateEnum
CREATE TYPE "EmergencyContactStatus" AS ENUM ('ACTIVE', 'REMOVED');

-- CreateEnum
CREATE TYPE "ConsentStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "AuthOutcome" AS ENUM ('SUCCESS', 'FAILED', 'DENIED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "UserStatus" ADD VALUE 'INACTIVE';
ALTER TYPE "UserStatus" ADD VALUE 'SUSPENDED';

-- The application now authenticates through Cognito. The legacy credential and
-- refresh-session tables are intentionally retained so this forward migration
-- does not destroy authentication history or make rollback impossible.

-- DropIndex
DROP INDEX "user_roles_user_id_role_idx";

-- DropIndex
DROP INDEX "user_roles_user_id_role_key";

-- DropIndex
DROP INDEX "event_registrations_event_id_participant_id_key";

-- DropIndex
DROP INDEX "qr_code_passes_registration_id_key";

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "cognito_sub" UUID,
ALTER COLUMN "username" DROP NOT NULL;

-- Preserve the existing row identifier while normalizing role assignments.
ALTER TABLE "user_roles" RENAME COLUMN "role_id" TO "user_role_id";
ALTER TABLE "user_roles"
ADD COLUMN "assigned_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "assigned_by" UUID,
ADD COLUMN "role_id" UUID;

-- AlterTable
ALTER TABLE "participants" ADD COLUMN     "accessibility_notes" VARCHAR(1000),
ADD COLUMN     "created_by" UUID,
ADD COLUMN     "email" VARCHAR(255),
ADD COLUMN     "participant_reference" VARCHAR(30),
ADD COLUMN     "preferred_language" VARCHAR(50),
ADD COLUMN     "status" "ParticipantStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "updated_by" UUID,
ALTER COLUMN "nric" DROP NOT NULL,
ALTER COLUMN "nric_masked" DROP NOT NULL;

-- AlterTable
ALTER TABLE "event_registrations" ADD COLUMN     "checked_in_at" TIMESTAMPTZ(3),
ADD COLUMN     "idempotency_key" VARCHAR(100);

-- AlterTable
ALTER TABLE "qr_code_passes" ADD COLUMN     "is_active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "issued_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "revoked_reason" VARCHAR(255),
ADD COLUMN     "token" VARCHAR(200),
ALTER COLUMN "token_hash" DROP NOT NULL;

-- AlterTable
ALTER TABLE "audit_logs" ADD COLUMN     "device_id" UUID,
ADD COLUMN     "device_name" VARCHAR(100),
ADD COLUMN     "entity_id" UUID,
ADD COLUMN     "entity_name" VARCHAR(50),
ADD COLUMN     "new_value" JSONB,
ADD COLUMN     "old_value" JSONB,
ADD COLUMN     "outcome" "AuthOutcome" NOT NULL DEFAULT 'SUCCESS',
ADD COLUMN     "request_id" UUID,
ALTER COLUMN "resource" DROP NOT NULL;

-- CreateTable
CREATE TABLE "roles" (
    "role_id" UUID NOT NULL,
    "role_name" VARCHAR(50) NOT NULL,
    "description" VARCHAR(255),
    "precedence" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("role_id")
);

-- Seed normalized roles and map every legacy assignment before removing the
-- enum column. The UUIDs are deterministic and auditable.
INSERT INTO "roles" ("role_id", "role_name", "description", "precedence")
VALUES
    (md5('VSMS_ROLE_ADMINISTRATOR')::uuid, 'ADMINISTRATOR', 'Full administrative access', 100),
    (md5('VSMS_ROLE_EVENT_MANAGER')::uuid, 'EVENT_MANAGER', 'Create and manage events', 80),
    (md5('VSMS_ROLE_REGISTRATION_OFFICER')::uuid, 'REGISTRATION_OFFICER', 'Register participants and manage consent', 60),
    (md5('VSMS_ROLE_SCREENING_STAFF')::uuid, 'SCREENING_STAFF', 'Operate screening stations', 50),
    (md5('VSMS_ROLE_REVIEWER')::uuid, 'REVIEWER', 'Review screening results', 40),
    (md5('VSMS_ROLE_AUDITOR')::uuid, 'AUDITOR', 'Read audit records', 20);

UPDATE "user_roles"
SET "role_id" = CASE "role"::text
    WHEN 'ADMIN' THEN md5('VSMS_ROLE_ADMINISTRATOR')::uuid
    WHEN 'EVENT_MANAGER' THEN md5('VSMS_ROLE_EVENT_MANAGER')::uuid
    ELSE md5('VSMS_ROLE_REGISTRATION_OFFICER')::uuid
END;

ALTER TABLE "user_roles"
ALTER COLUMN "role_id" SET NOT NULL,
DROP COLUMN "role";

-- Existing rows receive stable, collision-resistant references and ownership.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM "participants")
       AND NOT EXISTS (SELECT 1 FROM "users") THEN
        RAISE EXCEPTION 'Cannot assign participant ownership because no users exist';
    END IF;
END $$;

UPDATE "participants" AS participant
SET
    "participant_reference" = 'VSMS-' || upper(substr(replace(participant."participant_id"::text, '-', ''), 1, 20)),
    "created_by" = COALESCE(
        (
            SELECT registration."registered_by"
            FROM "event_registrations" AS registration
            WHERE registration."participant_id" = participant."participant_id"
            ORDER BY registration."created_at" ASC
            LIMIT 1
        ),
        (SELECT "user_id" FROM "users" ORDER BY "created_at" ASC LIMIT 1)
    ),
    "updated_by" = COALESCE(
        (
            SELECT registration."registered_by"
            FROM "event_registrations" AS registration
            WHERE registration."participant_id" = participant."participant_id"
            ORDER BY registration."created_at" DESC
            LIMIT 1
        ),
        (SELECT "user_id" FROM "users" ORDER BY "created_at" ASC LIMIT 1)
    );

ALTER TABLE "participants"
ALTER COLUMN "participant_reference" SET NOT NULL,
ALTER COLUMN "created_by" SET NOT NULL,
ALTER COLUMN "updated_by" SET NOT NULL;

UPDATE "event_registrations"
SET "idempotency_key" = 'legacy-' || "registration_id"::text;

ALTER TABLE "event_registrations"
ALTER COLUMN "idempotency_key" SET NOT NULL;

-- Raw tokens cannot be recovered from the former hashes. This placeholder is
-- unique; the application still accepts old QR payloads through token_hash.
UPDATE "qr_code_passes"
SET "token" = 'legacy-' || "qr_id"::text;

ALTER TABLE "qr_code_passes"
ALTER COLUMN "token" SET NOT NULL;

-- CreateTable
CREATE TABLE "permissions" (
    "permission_id" UUID NOT NULL,
    "permission_name" VARCHAR(100) NOT NULL,
    "description" VARCHAR(255),
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("permission_id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "role_permission_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,
    "granted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_permission_id")
);

-- CreateTable
CREATE TABLE "auth_audit_logs" (
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

    CONSTRAINT "auth_audit_logs_pkey" PRIMARY KEY ("auth_log_id")
);

-- CreateTable
CREATE TABLE "devices" (
    "device_id" UUID NOT NULL,
    "user_id" UUID,
    "device_name" VARCHAR(100) NOT NULL,
    "fingerprint_hash" CHAR(64),
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "last_seen_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("device_id")
);

-- CreateTable
CREATE TABLE "participant_emergency_contacts" (
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

    CONSTRAINT "participant_emergency_contacts_pkey" PRIMARY KEY ("emergency_contact_id")
);

-- CreateTable
CREATE TABLE "consent_form_versions" (
    "consent_form_version_id" UUID NOT NULL,
    "form_code" VARCHAR(50) NOT NULL,
    "version_number" VARCHAR(30) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "content_text" TEXT,
    "content_hash" CHAR(64) NOT NULL,
    "document_object_key" VARCHAR(500) NOT NULL,
    "effective_from" TIMESTAMPTZ(3) NOT NULL,
    "effective_to" TIMESTAMPTZ(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consent_form_versions_pkey" PRIMARY KEY ("consent_form_version_id")
);

-- CreateTable
CREATE TABLE "participant_consents" (
    "consent_id" UUID NOT NULL,
    "participant_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "registration_id" UUID,
    "withdrawal_of_id" UUID,
    "consent_form_version_id" UUID NOT NULL,
    "consent_status" "ConsentStatus" NOT NULL DEFAULT 'PENDING',
    "signer_type" VARCHAR(40),
    "signer_name" VARCHAR(150),
    "signer_relationship" VARCHAR(60),
    "guardian_contact_name" VARCHAR(150),
    "guardian_contact_phone" VARCHAR(30),
    "guardian_contact_email" VARCHAR(255),
    "signature_object_key" VARCHAR(500),
    "signature_sha256" CHAR(64),
    "signature_mime_type" VARCHAR(100),
    "device_id" UUID,
    "recorded_by" UUID NOT NULL,
    "signed_at" TIMESTAMPTZ(3),
    "withdrawn_at" TIMESTAMPTZ(3),
    "decision_at" TIMESTAMPTZ(3),
    "withdrawal_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "participant_consents_pkey" PRIMARY KEY ("consent_id")
);

-- CreateTable
CREATE TABLE "registration_status_history" (
    "history_id" UUID NOT NULL,
    "registration_id" UUID NOT NULL,
    "from_status" "EventRegistrationStatus",
    "to_status" "EventRegistrationStatus" NOT NULL,
    "changed_by" UUID NOT NULL,
    "reason" VARCHAR(200),
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "registration_status_history_pkey" PRIMARY KEY ("history_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "roles_role_name_key" ON "roles"("role_name");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_permission_name_key" ON "permissions"("permission_name");

-- CreateIndex
CREATE INDEX "permissions_created_by_idx" ON "permissions"("created_by");

-- CreateIndex
CREATE INDEX "role_permissions_permission_id_idx" ON "role_permissions"("permission_id");

-- CreateIndex
CREATE UNIQUE INDEX "role_permissions_role_id_permission_id_key" ON "role_permissions"("role_id", "permission_id");

-- CreateIndex
CREATE INDEX "auth_audit_logs_user_id_occurred_at_idx" ON "auth_audit_logs"("user_id", "occurred_at");

-- CreateIndex
CREATE INDEX "auth_audit_logs_event_type_occurred_at_idx" ON "auth_audit_logs"("event_type", "occurred_at");

-- CreateIndex
CREATE INDEX "auth_audit_logs_request_id_idx" ON "auth_audit_logs"("request_id");

-- CreateIndex
CREATE INDEX "auth_audit_logs_device_id_occurred_at_idx" ON "auth_audit_logs"("device_id", "occurred_at");

-- CreateIndex
CREATE INDEX "devices_user_id_status_idx" ON "devices"("user_id", "status");

-- CreateIndex
CREATE INDEX "participant_emergency_contacts_participant_id_idx" ON "participant_emergency_contacts"("participant_id");

-- CreateIndex
CREATE INDEX "participant_emergency_contacts_created_by_idx" ON "participant_emergency_contacts"("created_by");

-- CreateIndex
CREATE INDEX "participant_emergency_contacts_updated_by_idx" ON "participant_emergency_contacts"("updated_by");

-- CreateIndex
CREATE INDEX "participant_emergency_contacts_participant_id_is_primary_st_idx" ON "participant_emergency_contacts"("participant_id", "is_primary", "status");

-- CreateIndex
CREATE INDEX "consent_form_versions_is_active_effective_from_idx" ON "consent_form_versions"("is_active", "effective_from");

-- CreateIndex
CREATE INDEX "consent_form_versions_created_by_idx" ON "consent_form_versions"("created_by");

-- CreateIndex
CREATE UNIQUE INDEX "consent_form_versions_form_code_version_number_key" ON "consent_form_versions"("form_code", "version_number");

-- CreateIndex
CREATE INDEX "participant_consents_participant_id_idx" ON "participant_consents"("participant_id");

-- CreateIndex
CREATE INDEX "participant_consents_event_id_idx" ON "participant_consents"("event_id");

-- CreateIndex
CREATE INDEX "participant_consents_registration_id_idx" ON "participant_consents"("registration_id");

-- CreateIndex
CREATE INDEX "participant_consents_withdrawal_of_id_idx" ON "participant_consents"("withdrawal_of_id");

-- CreateIndex
CREATE INDEX "participant_consents_consent_form_version_id_idx" ON "participant_consents"("consent_form_version_id");

-- CreateIndex
CREATE INDEX "participant_consents_recorded_by_idx" ON "participant_consents"("recorded_by");

-- CreateIndex
CREATE INDEX "participant_consents_device_id_idx" ON "participant_consents"("device_id");

-- CreateIndex
CREATE INDEX "registration_status_history_registration_id_occurred_at_idx" ON "registration_status_history"("registration_id", "occurred_at");

-- CreateIndex
CREATE INDEX "registration_status_history_changed_by_idx" ON "registration_status_history"("changed_by");

-- CreateIndex
CREATE UNIQUE INDEX "users_cognito_sub_key" ON "users"("cognito_sub");

-- CreateIndex
CREATE INDEX "user_roles_role_id_idx" ON "user_roles"("role_id");

-- CreateIndex
CREATE INDEX "user_roles_assigned_by_idx" ON "user_roles"("assigned_by");

-- CreateIndex
CREATE UNIQUE INDEX "user_roles_user_id_role_id_key" ON "user_roles"("user_id", "role_id");

-- CreateIndex
CREATE UNIQUE INDEX "participants_participant_reference_key" ON "participants"("participant_reference");

-- CreateIndex
CREATE INDEX "participants_date_of_birth_idx" ON "participants"("date_of_birth");

-- CreateIndex
CREATE INDEX "participants_status_idx" ON "participants"("status");

-- CreateIndex
CREATE INDEX "participants_created_by_idx" ON "participants"("created_by");

-- CreateIndex
CREATE INDEX "participants_updated_by_idx" ON "participants"("updated_by");

-- CreateIndex
CREATE UNIQUE INDEX "event_registrations_participant_id_event_id_key" ON "event_registrations"("participant_id", "event_id");

-- CreateIndex
CREATE UNIQUE INDEX "event_registrations_event_id_queue_number_key" ON "event_registrations"("event_id", "queue_number");

-- CreateIndex
CREATE UNIQUE INDEX "event_registrations_registered_by_idempotency_key_key" ON "event_registrations"("registered_by", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "qr_code_passes_token_key" ON "qr_code_passes"("token");

-- CreateIndex
CREATE INDEX "qr_code_passes_registration_id_is_active_idx" ON "qr_code_passes"("registration_id", "is_active");

-- CreateIndex
CREATE INDEX "audit_logs_request_id_idx" ON "audit_logs"("request_id");

-- CreateIndex
CREATE INDEX "audit_logs_device_id_created_at_idx" ON "audit_logs"("device_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_entity_name_entity_id_idx" ON "audit_logs"("entity_name", "entity_id");

-- Enforce business invariants that Prisma cannot express as partial indexes.
CREATE UNIQUE INDEX "participant_emergency_contacts_one_active_primary_key"
ON "participant_emergency_contacts" ("participant_id")
WHERE "is_primary" = true AND "status" = 'ACTIVE';

CREATE UNIQUE INDEX "participant_consents_one_accepted_per_event_key"
ON "participant_consents" ("participant_id", "event_id")
WHERE "consent_status" = 'ACCEPTED';

-- AddForeignKey
ALTER TABLE "permissions" ADD CONSTRAINT "permissions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("role_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("permission_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("role_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_assigned_by_fkey" FOREIGN KEY ("assigned_by") REFERENCES "users"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "participants" ADD CONSTRAINT "participants_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "participants" ADD CONSTRAINT "participants_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("device_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_audit_logs" ADD CONSTRAINT "auth_audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_audit_logs" ADD CONSTRAINT "auth_audit_logs_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("device_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "participant_emergency_contacts" ADD CONSTRAINT "participant_emergency_contacts_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "participants"("participant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "participant_emergency_contacts" ADD CONSTRAINT "participant_emergency_contacts_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "participant_emergency_contacts" ADD CONSTRAINT "participant_emergency_contacts_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_form_versions" ADD CONSTRAINT "consent_form_versions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "participant_consents" ADD CONSTRAINT "participant_consents_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "participants"("participant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "participant_consents" ADD CONSTRAINT "participant_consents_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("event_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "participant_consents" ADD CONSTRAINT "participant_consents_registration_id_fkey" FOREIGN KEY ("registration_id") REFERENCES "event_registrations"("registration_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "participant_consents" ADD CONSTRAINT "participant_consents_withdrawal_of_id_fkey" FOREIGN KEY ("withdrawal_of_id") REFERENCES "participant_consents"("consent_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "participant_consents" ADD CONSTRAINT "participant_consents_consent_form_version_id_fkey" FOREIGN KEY ("consent_form_version_id") REFERENCES "consent_form_versions"("consent_form_version_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "participant_consents" ADD CONSTRAINT "participant_consents_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "participant_consents" ADD CONSTRAINT "participant_consents_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("device_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registration_status_history" ADD CONSTRAINT "registration_status_history_registration_id_fkey" FOREIGN KEY ("registration_id") REFERENCES "event_registrations"("registration_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registration_status_history" ADD CONSTRAINT "registration_status_history_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;
