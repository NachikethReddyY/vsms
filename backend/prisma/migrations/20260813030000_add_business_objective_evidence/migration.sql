ALTER TABLE "event_registrations"
ADD COLUMN "workflow_started_at" TIMESTAMPTZ(3),
ADD COLUMN "paper_form_used" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "paper_exception_reason" VARCHAR(200);

ALTER TABLE "event_registrations"
ADD CONSTRAINT "event_registrations_paper_exception_reason_check"
CHECK (
  ("paper_form_used" = false AND "paper_exception_reason" IS NULL)
  OR
  ("paper_form_used" = true AND length(trim("paper_exception_reason")) BETWEEN 3 AND 200)
);
