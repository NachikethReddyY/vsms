-- A participant created during registration is temporarily visible only to the
-- officer and event that created it. Consent records never establish this scope.
ALTER TABLE "participants" ADD COLUMN "onboarding_event_id" UUID;

ALTER TABLE "participants"
  ADD CONSTRAINT "participants_onboarding_event_id_fkey"
  FOREIGN KEY ("onboarding_event_id") REFERENCES "events"("event_id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "participants_onboarding_event_id_idx" ON "participants"("onboarding_event_id");
