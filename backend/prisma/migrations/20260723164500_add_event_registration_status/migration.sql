CREATE TYPE "EventRegistrationStatus" AS ENUM ('SIGNED_UP', 'CHECKED_IN', 'COMPLETED', 'CANCELLED');

ALTER TABLE "event_registrations"
ADD COLUMN "status" "EventRegistrationStatus" NOT NULL DEFAULT 'SIGNED_UP',
ADD COLUMN "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "event_registrations"
ALTER COLUMN "updated_at" DROP DEFAULT;

CREATE INDEX "event_registrations_event_id_status_idx"
ON "event_registrations"("event_id", "status");