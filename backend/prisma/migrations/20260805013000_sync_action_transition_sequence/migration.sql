ALTER TABLE "sync_action_transitions" ADD COLUMN "sequence" INTEGER;

WITH ranked AS (
  SELECT
    "sync_transition_id",
    ROW_NUMBER() OVER (
      PARTITION BY "sync_action_id"
      ORDER BY "created_at", "sync_transition_id"
    ) - 1 AS "sequence"
  FROM "sync_action_transitions"
)
UPDATE "sync_action_transitions" AS transition
SET "sequence" = ranked."sequence"
FROM ranked
WHERE transition."sync_transition_id" = ranked."sync_transition_id";

ALTER TABLE "sync_action_transitions" ALTER COLUMN "sequence" SET NOT NULL;

CREATE UNIQUE INDEX "sync_action_transitions_sync_action_id_sequence_key"
  ON "sync_action_transitions"("sync_action_id", "sequence");
