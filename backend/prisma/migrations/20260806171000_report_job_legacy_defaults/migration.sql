-- Agent 2's deletion blocker allowed minimal rows with only event and status.
-- Keep those rows creatable while API-created exports always set a requester.
ALTER TABLE "report_export_jobs"
  ALTER COLUMN "requested_by" DROP NOT NULL,
  ALTER COLUMN "expires_at" SET DEFAULT (CURRENT_TIMESTAMP + INTERVAL '7 days');
