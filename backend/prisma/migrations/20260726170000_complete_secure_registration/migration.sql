-- Complete the secure staff registration module.
-- This migration preserves existing participant, consent, registration and audit data.

CREATE TYPE "ParticipantStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'DECEASED');

DROP TABLE IF EXISTS "user_credential";

CREATE TABLE "permission" (
    "permission_id" UUID NOT NULL,
    "permission_name" VARCHAR(100) NOT NULL,
    "description" VARCHAR(255),
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "permission_pkey" PRIMARY KEY ("permission_id")
);

CREATE TABLE "role_permission" (
    "role_permission_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,
    "granted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "role_permission_pkey" PRIMARY KEY ("role_permission_id")
);

CREATE TABLE "device" (
    "device_id" UUID NOT NULL,
    "user_id" UUID,
    "device_name" VARCHAR(100) NOT NULL,
    "fingerprint_hash" CHAR(64),
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "last_seen_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "device_pkey" PRIMARY KEY ("device_id")
);

CREATE UNIQUE INDEX "permission_permission_name_key" ON "permission"("permission_name");
CREATE INDEX "permission_created_by_idx" ON "permission"("created_by");
CREATE UNIQUE INDEX "role_permission_role_id_permission_id_key" ON "role_permission"("role_id", "permission_id");
CREATE INDEX "role_permission_permission_id_idx" ON "role_permission"("permission_id");
CREATE INDEX "device_user_id_status_idx" ON "device"("user_id", "status");

ALTER TABLE "permission"
    ADD CONSTRAINT "permission_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "user"("user_id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "role_permission"
    ADD CONSTRAINT "role_permission_role_id_fkey"
    FOREIGN KEY ("role_id") REFERENCES "role"("role_id")
    ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "role_permission_permission_id_fkey"
    FOREIGN KEY ("permission_id") REFERENCES "permission"("permission_id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "device"
    ADD CONSTRAINT "device_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "user"("user_id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "participant"
    ADD COLUMN "participant_reference" VARCHAR(30),
    ADD COLUMN "email" VARCHAR(255),
    ADD COLUMN "preferred_language" VARCHAR(50),
    ADD COLUMN "accessibility_notes" VARCHAR(1000),
    ADD COLUMN "status" "ParticipantStatus" NOT NULL DEFAULT 'ACTIVE',
    ADD COLUMN "created_by" UUID,
    ADD COLUMN "updated_by" UUID;

WITH numbered_participants AS (
    SELECT
        "participant_id",
        ROW_NUMBER() OVER (
            ORDER BY "created_at", "participant_id"
        ) AS legacy_number
    FROM "participant"
)
UPDATE "participant" AS participant
SET "participant_reference" =
    'VSMS-LEGACY-' || LPAD(numbered_participants.legacy_number::TEXT, 12, '0')
FROM numbered_participants
WHERE participant."participant_id" = numbered_participants."participant_id";

UPDATE "participant"
SET "created_by" = (SELECT "user_id" FROM "user" ORDER BY "created_at" ASC LIMIT 1),
    "updated_by" = (SELECT "user_id" FROM "user" ORDER BY "created_at" ASC LIMIT 1);

ALTER TABLE "participant"
    ALTER COLUMN "participant_reference" SET NOT NULL,
    ALTER COLUMN "created_by" SET NOT NULL,
    ALTER COLUMN "updated_by" SET NOT NULL,
    ALTER COLUMN "created_at" TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC',
    ALTER COLUMN "updated_at" TYPE TIMESTAMPTZ(3) USING "updated_at" AT TIME ZONE 'UTC';

CREATE UNIQUE INDEX "participant_participant_reference_key" ON "participant"("participant_reference");
CREATE INDEX "participant_last_name_first_name_idx" ON "participant"("last_name", "first_name");
CREATE INDEX "participant_contact_number_idx" ON "participant"("contact_number");
CREATE INDEX "participant_date_of_birth_idx" ON "participant"("date_of_birth");
CREATE INDEX "participant_status_idx" ON "participant"("status");
CREATE INDEX "participant_created_by_idx" ON "participant"("created_by");
CREATE INDEX "participant_updated_by_idx" ON "participant"("updated_by");

ALTER TABLE "participant"
    ADD CONSTRAINT "participant_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "user"("user_id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "participant_updated_by_fkey"
    FOREIGN KEY ("updated_by") REFERENCES "user"("user_id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "event_registration"
    ADD COLUMN "idempotency_key" VARCHAR(100);

UPDATE "event_registration"
SET "idempotency_key" = 'legacy-' || "registration_id"::TEXT;

ALTER TABLE "event_registration"
    ALTER COLUMN "idempotency_key" SET NOT NULL;

CREATE UNIQUE INDEX "event_registration_participant_id_event_id_key"
    ON "event_registration"("participant_id", "event_id");
CREATE UNIQUE INDEX "event_registration_event_id_queue_number_key"
    ON "event_registration"("event_id", "queue_number");
CREATE UNIQUE INDEX "event_registration_registered_by_idempotency_key_key"
    ON "event_registration"("registered_by", "idempotency_key");
CREATE INDEX "event_registration_event_id_registration_status_idx"
    ON "event_registration"("event_id", "registration_status");
CREATE INDEX "event_registration_participant_id_registered_at_idx"
    ON "event_registration"("participant_id", "registered_at");

DROP INDEX IF EXISTS "qr_code_pass_token_idx";
CREATE UNIQUE INDEX "qr_code_pass_token_key" ON "qr_code_pass"("token");

CREATE UNIQUE INDEX "one_active_primary_emergency_contact_per_participant"
    ON "participant_emergency_contact"("participant_id")
    WHERE "is_primary" = TRUE AND "status" = 'ACTIVE';

ALTER TABLE "audit_log"
    ADD COLUMN "device_id" UUID,
    ADD COLUMN "outcome" "AuthOutcome" NOT NULL DEFAULT 'SUCCESS',
    ADD COLUMN "request_id" UUID;

CREATE INDEX "audit_log_request_id_idx" ON "audit_log"("request_id");
CREATE INDEX "audit_log_device_id_created_at_idx" ON "audit_log"("device_id", "created_at");
CREATE INDEX "audit_log_entity_name_entity_id_idx" ON "audit_log"("entity_name", "entity_id");

-- A staff member must never be able to choose between competing "current" forms.
WITH ranked_active_forms AS (
    SELECT "consent_form_version_id",
           ROW_NUMBER() OVER (
               ORDER BY "effective_from" DESC, "created_at" DESC, "consent_form_version_id"
           ) AS active_rank
    FROM "consent_form_version"
    WHERE "is_active" = TRUE
)
UPDATE "consent_form_version"
SET "is_active" = FALSE
WHERE "consent_form_version_id" IN (
    SELECT "consent_form_version_id"
    FROM ranked_active_forms
    WHERE active_rank > 1
);

CREATE UNIQUE INDEX "one_active_consent_form"
    ON "consent_form_version" ((1))
    WHERE "is_active" = TRUE;

INSERT INTO "device" (
    "device_id",
    "device_name",
    "status",
    "created_at",
    "updated_at"
)
SELECT DISTINCT source."device_id", 'Migrated device', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (
    SELECT "device_id" FROM "auth_audit_log" WHERE "device_id" IS NOT NULL
    UNION
    SELECT "device_id" FROM "participant_consent" WHERE "device_id" IS NOT NULL
) AS source
ON CONFLICT ("device_id") DO NOTHING;

ALTER TABLE "audit_log"
    ADD CONSTRAINT "audit_log_device_id_fkey"
    FOREIGN KEY ("device_id") REFERENCES "device"("device_id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "auth_audit_log"
    ADD CONSTRAINT "auth_audit_log_device_id_fkey"
    FOREIGN KEY ("device_id") REFERENCES "device"("device_id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "participant_consent"
    ADD COLUMN "withdrawal_of_id" UUID,
    ADD COLUMN "signer_type" VARCHAR(40),
    ADD COLUMN "guardian_contact_name" VARCHAR(150),
    ADD COLUMN "guardian_contact_phone" VARCHAR(30),
    ADD COLUMN "guardian_contact_email" VARCHAR(255),
    ADD COLUMN "decision_at" TIMESTAMPTZ(3);

ALTER TABLE "consent_form_version"
    ADD COLUMN "content_text" TEXT;

UPDATE "participant_consent"
SET "decision_at" = COALESCE("signed_at", "withdrawn_at", "created_at")
WHERE "consent_status" IN ('ACCEPTED', 'DECLINED');

CREATE INDEX "participant_consent_withdrawal_of_id_idx"
    ON "participant_consent"("withdrawal_of_id");

ALTER TABLE "participant_consent"
    ADD CONSTRAINT "participant_consent_withdrawal_of_id_fkey"
    FOREIGN KEY ("withdrawal_of_id") REFERENCES "participant_consent"("consent_id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "participant_consent_device_id_fkey"
    FOREIGN KEY ("device_id") REFERENCES "device"("device_id")
    ON DELETE SET NULL ON UPDATE CASCADE;
