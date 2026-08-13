/*
  Warnings:

  - You are about to drop the column `nric_ciphertext` on the `participants` table. All the data in the column will be lost.
  - You are about to drop the column `nric_encryption_version` on the `participants` table. All the data in the column will be lost.
  - You are about to drop the column `nric_lookup_hash` on the `participants` table. All the data in the column will be lost.
  - You are about to drop the `qr_pass_events` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "qr_pass_events" DROP CONSTRAINT "qr_pass_events_actor_user_id_fkey";

-- DropIndex
DROP INDEX "event_registrations_event_attendance_idx";

-- DropIndex
DROP INDEX "participants_nric_lookup_hash_key";

-- DropIndex
DROP INDEX "queue_entries_station_completed_at_idx";

-- DropIndex
DROP INDEX "queue_entries_station_entered_at_idx";

-- DropIndex
DROP INDEX "queue_entries_station_id_status_is_priority_idx";

-- DropIndex
DROP INDEX "referrals_registration_created_at_idx";

-- DropIndex
DROP INDEX "reviews_registration_reviewed_at_idx";

-- DropIndex
DROP INDEX "screening_results_registration_created_at_idx";

-- DropIndex
DROP INDEX "stations_event_id_station_id_idx";

-- AlterTable
ALTER TABLE "notification_deliveries" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "participants" DROP COLUMN "nric_ciphertext",
DROP COLUMN "nric_encryption_version",
DROP COLUMN "nric_lookup_hash";

-- AlterTable
ALTER TABLE "report_artifact_blobs" ALTER COLUMN "updated_at" DROP DEFAULT;

-- DropTable
DROP TABLE "qr_pass_events";

-- DropEnum
DROP TYPE "QRPassEventAction";

-- CreateIndex
CREATE INDEX "refresh_sessions_expires_at_revoked_at_idx" ON "refresh_sessions"("expires_at", "revoked_at");

-- RenameIndex
ALTER INDEX "lifecycle_email_outbox_status_next_attempt_at_lease_expires_at_" RENAME TO "lifecycle_email_outbox_status_next_attempt_at_lease_expires_idx";

-- RenameIndex
ALTER INDEX "provider_event_receipts_provider_message_id_hash_received_at_id" RENAME TO "provider_event_receipts_provider_message_id_hash_received_a_idx";

-- RenameIndex
ALTER INDEX "screening_request_ledger_actor_user_id_event_id_registration_id" RENAME TO "screening_request_ledger_actor_user_id_event_id_registratio_idx";

-- RenameIndex
ALTER INDEX "signature_artifacts_user_id_event_id_purpose_target_id_consumed" RENAME TO "signature_artifacts_user_id_event_id_purpose_target_id_cons_idx";
