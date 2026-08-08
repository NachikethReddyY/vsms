-- A matched returning participant is attached to the target event before the
-- final registration exists. This preserves event scope without creating a
-- premature registration or queue entry.
CREATE TABLE "participant_event_intakes" (
  "intake_id" UUID NOT NULL,
  "participant_id" UUID NOT NULL,
  "event_id" UUID NOT NULL,
  "attached_by" UUID NOT NULL,
  "reason" VARCHAR(40) NOT NULL DEFAULT 'REUSED_MATCH',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "participant_event_intakes_pkey" PRIMARY KEY ("intake_id")
);

CREATE UNIQUE INDEX "participant_event_intakes_participant_id_event_id_key"
  ON "participant_event_intakes"("participant_id", "event_id");
CREATE INDEX "participant_event_intakes_event_id_created_at_idx"
  ON "participant_event_intakes"("event_id", "created_at");
CREATE INDEX "participant_event_intakes_attached_by_idx"
  ON "participant_event_intakes"("attached_by");

ALTER TABLE "participant_event_intakes"
  ADD CONSTRAINT "participant_event_intakes_participant_id_fkey"
    FOREIGN KEY ("participant_id") REFERENCES "participants"("participant_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "participant_event_intakes_event_id_fkey"
    FOREIGN KEY ("event_id") REFERENCES "events"("event_id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "participant_event_intakes_attached_by_fkey"
    FOREIGN KEY ("attached_by") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "permissions" ("permission_id", "permission_name", "description")
VALUES ('8b92f5b6-5102-4a38-8a06-186c2e4b8463', 'participants:cross-event-reuse', 'Match and attach a returning participant to an assigned event')
ON CONFLICT ("permission_name") DO NOTHING;

INSERT INTO "role_permissions" ("role_permission_id", "role_id", "permission_id")
SELECT '2abbb2c8-c2d1-4173-ae7f-358a24db3198', "role_id", '8b92f5b6-5102-4a38-8a06-186c2e4b8463'
FROM "roles"
WHERE "role_name" = 'REGISTRATION_OFFICER'
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
