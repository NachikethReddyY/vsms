-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ShiftStatus" AS ENUM ('PLANNED', 'ACTIVE', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "StaffAssignmentRole" AS ENUM ('EVENT_MANAGER', 'REGISTRATION', 'SCREENER', 'REVIEWER', 'SUPPORT');

-- CreateEnum
CREATE TYPE "StaffAssignmentStatus" AS ENUM ('ASSIGNED', 'CONFIRMED', 'COMPLETED', 'CANCELLED');

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

-- CreateTable
CREATE TABLE "events" (
    "event_id" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "description" TEXT,
    "venue" VARCHAR(255) NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "capacity" INTEGER NOT NULL,
    "status" "EventStatus" NOT NULL DEFAULT 'DRAFT',
    "created_by_user_id" UUID NOT NULL,
    "cancelled_by_user_id" UUID,
    "cancelled_at" TIMESTAMPTZ(3),
    "cancellation_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "events_pkey" PRIMARY KEY ("event_id")
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
CREATE TABLE "staff_assignments" (
    "staff_assignment_id" UUID NOT NULL,
    "shift_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "event_station_id" UUID,
    "assignment_role" "StaffAssignmentRole" NOT NULL,
    "status" "StaffAssignmentStatus" NOT NULL DEFAULT 'ASSIGNED',
    "assigned_by_user_id" UUID NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "staff_assignments_pkey" PRIMARY KEY ("staff_assignment_id")
);

-- CreateTable
CREATE TABLE "reviews" (
    "review_id" UUID NOT NULL,
    "registration_id" UUID NOT NULL,
    "reviewed_by_user_id" UUID NOT NULL,
    "outcome" "ReviewOutcome" NOT NULL,
    "urgency" "ClinicalUrgency" NOT NULL DEFAULT 'ROUTINE',
    "clinical_summary" TEXT NOT NULL,
    "recommendations" TEXT,
    "reviewed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,
    "supersedes_review_id" UUID,
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
    "expires_at" TIMESTAMPTZ(3),

    CONSTRAINT "document_artifacts_pkey" PRIMARY KEY ("document_id")
);

-- CreateTable
CREATE TABLE "notification_deliveries" (
    "notification_delivery_id" UUID NOT NULL,
    "referral_id" UUID,
    "document_id" UUID,
    "channel" "NotificationChannel" NOT NULL DEFAULT 'EMAIL',
    "recipient_address_encrypted" BYTEA NOT NULL,
    "template_key" VARCHAR(100) NOT NULL,
    "provider_message_id" VARCHAR(255),
    "status" "NotificationDeliveryStatus" NOT NULL DEFAULT 'QUEUED',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "last_attempt_at" TIMESTAMPTZ(3),
    "delivered_at" TIMESTAMPTZ(3),
    "failure_code" VARCHAR(100),
    "failure_message" TEXT,
    "idempotency_key" VARCHAR(255) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("notification_delivery_id")
);

-- CreateTable
CREATE TABLE "sync_actions" (
    "sync_action_id" UUID NOT NULL,
    "device_id" VARCHAR(255) NOT NULL,
    "actor_user_id" UUID,
    "registration_id" UUID,
    "entity_type" VARCHAR(100) NOT NULL,
    "entity_id" UUID NOT NULL,
    "operation" "SyncOperation" NOT NULL,
    "base_version" INTEGER,
    "payload" JSONB NOT NULL,
    "status" "SyncActionStatus" NOT NULL DEFAULT 'PENDING',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "error_code" VARCHAR(100),
    "error_details" JSONB,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sync_actions_pkey" PRIMARY KEY ("sync_action_id")
);

-- CreateIndex
CREATE INDEX "events_status_starts_at_idx" ON "events"("status", "starts_at");

-- CreateIndex
CREATE INDEX "events_created_by_user_id_idx" ON "events"("created_by_user_id");

-- CreateIndex
CREATE INDEX "shifts_event_id_starts_at_idx" ON "shifts"("event_id", "starts_at");

-- CreateIndex
CREATE UNIQUE INDEX "shifts_event_id_name_starts_at_key" ON "shifts"("event_id", "name", "starts_at");

-- CreateIndex
CREATE INDEX "staff_assignments_user_id_status_idx" ON "staff_assignments"("user_id", "status");

-- CreateIndex
CREATE INDEX "staff_assignments_event_station_id_idx" ON "staff_assignments"("event_station_id");

-- CreateIndex
CREATE INDEX "staff_assignments_assigned_by_user_id_idx" ON "staff_assignments"("assigned_by_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "staff_assignments_shift_id_user_id_event_station_id_key" ON "staff_assignments"("shift_id", "user_id", "event_station_id");

-- CreateIndex
CREATE UNIQUE INDEX "reviews_supersedes_review_id_key" ON "reviews"("supersedes_review_id");

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
CREATE INDEX "document_artifacts_referral_id_idx" ON "document_artifacts"("referral_id");

-- CreateIndex
CREATE INDEX "document_artifacts_generated_by_user_id_idx" ON "document_artifacts"("generated_by_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "document_artifacts_review_id_document_type_version_key" ON "document_artifacts"("review_id", "document_type", "version");

-- CreateIndex
CREATE UNIQUE INDEX "notification_deliveries_idempotency_key_key" ON "notification_deliveries"("idempotency_key");

-- CreateIndex
CREATE INDEX "notification_deliveries_referral_id_idx" ON "notification_deliveries"("referral_id");

-- CreateIndex
CREATE INDEX "notification_deliveries_document_id_idx" ON "notification_deliveries"("document_id");

-- CreateIndex
CREATE INDEX "notification_deliveries_status_created_at_idx" ON "notification_deliveries"("status", "created_at");

-- CreateIndex
CREATE INDEX "sync_actions_status_received_at_idx" ON "sync_actions"("status", "received_at");

-- CreateIndex
CREATE INDEX "sync_actions_entity_type_entity_id_idx" ON "sync_actions"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "sync_actions_registration_id_idx" ON "sync_actions"("registration_id");

-- CreateIndex
CREATE INDEX "sync_actions_actor_user_id_idx" ON "sync_actions"("actor_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "sync_actions_device_id_sync_action_id_key" ON "sync_actions"("device_id", "sync_action_id");

-- AddForeignKey
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("event_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_assignments" ADD CONSTRAINT "staff_assignments_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "shifts"("shift_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_supersedes_review_id_fkey" FOREIGN KEY ("supersedes_review_id") REFERENCES "reviews"("review_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "reviews"("review_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_artifacts" ADD CONSTRAINT "document_artifacts_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "reviews"("review_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_artifacts" ADD CONSTRAINT "document_artifacts_referral_id_fkey" FOREIGN KEY ("referral_id") REFERENCES "referrals"("referral_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_referral_id_fkey" FOREIGN KEY ("referral_id") REFERENCES "referrals"("referral_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "document_artifacts"("document_id") ON DELETE RESTRICT ON UPDATE CASCADE;
