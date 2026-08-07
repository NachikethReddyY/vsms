-- Account lifecycle and event authorization are additive. Legacy user status,
-- system roles, role grants, credentials, sessions, and duty assignments remain.
CREATE TYPE "AccountApprovalState" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
CREATE TYPE "AccountAccessState" AS ENUM ('ENABLED', 'SUSPENDED', 'DISABLED');
CREATE TYPE "ProfessionalCategory" AS ENUM ('STAFF', 'DOCTOR');
CREATE TYPE "EventMembershipStatus" AS ENUM ('ACTIVE', 'REMOVED');
CREATE TYPE "EventRole" AS ENUM ('EVENT_MANAGER', 'REGISTRATION', 'SCREENER', 'REVIEWER', 'SUPPORT');

ALTER TYPE "EventAuditAction" ADD VALUE IF NOT EXISTS 'DELETED';

ALTER TABLE "users"
  ALTER COLUMN "employee_number" DROP NOT NULL,
  ADD COLUMN "approval_state" "AccountApprovalState" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "access_state" "AccountAccessState" NOT NULL DEFAULT 'ENABLED',
  ADD COLUMN "professional_category" "ProfessionalCategory",
  ADD COLUMN "session_invalid_before" TIMESTAMPTZ(3),
  ADD COLUMN "deprovisioned_at" TIMESTAMPTZ(3),
  ADD COLUMN "deprovisioned_by" UUID,
  ADD COLUMN "deprovision_reason" VARCHAR(500);

-- Existing provisioned accounts keep their effective access after deployment.
UPDATE "users"
SET
  "approval_state" = 'APPROVED',
  "access_state" = CASE
    WHEN "status" = 'SUSPENDED' THEN 'SUSPENDED'::"AccountAccessState"
    WHEN "status" IN ('ACTIVE', 'INACTIVE') THEN 'ENABLED'::"AccountAccessState"
    ELSE 'DISABLED'::"AccountAccessState"
  END;

CREATE INDEX "users_approval_state_access_state_created_at_idx"
  ON "users"("approval_state", "access_state", "created_at");
CREATE INDEX "users_professional_category_idx" ON "users"("professional_category");
CREATE INDEX "users_deprovisioned_by_idx" ON "users"("deprovisioned_by");
ALTER TABLE "users" ADD CONSTRAINT "users_deprovisioned_by_fkey"
  FOREIGN KEY ("deprovisioned_by") REFERENCES "users"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "account_approval_decisions" (
  "approval_decision_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "decision" "AccountApprovalState" NOT NULL,
  "decided_by" UUID NOT NULL,
  "reason" VARCHAR(500),
  "decided_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "account_approval_decisions_pkey" PRIMARY KEY ("approval_decision_id"),
  CONSTRAINT "account_approval_decisions_final_decision_check" CHECK ("decision" IN ('APPROVED', 'REJECTED')),
  CONSTRAINT "account_approval_decisions_rejection_reason_check"
    CHECK ("decision" <> 'REJECTED' OR NULLIF(BTRIM("reason"), '') IS NOT NULL)
);
CREATE INDEX "account_approval_decisions_user_id_decided_at_idx"
  ON "account_approval_decisions"("user_id", "decided_at");
CREATE INDEX "account_approval_decisions_decided_by_decided_at_idx"
  ON "account_approval_decisions"("decided_by", "decided_at");
ALTER TABLE "account_approval_decisions" ADD CONSTRAINT "account_approval_decisions_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "account_approval_decisions" ADD CONSTRAINT "account_approval_decisions_decided_by_fkey"
  FOREIGN KEY ("decided_by") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "event_memberships" (
  "event_membership_id" UUID NOT NULL,
  "event_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "status" "EventMembershipStatus" NOT NULL DEFAULT 'ACTIVE',
  "added_by" UUID NOT NULL,
  "added_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "removed_by" UUID,
  "removed_at" TIMESTAMPTZ(3),
  "removal_reason" VARCHAR(500),
  CONSTRAINT "event_memberships_pkey" PRIMARY KEY ("event_membership_id"),
  CONSTRAINT "event_memberships_removal_metadata_check" CHECK (
    ("status" = 'ACTIVE' AND "removed_by" IS NULL AND "removed_at" IS NULL AND "removal_reason" IS NULL)
    OR
    ("status" = 'REMOVED' AND "removed_by" IS NOT NULL AND "removed_at" IS NOT NULL AND NULLIF(BTRIM("removal_reason"), '') IS NOT NULL)
  )
);
CREATE UNIQUE INDEX "event_memberships_event_id_user_id_key" ON "event_memberships"("event_id", "user_id");
CREATE INDEX "event_memberships_user_id_status_idx" ON "event_memberships"("user_id", "status");
CREATE INDEX "event_memberships_event_id_status_idx" ON "event_memberships"("event_id", "status");
CREATE INDEX "event_memberships_added_by_idx" ON "event_memberships"("added_by");
CREATE INDEX "event_memberships_removed_by_idx" ON "event_memberships"("removed_by");
ALTER TABLE "event_memberships" ADD CONSTRAINT "event_memberships_event_id_fkey"
  FOREIGN KEY ("event_id") REFERENCES "events"("event_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "event_memberships" ADD CONSTRAINT "event_memberships_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "event_memberships" ADD CONSTRAINT "event_memberships_added_by_fkey"
  FOREIGN KEY ("added_by") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "event_memberships" ADD CONSTRAINT "event_memberships_removed_by_fkey"
  FOREIGN KEY ("removed_by") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "event_membership_roles" (
  "event_membership_role_id" UUID NOT NULL,
  "event_membership_id" UUID NOT NULL,
  "role" "EventRole" NOT NULL,
  "assigned_by" UUID NOT NULL,
  "assigned_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "event_membership_roles_pkey" PRIMARY KEY ("event_membership_role_id")
);
CREATE UNIQUE INDEX "event_membership_roles_event_membership_id_role_key"
  ON "event_membership_roles"("event_membership_id", "role");
CREATE INDEX "event_membership_roles_role_event_membership_id_idx"
  ON "event_membership_roles"("role", "event_membership_id");
CREATE INDEX "event_membership_roles_assigned_by_idx" ON "event_membership_roles"("assigned_by");
ALTER TABLE "event_membership_roles" ADD CONSTRAINT "event_membership_roles_event_membership_id_fkey"
  FOREIGN KEY ("event_membership_id") REFERENCES "event_memberships"("event_membership_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "event_membership_roles" ADD CONSTRAINT "event_membership_roles_assigned_by_fkey"
  FOREIGN KEY ("assigned_by") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Event creators are always backfilled as active event managers.
INSERT INTO "event_memberships" (
  "event_membership_id", "event_id", "user_id", "status", "added_by", "added_at"
)
SELECT
  MD5(e."event_id"::text || ':' || e."created_by_user_id"::text)::uuid,
  e."event_id",
  e."created_by_user_id",
  'ACTIVE'::"EventMembershipStatus",
  e."created_by_user_id",
  e."created_at"
FROM "events" e
ON CONFLICT ("event_id", "user_id") DO NOTHING;

-- Every assigned user receives one membership. A membership is active when any
-- current duty is assigned/confirmed; historical-only duties remain explicit.
WITH assignment_memberships AS (
  SELECT
    sa."event_id",
    sa."user_id",
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
SELECT
  MD5(am."event_id"::text || ':' || am."user_id"::text)::uuid,
  am."event_id",
  am."user_id",
  CASE WHEN am."is_active" THEN 'ACTIVE' ELSE 'REMOVED' END::"EventMembershipStatus",
  am."added_by",
  am."added_at",
  CASE WHEN am."is_active" THEN NULL ELSE am."added_by" END,
  CASE WHEN am."is_active" THEN NULL ELSE am."added_at" END,
  CASE WHEN am."is_active" THEN NULL ELSE 'Historical duties completed or cancelled before membership migration' END
FROM assignment_memberships am
ON CONFLICT ("event_id", "user_id") DO NOTHING;

INSERT INTO "event_membership_roles" (
  "event_membership_role_id", "event_membership_id", "role", "assigned_by", "assigned_at"
)
SELECT
  MD5(em."event_membership_id"::text || ':EVENT_MANAGER')::uuid,
  em."event_membership_id",
  'EVENT_MANAGER'::"EventRole",
  e."created_by_user_id",
  e."created_at"
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
SELECT
  MD5(em."event_membership_id"::text || ':' || ar."assignment_role"::text)::uuid,
  em."event_membership_id",
  ar."assignment_role"::text::"EventRole",
  ar."assigned_by",
  ar."assigned_at"
FROM assignment_roles ar
JOIN "event_memberships" em ON em."event_id" = ar."event_id" AND em."user_id" = ar."user_id"
ON CONFLICT ("event_membership_id", "role") DO NOTHING;

CREATE OR REPLACE FUNCTION "prevent_account_approval_decision_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'account approval decisions are immutable' USING ERRCODE = '42501';
END;
$$;
CREATE TRIGGER "account_approval_decisions_immutable"
BEFORE UPDATE OR DELETE ON "account_approval_decisions"
FOR EACH ROW EXECUTE FUNCTION "prevent_account_approval_decision_mutation"();

-- The event deletion outbox must accept review decision signatures as well as
-- the original consent/referral artifact types.
ALTER TABLE "artifact_cleanup_tasks"
  DROP CONSTRAINT IF EXISTS "artifact_cleanup_tasks_artifact_type_check";
ALTER TABLE "artifact_cleanup_tasks"
  ADD CONSTRAINT "artifact_cleanup_tasks_artifact_type_check"
  CHECK ("artifact_type" IN ('CONSENT_SIGNATURE', 'REFERRAL_SIGNATURE', 'REVIEW_DECISION_SIGNATURE', 'REFERRAL_DOCUMENT'));
