-- Approval decisions intentionally exclude PENDING so Prisma's generated type
-- matches the database domain without relying on a check constraint.
CREATE TYPE "AccountApprovalDecisionType" AS ENUM ('APPROVED', 'REJECTED');

ALTER TABLE "account_approval_decisions"
  DROP CONSTRAINT IF EXISTS "account_approval_decisions_final_decision_check",
  DROP CONSTRAINT IF EXISTS "account_approval_decisions_rejection_reason_check";
ALTER TABLE "account_approval_decisions"
  ALTER COLUMN "decision" TYPE "AccountApprovalDecisionType"
  USING "decision"::text::"AccountApprovalDecisionType";
ALTER TABLE "account_approval_decisions"
  ADD CONSTRAINT "account_approval_decisions_rejection_reason_check"
  CHECK ("decision" <> 'REJECTED' OR NULLIF(BTRIM("reason"), '') IS NOT NULL);

CREATE TYPE "AccountProviderOperationType" AS ENUM ('SYNC_ACCESS', 'GLOBAL_SIGN_OUT', 'DISABLE_AND_SIGN_OUT');
CREATE TYPE "AccountProviderOperationStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELED');

CREATE TABLE "account_provider_operations" (
  "provider_operation_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "operation_type" "AccountProviderOperationType" NOT NULL,
  "status" "AccountProviderOperationStatus" NOT NULL DEFAULT 'PENDING',
  "idempotency_key" VARCHAR(150) NOT NULL,
  "payload" JSONB NOT NULL DEFAULT '{}',
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "next_attempt_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "claimed_at" TIMESTAMPTZ(3),
  "completed_at" TIMESTAMPTZ(3),
  "last_error_code" VARCHAR(80),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "account_provider_operations_pkey" PRIMARY KEY ("provider_operation_id")
);
CREATE UNIQUE INDEX "account_provider_operations_idempotency_key_key"
  ON "account_provider_operations"("idempotency_key");
CREATE INDEX "account_provider_operations_status_next_attempt_at_idx"
  ON "account_provider_operations"("status", "next_attempt_at");
CREATE INDEX "account_provider_operations_user_id_status_created_at_idx"
  ON "account_provider_operations"("user_id", "status", "created_at");
ALTER TABLE "account_provider_operations" ADD CONSTRAINT "account_provider_operations_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Re-run the additive backfill before asserting so deployments remain safe if
-- rows were created between separately deployed migration batches.
INSERT INTO "event_memberships" (
  "event_membership_id", "event_id", "user_id", "status", "added_by", "added_at"
)
SELECT MD5(e."event_id"::text || ':' || e."created_by_user_id"::text)::uuid,
       e."event_id", e."created_by_user_id", 'ACTIVE', e."created_by_user_id", e."created_at"
FROM "events" e
ON CONFLICT ("event_id", "user_id") DO NOTHING;

WITH assignment_memberships AS (
  SELECT sa."event_id", sa."user_id",
         (ARRAY_AGG(sa."assigned_by" ORDER BY sa."assigned_at", sa."assignment_id"))[1] AS "added_by",
         MIN(sa."assigned_at") AS "added_at",
         BOOL_OR(sa."assignment_status" IN ('ASSIGNED', 'CONFIRMED')) AS "is_active"
  FROM "staff_assignments" sa
  GROUP BY sa."event_id", sa."user_id"
)
INSERT INTO "event_memberships" (
  "event_membership_id", "event_id", "user_id", "status", "added_by", "added_at",
  "removed_by", "removed_at", "removal_reason"
)
SELECT MD5(am."event_id"::text || ':' || am."user_id"::text)::uuid,
       am."event_id", am."user_id",
       CASE WHEN am."is_active" THEN 'ACTIVE' ELSE 'REMOVED' END::"EventMembershipStatus",
       am."added_by", am."added_at",
       CASE WHEN am."is_active" THEN NULL ELSE am."added_by" END,
       CASE WHEN am."is_active" THEN NULL ELSE am."added_at" END,
       CASE WHEN am."is_active" THEN NULL ELSE 'Historical duties completed or cancelled before membership migration' END
FROM assignment_memberships am
ON CONFLICT ("event_id", "user_id") DO NOTHING;

INSERT INTO "event_membership_roles" (
  "event_membership_role_id", "event_membership_id", "role", "assigned_by", "assigned_at"
)
SELECT MD5(em."event_membership_id"::text || ':EVENT_MANAGER')::uuid,
       em."event_membership_id", 'EVENT_MANAGER', e."created_by_user_id", e."created_at"
FROM "events" e
JOIN "event_memberships" em
  ON em."event_id" = e."event_id" AND em."user_id" = e."created_by_user_id"
ON CONFLICT ("event_membership_id", "role") DO NOTHING;

WITH assignment_roles AS (
  SELECT DISTINCT ON (sa."event_id", sa."user_id", sa."assignment_role")
    sa."event_id", sa."user_id", sa."assignment_role", sa."assigned_by", sa."assigned_at"
  FROM "staff_assignments" sa
  WHERE sa."assignment_role" IS NOT NULL
  ORDER BY sa."event_id", sa."user_id", sa."assignment_role", sa."assigned_at", sa."assignment_id"
)
INSERT INTO "event_membership_roles" (
  "event_membership_role_id", "event_membership_id", "role", "assigned_by", "assigned_at"
)
SELECT MD5(em."event_membership_id"::text || ':' || ar."assignment_role"::text)::uuid,
       em."event_membership_id", ar."assignment_role"::text::"EventRole", ar."assigned_by", ar."assigned_at"
FROM assignment_roles ar
JOIN "event_memberships" em ON em."event_id" = ar."event_id" AND em."user_id" = ar."user_id"
ON CONFLICT ("event_membership_id", "role") DO NOTHING;

-- Abort deployment instead of silently accepting an incomplete backfill.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "events" e
    LEFT JOIN "event_memberships" em
      ON em."event_id" = e."event_id" AND em."user_id" = e."created_by_user_id"
    LEFT JOIN "event_membership_roles" emr
      ON emr."event_membership_id" = em."event_membership_id" AND emr."role" = 'EVENT_MANAGER'
    WHERE em."event_membership_id" IS NULL OR emr."event_membership_role_id" IS NULL
  ) THEN
    RAISE EXCEPTION 'account foundation backfill incomplete: event creator membership or role missing';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "staff_assignments" sa
    LEFT JOIN "event_memberships" em
      ON em."event_id" = sa."event_id" AND em."user_id" = sa."user_id"
    WHERE em."event_membership_id" IS NULL
  ) THEN
    RAISE EXCEPTION 'account foundation backfill incomplete: assignment membership missing';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "staff_assignments" sa
    JOIN "event_memberships" em
      ON em."event_id" = sa."event_id" AND em."user_id" = sa."user_id"
    LEFT JOIN "event_membership_roles" emr
      ON emr."event_membership_id" = em."event_membership_id"
      AND emr."role"::text = sa."assignment_role"::text
    WHERE sa."assignment_role" IS NOT NULL AND emr."event_membership_role_id" IS NULL
  ) THEN
    RAISE EXCEPTION 'account foundation backfill incomplete: assignment membership role missing';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "users"
    WHERE ("deprovisioned_at" IS NOT NULL AND ("access_state" <> 'DISABLED' OR "status" <> 'DISABLED'))
       OR ("access_state" = 'DISABLED' AND "status" <> 'DISABLED')
       OR ("access_state" = 'SUSPENDED' AND ("approval_state" <> 'APPROVED' OR "status" <> 'SUSPENDED'))
       OR ("access_state" = 'ENABLED' AND "approval_state" = 'APPROVED' AND "status" NOT IN ('ACTIVE', 'INACTIVE'))
       OR ("access_state" = 'ENABLED' AND "approval_state" IN ('PENDING', 'REJECTED') AND "status" <> 'INACTIVE')
  ) THEN
    RAISE EXCEPTION 'account foundation backfill incomplete: invalid account state mapping';
  END IF;
END;
$$;
