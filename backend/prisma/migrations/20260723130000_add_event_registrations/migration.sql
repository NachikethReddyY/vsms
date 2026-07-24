CREATE TABLE "event_registrations" (
    "registration_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_registrations_pkey" PRIMARY KEY ("registration_id")
);

CREATE INDEX "event_registrations_event_id_created_at_idx"
ON "event_registrations"("event_id", "created_at");

ALTER TABLE "event_registrations"
ADD CONSTRAINT "event_registrations_event_id_fkey"
FOREIGN KEY ("event_id") REFERENCES "events"("event_id")
ON DELETE CASCADE ON UPDATE CASCADE;