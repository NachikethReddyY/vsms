CREATE TABLE "participants" (
    "participant_id" UUID NOT NULL,
    "first_name" VARCHAR(100) NOT NULL,
    "last_name" VARCHAR(100) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "participants_pkey" PRIMARY KEY ("participant_id")
);

CREATE TABLE "participant_event_registrations" (
    "registration_id" UUID NOT NULL,
    "participant_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "participant_event_registrations_pkey" PRIMARY KEY ("registration_id")
);

CREATE TABLE "qr_code_passes" (
    "qr_id" UUID NOT NULL,
    "registration_id" UUID NOT NULL,
    "token" VARCHAR(255) NOT NULL,
    "issued_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "revoked_at" TIMESTAMPTZ(3),
    "revoked_by_user_id" UUID,
    "revoked_reason" VARCHAR(255),

    CONSTRAINT "qr_code_passes_pkey" PRIMARY KEY ("qr_id")
);

CREATE INDEX "participant_event_registrations_participant_id_created_at_idx"
ON "participant_event_registrations"("participant_id", "created_at");

CREATE INDEX "participant_event_registrations_event_id_created_at_idx"
ON "participant_event_registrations"("event_id", "created_at");

CREATE UNIQUE INDEX "qr_code_passes_token_key" ON "qr_code_passes"("token");
CREATE INDEX "qr_code_passes_registration_id_is_active_idx"
ON "qr_code_passes"("registration_id", "is_active");
CREATE INDEX "qr_code_passes_expires_at_is_active_idx"
ON "qr_code_passes"("expires_at", "is_active");

ALTER TABLE "participant_event_registrations"
ADD CONSTRAINT "participant_event_registrations_participant_id_fkey"
FOREIGN KEY ("participant_id") REFERENCES "participants"("participant_id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "participant_event_registrations"
ADD CONSTRAINT "participant_event_registrations_event_id_fkey"
FOREIGN KEY ("event_id") REFERENCES "events"("event_id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "qr_code_passes"
ADD CONSTRAINT "qr_code_passes_registration_id_fkey"
FOREIGN KEY ("registration_id") REFERENCES "participant_event_registrations"("registration_id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "qr_code_passes"
ADD CONSTRAINT "qr_code_passes_revoked_by_user_id_fkey"
FOREIGN KEY ("revoked_by_user_id") REFERENCES "users"("user_id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "qr_code_passes"
ADD CONSTRAINT "qr_code_passes_expiry_check"
CHECK ("expires_at" > "issued_at");
