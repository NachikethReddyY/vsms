/*
  Warnings:

  - You are about to drop the column `dob` on the `user` table. All the data in the column will be lost.
  - You are about to drop the column `reference_number` on the `user` table. All the data in the column will be lost.
  - You are about to drop the `booth` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[email]` on the table `user` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[employee_number]` on the table `user` will be added. If there are existing duplicate values, this will fail.
  - Changed the type of `station_id` on the `staff_assignment` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Added the required column `email` to the `user` table without a default value. This is not possible if the table is not empty.
  - Added the required column `employee_number` to the `user` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updated_at` to the `user` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "Urgency" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "Outcome" AS ENUM ('PASSED', 'FAILED', 'PENDING', 'REFERRED');

-- CreateEnum
CREATE TYPE "DocType" AS ENUM ('PDF', 'IMAGE', 'REPORT', 'SUMMARY');

-- CreateEnum
CREATE TYPE "Channel" AS ENUM ('EMAIL', 'SMS', 'IN_APP');

-- DropForeignKey
ALTER TABLE "scan_log" DROP CONSTRAINT "scan_log_qr_id_fkey";

-- DropForeignKey
ALTER TABLE "scan_log" DROP CONSTRAINT "scan_log_user_id_fkey";

-- DropIndex
DROP INDEX "qr_code_pass_registration_id_key";

-- AlterTable
ALTER TABLE "scan_log" ALTER COLUMN "qr_id" DROP NOT NULL,
ALTER COLUMN "user_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "staff_assignment" DROP COLUMN "station_id",
ADD COLUMN     "station_id" UUID NOT NULL;

-- AlterTable
ALTER TABLE "user" DROP COLUMN "dob",
DROP COLUMN "reference_number",
ADD COLUMN     "date_of_birth" DATE,
ADD COLUMN     "department" VARCHAR(100),
ADD COLUMN     "designation" VARCHAR(100),
ADD COLUMN     "email" VARCHAR(255) NOT NULL,
ADD COLUMN     "employee_number" VARCHAR(20) NOT NULL,
ADD COLUMN     "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL,
ALTER COLUMN "full_name" SET DATA TYPE VARCHAR(100),
ALTER COLUMN "gender" DROP NOT NULL,
ALTER COLUMN "contact_number" DROP NOT NULL,
ALTER COLUMN "contact_number" SET DATA TYPE VARCHAR(20),
ALTER COLUMN "emergency_contact" DROP NOT NULL,
ALTER COLUMN "emergency_contact" SET DATA TYPE VARCHAR(20),
ALTER COLUMN "consent_confirmation" SET DEFAULT false;

-- DropTable
DROP TABLE "booth";

-- CreateTable
CREATE TABLE "user_credential" (
    "credential_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_credential_pkey" PRIMARY KEY ("credential_id")
);

-- CreateTable
CREATE TABLE "user_role" (
    "role_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" VARCHAR(50) NOT NULL,

    CONSTRAINT "user_role_pkey" PRIMARY KEY ("role_id")
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
    "reviewer_id" UUID NOT NULL,
    "outcome" "Outcome" NOT NULL,
    "urgency" "Urgency" NOT NULL,
    "clinical_summary" TEXT NOT NULL,
    "recommendations" TEXT NOT NULL,
    "review_datetime" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "previous_review_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_pkey" PRIMARY KEY ("review_id")
);

-- CreateTable
CREATE TABLE "referral" (
    "referral_id" UUID NOT NULL,
    "review_id" UUID NOT NULL,
    "created_by" UUID NOT NULL,
    "destination" VARCHAR(255) NOT NULL,
    "destination_email" VARCHAR(255) NOT NULL,
    "reason" TEXT NOT NULL,
    "instructions" TEXT NOT NULL,
    "urgency" "Urgency" NOT NULL,
    "status" VARCHAR(50) NOT NULL,
    "referral_datetime" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "referral_pkey" PRIMARY KEY ("referral_id")
);

-- CreateTable
CREATE TABLE "document_artifact" (
    "document_id" UUID NOT NULL,
    "referral_id" UUID,
    "document_type" "DocType" NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "storage_key" VARCHAR(500) NOT NULL,
    "file_hash" CHAR(64) NOT NULL,
    "file_name" VARCHAR(100) NOT NULL,
    "file_size" BIGINT NOT NULL,
    "generated_by" UUID NOT NULL,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_artifact_pkey" PRIMARY KEY ("document_id")
);

-- CreateTable
CREATE TABLE "notification_delivery" (
    "notification_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "document_id" UUID,
    "channel" "Channel" NOT NULL,
    "recipient" BYTEA NOT NULL,
    "template_id" UUID NOT NULL,
    "status" VARCHAR(50) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_delivery_pkey" PRIMARY KEY ("notification_id")
);

-- CreateTable
CREATE TABLE "sync_action" (
    "sync_action_id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "entity_type" VARCHAR(50) NOT NULL,
    "entity_id" UUID NOT NULL,
    "operation" VARCHAR(20) NOT NULL,
    "base_version" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),

    CONSTRAINT "sync_action_pkey" PRIMARY KEY ("sync_action_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_credential_user_id_key" ON "user_credential"("user_id");

-- CreateIndex
CREATE INDEX "staff_assignment_station_id_idx" ON "staff_assignment"("station_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "user_employee_number_key" ON "user"("employee_number");

-- AddForeignKey
ALTER TABLE "user_credential" ADD CONSTRAINT "user_credential_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_role" ADD CONSTRAINT "user_role_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "station" ADD CONSTRAINT "station_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "event"("event_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_assignment" ADD CONSTRAINT "staff_assignment_station_id_fkey" FOREIGN KEY ("station_id") REFERENCES "station"("station_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_entry" ADD CONSTRAINT "queue_entry_station_id_fkey" FOREIGN KEY ("station_id") REFERENCES "station"("station_id") ON DELETE RESTRICT ON UPDATE CASCADE;

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
ALTER TABLE "screening_result" ADD CONSTRAINT "screening_result_registration_id_fkey" FOREIGN KEY ("registration_id") REFERENCES "event_registration"("registration_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "screening_result" ADD CONSTRAINT "screening_result_station_id_fkey" FOREIGN KEY ("station_id") REFERENCES "station"("station_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "screening_result" ADD CONSTRAINT "screening_result_queue_entry_id_fkey" FOREIGN KEY ("queue_entry_id") REFERENCES "queue_entry"("queue_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "screening_result" ADD CONSTRAINT "screening_result_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "user"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review" ADD CONSTRAINT "review_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "user"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review" ADD CONSTRAINT "review_previous_review_id_fkey" FOREIGN KEY ("previous_review_id") REFERENCES "review"("review_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral" ADD CONSTRAINT "referral_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "review"("review_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral" ADD CONSTRAINT "referral_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "user"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_artifact" ADD CONSTRAINT "document_artifact_referral_id_fkey" FOREIGN KEY ("referral_id") REFERENCES "referral"("referral_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_artifact" ADD CONSTRAINT "document_artifact_generated_by_fkey" FOREIGN KEY ("generated_by") REFERENCES "user"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_delivery" ADD CONSTRAINT "notification_delivery_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_delivery" ADD CONSTRAINT "notification_delivery_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "document_artifact"("document_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_action" ADD CONSTRAINT "sync_action_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;
