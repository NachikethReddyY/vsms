ALTER TYPE "AccountProviderOperationStatus" ADD VALUE IF NOT EXISTS 'ESCALATED';

ALTER TABLE "users"
  ADD COLUMN "provider_state_generation" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "account_provider_operations"
  ADD COLUMN "generation" INTEGER,
  ADD COLUMN "claim_token" UUID;

WITH ordered AS (
  SELECT "provider_operation_id",
         ROW_NUMBER() OVER (PARTITION BY "user_id" ORDER BY "created_at", "provider_operation_id") AS generation
  FROM "account_provider_operations"
)
UPDATE "account_provider_operations" op
SET "generation" = ordered.generation
FROM ordered
WHERE op."provider_operation_id" = ordered."provider_operation_id";

ALTER TABLE "account_provider_operations" ALTER COLUMN "generation" SET NOT NULL;
CREATE UNIQUE INDEX "account_provider_operations_user_id_generation_key"
  ON "account_provider_operations"("user_id", "generation");

UPDATE "users" u
SET "provider_state_generation" = generations.maximum
FROM (
  SELECT "user_id", MAX("generation") AS maximum
  FROM "account_provider_operations"
  GROUP BY "user_id"
) generations
WHERE u."user_id" = generations."user_id";

-- Legacy INACTIVE means dormant/recoverable. Only DISABLED is irreversible
-- without a separate future reprovision workflow.
UPDATE "users"
SET "access_state" = 'ENABLED'
WHERE "status" = 'INACTIVE'
  AND "deprovisioned_at" IS NULL;
