-- The event seed and event-form API use reusable station templates. This
-- forward-only migration adds the table without changing existing stations,
-- event registrations, credentials, or secure-registration history.
CREATE TABLE "station_templates" (
    "station_template_id" UUID NOT NULL,
    "template_key" VARCHAR(50) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "name" VARCHAR(100) NOT NULL,
    "description" TEXT,
    "default_capacity" INTEGER NOT NULL DEFAULT 3,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "station_templates_pkey" PRIMARY KEY ("station_template_id")
);

CREATE UNIQUE INDEX "station_templates_template_key_key"
ON "station_templates"("template_key");
