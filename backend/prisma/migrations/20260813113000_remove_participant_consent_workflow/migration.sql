-- Remove the standalone participant-consent workflow. New registrations retain
-- the officer's checkbox acknowledgement on the registration itself.
DELETE FROM "role_permissions"
WHERE "permission_id" IN (
  SELECT "permission_id" FROM "permissions" WHERE "permission_name" = 'consents:record'
);

DELETE FROM "permissions" WHERE "permission_name" = 'consents:record';
DELETE FROM "signature_artifacts" WHERE "purpose" = 'CONSENT';
DELETE FROM "artifact_cleanup_tasks" WHERE "artifact_type" = 'CONSENT_SIGNATURE';

CREATE TYPE "SignaturePurpose_new" AS ENUM ('REFERRAL', 'REVIEW_DECISION');
ALTER TABLE "signature_artifacts"
  ALTER COLUMN "purpose" TYPE "SignaturePurpose_new"
  USING ("purpose"::text::"SignaturePurpose_new");
DROP TYPE "SignaturePurpose";
ALTER TYPE "SignaturePurpose_new" RENAME TO "SignaturePurpose";

DROP TABLE IF EXISTS "participant_consents";
DROP TABLE IF EXISTS "consent_form_versions";
DROP TYPE IF EXISTS "ConsentStatus";

ALTER TABLE "participants" DROP COLUMN IF EXISTS "consent_given";
ALTER TABLE "event_registrations"
  ADD COLUMN IF NOT EXISTS "consent_acknowledged" BOOLEAN NOT NULL DEFAULT false;
