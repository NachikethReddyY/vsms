ALTER TYPE "AccountProviderOperationStatus" ADD VALUE IF NOT EXISTS 'RESOLVED';

ALTER TABLE "account_provider_operations"
  ADD COLUMN "resolved_at" TIMESTAMPTZ(3),
  ADD COLUMN "resolution_reason" VARCHAR(500);
