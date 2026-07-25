/*
  Warnings:

  - The `status` column on the `notification_delivery` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `status` column on the `referral` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `operation` column on the `sync_action` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - A unique constraint covering the columns `[nric]` on the table `participant` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `nric` to the `participant` table without a default value. This is not possible if the table is not empty.
  - Added the required column `nric_masked` to the `participant` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updated_at` to the `referral` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updated_at` to the `review` table without a default value. This is not possible if the table is not empty.

*/
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
CREATE TYPE "NotificationDeliveryStatus" AS ENUM ('QUEUED', 'SENDING', 'DELIVERED', 'FAILED', 'BOUNCED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SyncOperation" AS ENUM ('CREATE', 'UPDATE', 'DELETE');

-- CreateEnum
CREATE TYPE "SyncActionStatus" AS ENUM ('PENDING', 'PROCESSING', 'APPLIED', 'CONFLICT', 'FAILED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "DocType" ADD VALUE 'REFERRAL_PDF';
ALTER TYPE "DocType" ADD VALUE 'CLINICAL_SUMMARY_PDF';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "EventStatus" ADD VALUE 'DRAFT';
ALTER TYPE "EventStatus" ADD VALUE 'PUBLISHED';
ALTER TYPE "EventStatus" ADD VALUE 'IN_PROGRESS';

-- DropForeignKey
ALTER TABLE "staff_assignment" DROP CONSTRAINT "staff_assignment_station_id_fkey";

-- AlterTable
ALTER TABLE "document_artifact" ADD COLUMN     "expires_at" TIMESTAMPTZ(3),
ADD COLUMN     "review_id" UUID,
ALTER COLUMN "file_name" DROP NOT NULL;

-- AlterTable
ALTER TABLE "event" ADD COLUMN     "cancellation_reason" TEXT,
ADD COLUMN     "cancelled_at" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "notification_delivery" ADD COLUMN     "recipient_address_encrypted" BYTEA,
ADD COLUMN     "referral_id" UUID,
ADD COLUMN     "template_key" VARCHAR(100),
ALTER COLUMN "channel" SET DEFAULT 'EMAIL',
ALTER COLUMN "recipient" DROP NOT NULL,
ALTER COLUMN "template_id" DROP NOT NULL,
DROP COLUMN "status",
ADD COLUMN     "status" "NotificationDeliveryStatus" NOT NULL DEFAULT 'QUEUED';

-- AlterTable
ALTER TABLE "participant" ADD COLUMN     "address" TEXT,
ADD COLUMN     "emergency_contact_name" VARCHAR(100),
ADD COLUMN     "nationality" VARCHAR(50) DEFAULT 'Singaporean',
ADD COLUMN     "nric" VARCHAR(9) NOT NULL,
ADD COLUMN     "nric_masked" VARCHAR(9) NOT NULL,
ADD COLUMN     "race" VARCHAR(50);

-- AlterTable
ALTER TABLE "referral" ADD COLUMN     "clinicalUrgency" "ClinicalUrgency",
ADD COLUMN     "registration_id" UUID,
ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL,
ALTER COLUMN "destination_email" DROP NOT NULL,
ALTER COLUMN "instructions" DROP NOT NULL,
ALTER COLUMN "urgency" DROP NOT NULL,
DROP COLUMN "status",
ADD COLUMN     "status" "ReferralStatus" NOT NULL DEFAULT 'DRAFT',
ALTER COLUMN "referral_datetime" DROP NOT NULL;

-- AlterTable
ALTER TABLE "review" ADD COLUMN     "clinicalUrgency" "ClinicalUrgency" DEFAULT 'ROUTINE',
ADD COLUMN     "registration_id" UUID,
ADD COLUMN     "reviewOutcome" "ReviewOutcome",
ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL,
ALTER COLUMN "outcome" DROP NOT NULL,
ALTER COLUMN "urgency" DROP NOT NULL,
ALTER COLUMN "recommendations" DROP NOT NULL,
ALTER COLUMN "review_datetime" DROP NOT NULL;

-- AlterTable
ALTER TABLE "staff_assignment" ADD COLUMN     "assignment_role" "StaffAssignmentRole",
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "shift_id" UUID,
ADD COLUMN     "status" "StaffAssignmentStatus" DEFAULT 'ASSIGNED',
ALTER COLUMN "station_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "sync_action" ADD COLUMN     "registration_id" UUID,
ADD COLUMN     "status" "SyncActionStatus" NOT NULL DEFAULT 'PENDING',
ALTER COLUMN "device_id" SET DATA TYPE VARCHAR(255),
ALTER COLUMN "entity_type" SET DATA TYPE VARCHAR(100),
DROP COLUMN "operation",
ADD COLUMN     "operation" "SyncOperation",
ALTER COLUMN "base_version" DROP NOT NULL;

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

-- CreateIndex
CREATE INDEX "shift_event_id_starts_at_idx" ON "shift"("event_id", "starts_at");

-- CreateIndex
CREATE UNIQUE INDEX "shift_event_id_name_starts_at_key" ON "shift"("event_id", "name", "starts_at");

-- CreateIndex
CREATE UNIQUE INDEX "participant_nric_key" ON "participant"("nric");

-- CreateIndex
CREATE INDEX "participant_nric_idx" ON "participant"("nric");

-- AddForeignKey
ALTER TABLE "shift" ADD CONSTRAINT "shift_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "event"("event_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_assignment" ADD CONSTRAINT "staff_assignment_station_id_fkey" FOREIGN KEY ("station_id") REFERENCES "station"("station_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_assignment" ADD CONSTRAINT "staff_assignment_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "shift"("shift_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review" ADD CONSTRAINT "review_registration_id_fkey" FOREIGN KEY ("registration_id") REFERENCES "event_registration"("registration_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral" ADD CONSTRAINT "referral_registration_id_fkey" FOREIGN KEY ("registration_id") REFERENCES "event_registration"("registration_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_artifact" ADD CONSTRAINT "document_artifact_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "review"("review_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_delivery" ADD CONSTRAINT "notification_delivery_referral_id_fkey" FOREIGN KEY ("referral_id") REFERENCES "referral"("referral_id") ON DELETE SET NULL ON UPDATE CASCADE;
